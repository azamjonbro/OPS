const express = require('express');
const router = express.Router();
const mailController = require('../controllers/mailController');

router.get('/health', mailController.getHealth);
router.get('/inbox', mailController.getInbox);
router.post('/send', mailController.sendMail);

module.exports = router;
