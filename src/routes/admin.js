const express = require('express');
const { systemStats, viewLogs } = require('../controllers/adminController');
const auth = require('../middleware/auth');
const router = express.Router();

router.get('/stats', auth, systemStats);
router.get('/logs', auth, viewLogs);

module.exports = router;
