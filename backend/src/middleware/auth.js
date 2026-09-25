// src/middleware/auth.js
const jwt = require('jsonwebtoken');

/**
 * Middleware de autenticação JWT
 * Valida token e extrai dados do usuário
 */
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: {
          message: 'No token provided',
          code: 'NO_TOKEN',
        },
      });
    }

    // Token deve vir como "Bearer <token>"
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({
        error: {
          message: 'Invalid token format',
          code: 'INVALID_FORMAT',
        },
      });
    }

    const token = parts[1];

    // Verifica e decodifica o JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Passa dados do usuário para req.user
    req.user = {
      id: decoded.id,
      email: decoded.email,
      name: decoded.name,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: {
          message: 'Token expired',
          code: 'TOKEN_EXPIRED',
        },
      });
    }

    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: {
          message: 'Invalid token',
          code: 'INVALID_TOKEN',
        },
      });
    }

    return res.status(401).json({
      error: {
        message: 'Authentication failed',
        code: 'AUTH_FAILED',
      },
    });
  }
};

/**
 * Helper para gerar JWT
 */
// A validade vem do ambiente porque 24h não serve para todo evento: quem
// configura o campeonato na véspera e volta na manhã seguinte chega com a
// sessão vencida. Em dia de competição vale subir (ex.: JWT_EXPIRES_IN=72h)
// em vez de recompilar. O default continua 24h para nada mudar sem decisão.
const generateToken = (user, expiresIn = process.env.JWT_EXPIRES_IN || '24h') => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    process.env.JWT_SECRET,
    { expiresIn }
  );
};

module.exports = {
  authMiddleware,
  generateToken,
};
