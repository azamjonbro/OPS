const express = require('express');
const router = express.Router();
const telegramUserbotController = require('../controllers/telegramUserbotController');

router.get('/status', telegramUserbotController.getStatus);
router.post('/start-login', telegramUserbotController.startLogin);
router.post('/submit-code', telegramUserbotController.submitCode);
router.post('/submit-password', telegramUserbotController.submitPassword);
router.post('/sync-history', telegramUserbotController.syncHistory);
router.post('/logout', telegramUserbotController.logout);

module.exports = router;
