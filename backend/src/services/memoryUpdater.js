const OwnerMemory = require('../models/ownerMemoryModel');
const ChatHistory = require('../models/chatHistoryModel');

class MemoryUpdater {
  async saveMessage(conversationId, role, content, intent = 'general_chat', executedTools = []) {
    try {
      await ChatHistory.create({
        conversationId,
        role,
        content,
        intent,
        executedTools
      });
    } catch (e) {
      console.log('ChatHistory save notice:', e.message);
    }
  }

  async extractAndSaveKnowledge(userMessage, aiResponse) {
    const text = userMessage.toLowerCase();

    // Auto-detect permanent knowledge statements
    if (text.includes('loyihamiz') || text.includes('yangi biznes') || text.includes('server IP') || text.includes('kodlash uslubi') || text.includes('parol')) {
      try {
        const key = `fact-${Date.now()}`;
        await OwnerMemory.create({
          key,
          category: text.includes('kodlash') ? 'preference' : 'project',
          title: `User Note: ${userMessage.slice(0, 40)}...`,
          content: `User: ${userMessage} | AI Response Summary: ${aiResponse.slice(0, 100)}...`
        });
      } catch (e) {}
    }
  }
}

module.exports = new MemoryUpdater();
