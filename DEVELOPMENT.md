# 🛠️ Guia de Desenvolvimento

Diretrizes e boas práticas para trabalhar neste projeto.

## Setup Local (Docker)

### Requisitos
- Docker & Docker Compose
- Node.js 18+ (se desenvolver sem Docker)

### Início Rápido com Docker

```bash
# 1. Suba os serviços (PostgreSQL + Backend)
docker-compose up -d

# 2. Verifique se está tudo rodando
docker-compose ps

# 3. Acesse:
# - Backend API: http://localhost:5000
# - Health check: http://localhost:5000/health
# - Database: localhost:5432 (champy_user / champy_password)
```

### Sem Docker

```bash
# 1. Instale PostgreSQL
# Mac: brew install postgresql
# Linux: sudo apt-get install postgresql
# Windows: https://www.postgresql.org/download/windows/

# 2. Crie banco de dados
psql -U postgres
CREATE USER champy_user WITH PASSWORD 'champy_password';
CREATE DATABASE champy_championship OWNER champy_user;

# 3. Execute migration
cd backend
npm install
npm run migrate

# 4. Inicie servidor
npm run dev
```

---

## Estrutura de Pastas - Backend

```
backend/
├── src/
│   ├── app.js              # Express setup
│   ├── server.js           # Entry point
│   ├── config/
│   │   └── database.js     # Pool PostgreSQL
│   ├── middleware/
│   │   ├── auth.js         # JWT validation
│   │   └── errorHandler.js # Error handling
│   ├── controllers/        # Lógica de negócio
│   │   ├── authController.js
│   │   ├── teamController.js
│   │   └── ...
│   ├── routes/             # Endpoints
│   │   ├── auth.js
│   │   ├── teams.js
│   │   └── ...
│   ├── models/             # Queries (opcional: usar diretamente no controller)
│   │   ├── Team.js
│   │   └── ...
│   └── websocket/
│       └── leaderboard.js  # Socket.io logic
├── migrations/
│   ├── 001_initial_schema.sql
│   └── 002_indexes.sql
├── package.json
├── .env.example
└── Dockerfile
```

---

## Padrões de Código

### Controllers

```javascript
// src/controllers/teamController.js
const { queryAll, queryOne, query } = require('../config/database');

/**
 * Cria nova equipe
 * POST /api/teams
 */
exports.createTeam = async (req, res, next) => {
  try {
    const { name, category_id, championship_id } = req.body;

    // Validação (usar Joi em produção)
    if (!name || !category_id) {
      return res.status(400).json({
        error: { message: 'Missing required fields' }
      });
    }

    const result = await query(
      `INSERT INTO teams (name, category_id, championship_id, registered_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, category_id, championship_id, req.user.id]
    );

    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    next(err); // Passa para error handler middleware
  }
};

/**
 * Lista equipes de um campeonato
 * GET /api/teams?championship_id=1
 */
exports.listTeams = async (req, res, next) => {
  try {
    const { championship_id } = req.query;

    const teams = await queryAll(
      `SELECT t.*, c.name as category_name 
       FROM teams t
       JOIN categories c ON t.category_id = c.id
       WHERE t.championship_id = $1
       ORDER BY t.registered_at DESC`,
      [championship_id]
    );

    res.json({ data: teams });
  } catch (err) {
    next(err);
  }
};
```

### Routes

```javascript
// src/routes/teams.js
const express = require('express');
const router = express.Router();
const teamController = require('../controllers/teamController');
const { authMiddleware } = require('../middleware/auth');

// Rotas protegidas
router.post('/', authMiddleware, teamController.createTeam);
router.get('/', teamController.listTeams); // Pública (apenas leitura)
router.get('/:id', teamController.getTeam);
router.put('/:id', authMiddleware, teamController.updateTeam);
router.delete('/:id', authMiddleware, teamController.deleteTeam);

module.exports = router;
```

### Middleware de Erro

```javascript
// Toda rota deve chamar next(err) em caso de erro
// O middleware central trata a resposta

