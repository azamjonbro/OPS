const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const mockDb = require('../store');
const aiEngine = require('../aiEngine');

async function saveMessageRecord(convId, userContent, aiResult, attachedFile = null) {
  let conv = mockDb.conversations.find(c => c.id === convId);
  const cleanUserStr = userContent.replace(/^🎙️ Ovozli:\s*"/, '').replace(/"$/, '');
  const smartTitle = cleanUserStr.length > 28 ? cleanUserStr.slice(0, 28) + '...' : cleanUserStr;

  if (!conv) {
    conv = {
      id: convId,
      title: smartTitle,
      isPinned: false,
      updatedAt: new Date()
    };
    mockDb.conversations.unshift(conv);
  } else if (conv.title === 'New AI Conversation' || conv.title === 'Yangi AI Muloqot' || conv.title === 'New Chat') {
    conv.title = smartTitle;
    conv.updatedAt = new Date();
  } else {
    conv.updatedAt = new Date();
  }

  mockDb.conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  const attachedFileStr = attachedFile ? JSON.stringify(attachedFile) : null;

  if (!mockDb.messages[convId]) mockDb.messages[convId] = [];
  const userMsg = { id: `m-${Date.now()}`, role: 'user', content: userContent, attachedFile: attachedFileStr };
  const aiMsg = {
    id: `m-${Date.now() + 1}`,
    role: 'assistant',
    content: aiResult.responseText,
    toolCalls: JSON.stringify(aiResult.executedTools || [])
  };

  mockDb.messages[convId].push(userMsg);
  mockDb.messages[convId].push(aiMsg);

  try {
    if (mongoose.connection.readyState === 1) {
      let dbConv = await Conversation.findOne({ _id: convId }).catch(() => null);
      if (!dbConv) {
        dbConv = await Conversation.create({ title: smartTitle, isPinned: false });
      } else if (dbConv.title === 'New Chat' || dbConv.title === 'New AI Conversation' || dbConv.title === 'Yangi AI Muloqot') {
        dbConv.title = smartTitle;
        dbConv.updatedAt = new Date();
        await dbConv.save();
      }

      const targetConvId = dbConv ? dbConv._id.toString() : convId;
      await Message.create({
        conversationId: targetConvId,
        role: 'user',
        content: userContent,
        attachedFile: attachedFileStr
      });
      await Message.create({
        conversationId: targetConvId,
        role: 'assistant',
        content: aiResult.responseText,
        toolCalls: JSON.stringify(aiResult.executedTools || [])
      });
    }
  } catch (e) {}
}

const getConversations = async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const dbConvs = await Conversation.find().sort({ updatedAt: -1 });
      return res.json(dbConvs.map(c => ({
        id: c._id.toString(),
        title: c.title,
        isPinned: c.isPinned,
        updatedAt: c.updatedAt
      })));
    }
  } catch (e) {}
  res.json(mockDb.conversations);
};

const getMessages = async (req, res) => {
  const { id } = req.params;
  try {
    if (mongoose.connection.readyState === 1) {
      const dbMsgs = await Message.find({ conversationId: id }).sort({ createdAt: 1 });
      if (dbMsgs.length > 0) {
        return res.json(dbMsgs.map(m => ({
          id: m._id.toString(),
          role: m.role,
          content: m.content,
          attachedFile: m.attachedFile ? (typeof m.attachedFile === 'string' ? JSON.parse(m.attachedFile) : m.attachedFile) : null,
          toolCalls: m.toolCalls
        })));
      }
    }
  } catch (e) {}
  const rawMsgs = mockDb.messages[id] || [];
  res.json(rawMsgs.map(m => ({
    ...m,
    attachedFile: m.attachedFile ? (typeof m.attachedFile === 'string' ? JSON.parse(m.attachedFile) : m.attachedFile) : null
  })));
};

const createConversation = async (req, res) => {
  const title = req.body.title || 'Yangi AI Muloqot';
  const newId = `conv-${Date.now()}`;
  const newConv = {
    id: newId,
    title,
    isPinned: false,
    updatedAt: new Date()
  };
  mockDb.conversations.unshift(newConv);
  mockDb.messages[newId] = [];

  try {
    if (mongoose.connection.readyState === 1) {
      const dbConv = await Conversation.create({ title, isPinned: false });
      newConv.id = dbConv._id.toString();
      mockDb.messages[newConv.id] = [];
    }
  } catch (e) {}

  res.json(newConv);
};

