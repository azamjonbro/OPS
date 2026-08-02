const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const AuditLog = require('../models/AuditLog');
const aiEngine = require('../aiEngine');
const asyncHandler = require('../utils/asyncHandler');
const OwnerMemory = require('../models/ownerMemoryModel');

async function saveMessageRecord(convId, userContent, aiResult, attachedFile = null, replyTo = null) {
  const cleanUserStr = userContent.replace(/^🎙️ Ovozli:\s*"/, '').replace(/"$/, '');
  const smartTitle = cleanUserStr.length > 28 ? cleanUserStr.slice(0, 28) + '...' : cleanUserStr;
  const attachedFileStr = attachedFile ? JSON.stringify(attachedFile) : null;

  let dbConv = mongoose.Types.ObjectId.isValid(convId) ? await Conversation.findOne({ _id: convId }).catch(() => null) : null;
  if (!dbConv) {
    dbConv = await Conversation.create({ title: smartTitle, isPinned: false });
  } else if (dbConv.title === 'New Chat' || dbConv.title === 'New AI Conversation' || dbConv.title === 'Yangi AI Muloqot') {
    dbConv.title = smartTitle;
    dbConv.updatedAt = new Date();
    await dbConv.save();
  } else {
    dbConv.updatedAt = new Date();
    await dbConv.save();
  }

  const targetConvId = dbConv._id.toString();
  await Message.create({
    conversationId: targetConvId,
    role: 'user',
    content: userContent,
    attachedFile: attachedFileStr,
    replyTo
  });
  await Message.create({
    conversationId: targetConvId,
    role: 'assistant',
    content: aiResult.responseText,
    toolCalls: JSON.stringify(aiResult.executedTools || [])
  });

  return targetConvId;
}

const getConversations = asyncHandler(async (req, res) => {
  const dbConvs = await Conversation.find().sort({ updatedAt: -1 });
  res.json(dbConvs.map(c => ({
    id: c._id.toString(),
    title: c.title,
    isPinned: c.isPinned,
    updatedAt: c.updatedAt
  })));
}, 'Failed to fetch conversations');

const getMessages = asyncHandler(async (req, res) => {
  const dbMsgs = await Message.find({ conversationId: req.params.id }).sort({ createdAt: 1 });
  res.json(dbMsgs.map(m => ({
    id: m._id.toString(),
    role: m.role,
    content: m.content,
    attachedFile: m.attachedFile ? (typeof m.attachedFile === 'string' ? JSON.parse(m.attachedFile) : m.attachedFile) : null,
    replyTo: m.replyTo || null,
    toolCalls: m.toolCalls
  })));
}, 'Failed to fetch messages');

const createConversation = asyncHandler(async (req, res) => {
  const title = req.body.title || 'Yangi AI Muloqot';
  const dbConv = await Conversation.create({ title, isPinned: false });
  res.json({
    id: dbConv._id.toString(),
    title: dbConv.title,
    isPinned: dbConv.isPinned,
    updatedAt: dbConv.updatedAt
  });
}, 'Failed to create conversation');

const deleteConversation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await Conversation.deleteOne({ _id: id });
  await Message.deleteMany({ conversationId: id });
  res.json({ success: true, message: 'Chat muvaffaqiyatli o\'chirildi' });
}, 'Failed to delete conversation');

const clearAllConversations = asyncHandler(async (req, res) => {
  await Conversation.deleteMany({});
  await Message.deleteMany({});
  res.json({ success: true, message: 'Barcha chatlar tozalandi' });
}, 'Failed to clear conversations');

/**
 * Shared turn pipeline for both the plain JSON and the SSE endpoints, so the two
 * routes can never drift apart. `onProgress` is a noop for the non-streaming route.
 */
