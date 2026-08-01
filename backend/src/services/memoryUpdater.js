const OwnerMemory = require('../models/ownerMemoryModel');
const ChatHistory = require('../models/chatHistoryModel');

class MemoryUpdater {
  async saveMessage(conversationId, role, content, intent = 'general_chat', executedTools = []) {
    if (!content || !content.trim()) return;
    try {
      await ChatHistory.create({
        conversationId: conversationId || 'conv-1',
        role: role || 'user',
        content: content.trim(),
        intent,
        executedTools: Array.isArray(executedTools) ? executedTools : []
      });
    } catch (e) {
      console.log('ChatHistory save notice:', e.message);
    }
  }

  async extractAndSaveKnowledge(userMessage, aiResponse) {
    const text = userMessage.toLowerCase();

    // Auto-detect permanent knowledge & profile statements (projects, businesses, focus, interests, notion space)
    if (text.includes('loyihamiz') || text.includes('yangi biznes') || text.includes('server ip') || text.includes('kodlash uslubi') || text.includes('parol') || text.includes('haqimda') || text.includes('qiziqish') || text.includes('focus') || text.includes('fokus') || text.includes('notion') || text.includes('space') || text.includes('biznes')) {
      try {
        const key = `fact-${Date.now()}`;
        await OwnerMemory.create({
          key,
          category: text.includes('focus') || text.includes('fokus') ? 'focus' : (text.includes('biznes') ? 'business' : 'personal_profile'),
          title: `Executive Note: ${userMessage.slice(0, 45)}...`,
          content: `User Statement: "${userMessage}" | Executive Synthesis: "${aiResponse.slice(0, 150)}..."`
        });
      } catch (e) {}
    }
  }
}

module.exports = new MemoryUpdater();
