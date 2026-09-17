const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');
const schemas = require('../validations/schemas');

// POST /api/auth/register
router.post('/register', authLimiter, validate(schemas.authRegister), authController.register);

// POST /api/auth/login
router.post('/login', authLimiter, validate(schemas.authLogin), authController.login);

module.exports = router;