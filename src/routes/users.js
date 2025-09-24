const express = require('express');
const { listUsers } = require('../controllers/usersController');
const auth = require('../middleware/auth');
const router = express.Router();

router.get('/', auth, listUsers);

module.exports = router;
