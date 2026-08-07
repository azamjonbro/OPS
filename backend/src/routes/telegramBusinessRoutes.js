const express = require('express');
const router = express.Router();
const telegramBusinessController = require('../controllers/telegramBusinessController');

router.post('/business-webhook', telegramBusinessController.receiveWebhook);

module.exports = router;