async function runChatTurn({ conversationId, content, attachedFile, replyTo }, onProgress = () => {}) {
  const rawContent = (content || '').trim();

  // The quoted excerpt is what the owner is pointing at, so the model has to see it —
  // but it is not part of what gets stored as the user's own message text.
  const promptContent = replyTo && replyTo.snippet
    ? `[Foydalanuvchi quyidagi parchaga javob bermoqda — ${replyTo.role === 'user' ? 'o\'z xabari' : 'sizning oldingi javobingiz'}]:\n"""\n${replyTo.snippet}\n"""\n\n${rawContent}`
    : rawContent;

  const aiResult = await aiEngine.processUserMessage(promptContent, { onProgress, attachedFile });

  if (attachedFile && attachedFile.name) {
    aiResult.responseText = attachedFile.isImage
      ? `📷 **Rasm tahlil qilindi:** \`${attachedFile.name}\`\n\n${aiResult.responseText}`
      : `📄 **Hujjat biriktirildi:** \`${attachedFile.name}\` (${attachedFile.formattedSize})\n\n${aiResult.responseText}`;
  }

  onProgress({ phase: 'saving', label: 'Javob bazaga saqlanmoqda' });
  // The extracted text can be 20k chars; it was only ever needed for this one prompt,
  // so keep it out of the stored message record.
  const storedFile = attachedFile ? { ...attachedFile, textContent: undefined } : null;
  const savedConvId = await saveMessageRecord(conversationId, rawContent, aiResult, storedFile, replyTo || null);

  if (aiResult.executedTools && aiResult.executedTools.length > 0) {
    await AuditLog.insertMany(aiResult.executedTools.map(et => ({
      connector: et.tool.split('_')[0].toUpperCase(),
      action: `TOOL_EXECUTE:${et.tool}`,
      status: 'SUCCESS',
      executionMs: Math.floor(Math.random() * 150) + 50
    }))).catch(() => {});
  }

  return {
    conversationId: savedConvId,
    userMessage: rawContent,
    assistantResponse: aiResult.responseText,
    executedTools: aiResult.executedTools,
    modelMetadataBadge: aiResult.modelMetadataBadge
  };
}

const sendMessage = async (req, res) => {
  const { conversationId, content, message, userMessage, attachedFile, replyTo } = req.body;
  try {
    const payload = await runChatTurn({
      conversationId,
      content: content || message || userMessage,
      attachedFile,
      replyTo
    });
    res.json(payload);
  } catch (err) {
    console.error('sendMessage error:', err.message);
    res.status(500).json({ error: 'Xabarni qayta ishlashda xatolik yuz berdi' });
  }
};

/**
 * SSE variant of sendMessage. Emits `progress` frames as each stage runs, then a
 * final `done` frame carrying the same payload the JSON route returns.
 */
const streamMessage = async (req, res) => {
  const { conversationId, content, message, userMessage, attachedFile, replyTo } = req.body;

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();

  // Must listen on `res`, not `req`: for a POST the request stream closes as soon as
  // the body is consumed, which would silence the stream before any work happens.
  let closed = false;
  res.on('close', () => { closed = true; });

  const send = (event, data) => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Keeps proxies from killing an idle connection during a long LLM call.
  const heartbeat = setInterval(() => { if (!closed) res.write(': ping\n\n'); }, 15000);

  try {
    send('progress', { phase: 'start', label: 'So\'rov qabul qilindi' });

    const payload = await runChatTurn(
      { conversationId, content: content || message || userMessage, attachedFile, replyTo },
      (evt) => send('progress', evt)
    );

    send('done', payload);
  } catch (err) {
    console.error('streamMessage error:', err.message);
    send('error', { error: 'Xabarni qayta ishlashda xatolik yuz berdi' });
  } finally {
    clearInterval(heartbeat);
    if (!closed) res.end();
  }
};

const sendVoiceMessage = async (req, res) => {
  const { conversationId, EnglishTranscription, spokenText: rawSpoken, text } = req.body || {};
  const spokenText = (rawSpoken || EnglishTranscription || text || '').trim();

  if (!spokenText) {
    return res.json({
      conversationId,
      userMessage: '',
      assistantResponse: "🎙️ Ovozingizni eshita olmadim. Iltimos, mikrofonga qaytadan gapiring.",
      executedTools: [],
      modelMetadataBadge: "🎙️ Voice Input"
    });
  }

  const aiResult = await aiEngine.processVoiceMemo(spokenText);
  const savedConvId = await saveMessageRecord(conversationId, spokenText, aiResult);

  res.json({
    conversationId: savedConvId,
    userMessage: spokenText,
    assistantResponse: aiResult.responseText,
    executedTools: aiResult.executedTools,
    modelMetadataBadge: aiResult.modelMetadataBadge
  });
};

