const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');
const schemas = require('../validations/schemas');

// POST /api/auth/register foi removido de propósito: o app tem um único
// operador (o organizador), não múltiplos usuários se cadastrando sozinhos.
// Antes disso, qualquer pessoa que descobrisse essa rota (ou chamasse a API
// direto, sem passar pela tela) conseguia criar uma conta com acesso total —
// não existe distinção de papel/role entre usuários neste sistema. Ver
// ARCHITECTURE.md para o registro dessa decisão.

// POST /api/auth/login
router.post('/login', authLimiter, validate(schemas.authLogin), authController.login);

module.exports = router;