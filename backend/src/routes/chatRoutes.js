const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');

router.get('/conversations', chatController.getConversations);
router.post('/conversations', chatController.createConversation);
router.delete('/conversations', chatController.clearAllConversations);
router.delete('/conversations/:id', chatController.deleteConversation);
router.get('/conversations/:id/messages', chatController.getMessages);
router.post('/message', chatController.sendMessage);
router.post('/voice-message', chatController.sendVoiceMessage);

module.exports = router;
