const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const proxyRoutes = require('./proxyRoutes');

router.get('/dashboard', adminController.getDashboard);
router.get('/integrations', adminController.getIntegrations);
router.post('/integrations/:type', adminController.updateIntegration);
router.post('/integrations/:type/test', adminController.testIntegration);
router.post('/integrations/:type/disconnect', adminController.disconnectIntegration);
router.get('/models', adminController.getModels);
router.post('/models/:id/default', adminController.setDefaultModel);
router.get('/logs', adminController.getLogs);
router.get('/cache/stats', adminController.getCacheStats);
router.post('/cache/clear', adminController.clearCache);
router.get('/llm/dual-config', adminController.getDualConfig);
router.post('/llm/dual-config', adminController.updateDualConfig);
router.use('/proxies', proxyRoutes);

module.exports = router;