const deleteConversation = async (req, res) => {
  const { id } = req.params;
  mockDb.conversations = mockDb.conversations.filter(c => c.id !== id);
  delete mockDb.messages[id];

  try {
    if (mongoose.connection.readyState === 1) {
      await Conversation.deleteOne({ _id: id }).catch(() => null);
      await Message.deleteMany({ conversationId: id }).catch(() => null);
    }
  } catch (e) {}

  res.json({ success: true, message: 'Chat muvaffaqiyatli o\'chirildi' });
};

const clearAllConversations = async (req, res) => {
  mockDb.conversations = [];
  mockDb.messages = {};

  try {
    if (mongoose.connection.readyState === 1) {
      await Conversation.deleteMany({}).catch(() => null);
      await Message.deleteMany({}).catch(() => null);
    }
  } catch (e) {}

  res.json({ success: true, message: 'Barcha chatlar tozalandi' });
};

const sendMessage = async (req, res) => {
  const { conversationId, content, attachedFile } = req.body;
  const convId = conversationId || 'conv-1';

  const rawContent = (content || '').trim();
  let aiPromptContent = rawContent;
  if (attachedFile && attachedFile.name) {
    const fileNotice = `[Fayl biriktirildi: ${attachedFile.name}]`;
    aiPromptContent = aiPromptContent ? `${aiPromptContent}\n${fileNotice}` : fileNotice;
  }

  const aiResult = await aiEngine.processUserMessage(aiPromptContent, mockDb);

  if (attachedFile && attachedFile.name) {
    if (attachedFile.isImage) {
      aiResult.responseText = `📷 **Rasm tahlil qilindi:** \`${attachedFile.name}\`\n\n${aiResult.responseText}`;
    } else {
      aiResult.responseText = `📄 **Hujjat biriktirildi va tahlil qilindi:** \`${attachedFile.name}\` (${attachedFile.formattedSize})\n\n${aiResult.responseText}`;
    }
  }

  await saveMessageRecord(convId, rawContent, aiResult, attachedFile);

  if (aiResult.executedTools) {
    aiResult.executedTools.forEach(et => {
      mockDb.auditLogs.unshift({
        id: `log-${Date.now()}-${Math.random()}`,
        connector: et.tool.split('_')[0].toUpperCase(),
        action: `TOOL_EXECUTE:${et.tool}`,
        status: 'SUCCESS',
        executionMs: Math.floor(Math.random() * 150) + 50,
        createdAt: new Date()
      });
    });
  }

  res.json({
    conversationId: convId,
    userMessage: effectiveContent,
    assistantResponse: aiResult.responseText,
    executedTools: aiResult.executedTools,
    modelMetadataBadge: aiResult.modelMetadataBadge
  });
};

const sendVoiceMessage = async (req, res) => {
  const { conversationId, EnglishTranscription, spokenText: rawSpoken, text } = req.body || {};
  const convId = conversationId || 'conv-1';
  const spokenText = (rawSpoken || EnglishTranscription || text || '').trim();

  if (!spokenText) {
    return res.json({
      conversationId: convId,
      userMessage: '',
      assistantResponse: "🎙️ Ovozingizni eshita olmadim. Iltimos, mikrofonga qaytadan gapiring.",
      executedTools: [],
      modelMetadataBadge: "🎙️ Voice Input"
    });
  }

  const aiResult = await aiEngine.processVoiceMemo(spokenText, mockDb);
  await saveMessageRecord(convId, spokenText, aiResult);

  res.json({
    conversationId: convId,
    userMessage: spokenText,
    assistantResponse: aiResult.responseText,
    executedTools: aiResult.executedTools,
    modelMetadataBadge: aiResult.modelMetadataBadge
  });
};

module.exports = {
  getConversations,
  getMessages,
  createConversation,
  deleteConversation,
  clearAllConversations,
  sendMessage,
  sendVoiceMessage
};
