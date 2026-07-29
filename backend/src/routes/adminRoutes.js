const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

router.get('/dashboard', adminController.getDashboard);
router.get('/integrations', adminController.getIntegrations);
router.post('/integrations/:type', adminController.updateIntegration);
router.post('/integrations/:type/test', adminController.testIntegration);
router.get('/models', adminController.getModels);
router.post('/models/:id/default', adminController.setDefaultModel);
router.get('/logs', adminController.getLogs);
router.get('/llm/dual-config', adminController.getDualConfig);
router.post('/llm/dual-config', adminController.updateDualConfig);

module.exports = router;