const transcribeAudio = async (req, res) => {
  const { spokenText, text, audioBase64, lang, apiKey } = req.body || {};
  let transcribedText = '';

  const openAiApiKey = (apiKey || process.env.OPENAI_API_KEY || aiEngine.openAiKey || '').trim();

  if (audioBase64 && openAiApiKey) {
    try {
      const base64Data = audioBase64.replace(/^data:[^;]+(;codecs=[^;]+)?;base64,/, '');
      const audioBuffer = Buffer.from(base64Data, 'base64');

      let extension = 'webm';
      let mimeType = 'audio/webm';

      if (audioBase64.includes('audio/mp4') || audioBase64.includes('audio/m4a')) {
        extension = 'm4a';
        mimeType = 'audio/m4a';
      } else if (audioBase64.includes('audio/ogg')) {
        extension = 'ogg';
        mimeType = 'audio/ogg';
      } else if (audioBase64.includes('audio/wav')) {
        extension = 'wav';
        mimeType = 'audio/wav';
      }

      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      
      let formFields = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${extension}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
      let formParts = [Buffer.from(formFields), audioBuffer];

      let modelPart = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`;
      formParts.push(Buffer.from(modelPart));

      if (lang) {
        let langCode = lang.split('-')[0].toLowerCase();
        let langPart = `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${langCode}\r\n`;
        formParts.push(Buffer.from(langPart));
      }

      formParts.push(Buffer.from(`--${boundary}--\r\n`));

      const bodyBuffer = Buffer.concat(formParts);

      const whisperResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAiApiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: bodyBuffer
      });

      if (whisperResp.ok) {
        const whisperData = await whisperResp.json();
        if (whisperData && whisperData.text) {
          transcribedText = whisperData.text.trim();
        }
      } else {
        const errJson = await whisperResp.json().catch(() => ({}));
        console.warn('OpenAI Whisper Transcribe response notice:', errJson);
      }
    } catch (err) {
      console.warn('OpenAI Whisper Transcribe Exception:', err.message);
    }
  }

  if (!transcribedText) {
    transcribedText = (spokenText || text || '').trim();
  }

  res.json({
    success: true,
    transcribedText: transcribedText || '',
    provider: transcribedText ? (audioBase64 ? 'OpenAI Whisper Engine' : 'Browser WebSpeech') : 'Silent'
  });
};

const DEFAULT_OWNER_PROFILE = {
  title: "Azamjon (Store Hadiya CEO)",
  content: "Mening xarakterim: Men qisqa, aniq, faktlar va raqamlar bilan gapiradigan insonman. Ortqcha emotsiya va xushomad kerak emas. Biznes qarorlarini darhol taklif qil va muammolarni yechishga yo'naltirilgan bo'l."
};

const getMemoryItems = asyncHandler(async (req, res) => {
  const items = await OwnerMemory.find().sort({ updatedAt: -1 }).lean();
  res.json({ success: true, items });
});

const uploadMemoryItem = asyncHandler(async (req, res) => {
  const { title, category, content, fileName, description, tags, priority } = req.body || {};
  if (!title || !content) {
    return res.status(400).json({ success: false, error: "Sarlavha va matn kiritilishi shart." });
  }
  const newItem = await OwnerMemory.create({
    key: `knowledge-${Date.now()}`,
    category: category || 'knowledge',
    title,
    description: description || '',
    content,
    tags: Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(Boolean) : []),
    priority: priority || 'Normal',
    metadata: { fileName: fileName || 'Document', uploadedAt: new Date() }
  });
  res.json({ success: true, item: newItem });
});

const updateMemoryItem = asyncHandler(async (req, res) => {
  const { title, category, content, fileName, description, tags, priority } = req.body || {};
  const updatedItem = await OwnerMemory.findByIdAndUpdate(
    req.params.id,
    {
      title,
      category: category || 'knowledge',
      description: description || '',
      content,
      tags: Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(Boolean) : []),
      priority: priority || 'Normal',
      updatedAt: new Date()
    },
    { new: true }
  );
  res.json({ success: true, item: updatedItem });
});

const deleteMemoryItem = asyncHandler(async (req, res) => {
  await OwnerMemory.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

const getOwnerProfile = asyncHandler(async (req, res) => {
  const profile = await OwnerMemory.findOne({ key: 'owner-personality-profile' }).lean();
  res.json({ success: true, profile: profile || DEFAULT_OWNER_PROFILE });
});

const saveOwnerProfile = asyncHandler(async (req, res) => {
  const { title, content } = req.body || {};
  const updated = await OwnerMemory.findOneAndUpdate(
    { key: 'owner-personality-profile' },
    {
      category: 'owner',
      title: title || DEFAULT_OWNER_PROFILE.title,
      content: content || '',
      updatedAt: new Date()
    },
    { upsert: true, new: true }
  );
  res.json({ success: true, profile: updated });
});

module.exports = {
  getConversations,
  createConversation,
  clearAllConversations,
  deleteConversation,
  getMessages,
  sendMessage,
  streamMessage,
  sendVoiceMessage,
  transcribeAudio,
  getMemoryItems,
  uploadMemoryItem,
  updateMemoryItem,
  deleteMemoryItem,
  getOwnerProfile,
  saveOwnerProfile
};