app.use((err, req, res, next) => {
  console.error(err);
  
  const statusCode = err.status || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    error: {
      message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
});
```

---

## WebSocket (Socket.io)

### Broadcasting de Leaderboard

```javascript
// Após registrar um resultado:
const { io, broadcastLeaderboardUpdate } = app.locals;

// Trigger recalcula automaticamente (no banco)
// Então notificamos clientes:
broadcastLeaderboardUpdate(championship_id, {
  standings: updatedStandings,
  timestamp: new Date(),
});
```

### Cliente (React)

```javascript
// hooks/useWebSocket.ts
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export const useWebSocket = (championshipId: number) => {
  const [standings, setStandings] = useState([]);

  useEffect(() => {
    const socket = io(process.env.REACT_APP_API_URL);
    
    socket.emit('subscribe_championship', championshipId);
    
    socket.on('leaderboard_updated', (data) => {
      setStandings(data.standings);
    });

    return () => socket.disconnect();
  }, [championshipId]);

  return standings;
};
```

---

## Queries SQL - Padrões

### ✅ COM Parametrização (Seguro)

```javascript
// Previne SQL Injection
const result = await query(
  'SELECT * FROM teams WHERE championship_id = $1 AND id = $2',
  [championshipId, teamId]
);
```

### ❌ SEM Parametrização (Perigoso)

```javascript
// NÃO FAÇA ISTO!
const result = await query(
  `SELECT * FROM teams WHERE championship_id = ${championshipId}`
);
```

---

## Autenticação

### Login

```
POST /api/auth/login
{
  "email": "admin@champy.local",
  "password": "senha123"
}

Response:
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "email": "admin@champy.local",
    "name": "Admin"
  }
}
```

### Usar Token (Frontend)

```javascript
const response = await fetch('http://localhost:5000/api/teams', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

---

## Testing

### Backend

```bash
# Rodar testes
npm test

# Com coverage
npm run test:coverage

# Watch mode
npm test -- --watch
```

### Exemplo de Teste

```javascript
// tests/controllers/team.test.js
describe('Team Controller', () => {
  describe('POST /api/teams', () => {
    it('should create a new team', async () => {
      const response = await request(app)
        .post('/api/teams')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Team A',
          category_id: 1,
          championship_id: 1
        });

      expect(response.status).toBe(201);
      expect(response.body.data.name).toBe('Team A');
    });
  });
});
```

---

## Git Workflow

### Branches

```
main                 # Produção
├─ develop          # Staging
│  ├─ feature/auth       (nova feature)
│  ├─ fix/bug-leaderboard (correção)
│  └─ refactor/db-queries (refactor)
```

### Commit Messages

```
[type]: [description]

Types:
  feat:     nova feature
  fix:      correção de bug
  refactor: mudança de código sem alterar comportamento
  test:     testes
  docs:     documentação
  chore:    tarefas de manutenção

Exemplo:
  feat: add leaderboard real-time updates with WebSocket
  fix: prevent SQL injection in team queries
  docs: update architecture.md with WebSocket explanation
```

### Pull Request

1. Crie branch: `git checkout -b feature/sua-feature`
2. Faça commits semânticos
3. Push: `git push origin feature/sua-feature`
4. Abra PR em GitHub
5. Code review
6. Merge em `develop`
7. Deploy em staging
8. Merge `develop` → `main` para produção

---

## Variáveis de Ambiente

### Development (.env)

```
NODE_ENV=development
PORT=5000
DB_HOST=localhost (ou postgres se usar Docker)
DB_PORT=5432
DB_USER=champy_user
DB_PASSWORD=champy_password
DB_NAME=champy_championship
JWT_SECRET=dev-secret-key
CORS_ORIGIN=http://localhost:3000
```

### Production (.env.production)

```
NODE_ENV=production
PORT=5000
DB_HOST=your-db-host.railway.app
DB_PORT=5432
DB_USER=champy_prod
DB_PASSWORD=<strong-password>
DB_NAME=champy_prod
JWT_SECRET=<gere com: openssl rand -hex 32>
CORS_ORIGIN=https://seu-dominio.com
```

---

## Performance & Monitoring

### Logs

```javascript
// Padrão: structured logging
console.log(JSON.stringify({
  level: 'info',
  message: 'Team created',
  teamId: 123,
  timestamp: new Date().toISOString(),
}));
```

### Índices (já criados)

```sql
CREATE INDEX idx_team_standings_championship_place
  ON team_standings(championship_id, place);
-- Otimiza leaderboard queries
```

### Query Monitoring

```javascript
if (process.env.LOG_LEVEL === 'debug') {
  console.log('Query executed', { text, duration, rows });
}
```

---

## Troubleshooting

### "Connection refused - Could not connect to database"

```bash
# Verifique se PostgreSQL está rodando
docker-compose ps

# Ou localmente:
psql -U champy_user -d champy_championship

# Se usar Docker, veja logs:
docker-compose logs postgres
```

### "Invalid token" ao fazer requests

```bash
# 1. Faça login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@champy.local","password":"..."}'

# 2. Use o token retornado
curl -H "Authorization: Bearer <token>" \
  http://localhost:5000/api/teams
```

### WebSocket não conecta

```javascript
// Verifique CORS em server.js:
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN, // deve ser http://localhost:3000
    credentials: true,
  },
});
```

---

## Recursos Úteis

- [Express.js Docs](https://expressjs.com/)
- [PostgreSQL Docs](https://www.postgresql.org/docs/)
- [Socket.io Docs](https://socket.io/docs/)
- [JWT.io](https://jwt.io/)

---

**Dúvidas? Abra uma issue ou discussion no GitHub!**
