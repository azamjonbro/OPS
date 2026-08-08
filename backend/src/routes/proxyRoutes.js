const express = require('express');
const router = express.Router();
const proxyController = require('../controllers/proxyController');

router.get('/', proxyController.list);
router.post('/bulk-import', proxyController.bulkImport);
router.post('/test/:purpose', proxyController.testAll);
router.delete('/:id', proxyController.remove);

module.exports = router;
