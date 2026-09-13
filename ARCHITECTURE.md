# 🏆 Champy Clone - Arquitetura e Decisões

## 1. Visão Geral do Sistema

```
┌─────────────────────────────────────────────────────┐
│              ATLETAS (Público)                      │
│         Leaderboard Read-Only (SPA)                │
│          ↓ WebSocket (escuta mudanças)             │
├─────────────────────────────────────────────────────┤
│            OPERADORES (Autenticados)               │
│   Painel Web: Cadastro + Súmulas + Gestão         │
└─────────────────────────────────────────────────────┘
           ↓ HTTP + WebSocket
┌─────────────────────────────────────────────────────┐
│        Backend Node.js + Express                   │
│   - Autenticação (JWT)                            │
│   - CRUD Equipes, Provas, Baterias               │
│   - Cálculo de Pontuação Linear                   │
│   - WebSocket (Broadcast Leaderboard)            │
└─────────────────────────────────────────────────────┘
           ↓ SQL
┌─────────────────────────────────────────────────────┐
│         PostgreSQL                                 │
│   Equipes, Provas, Baterias, Resultados          │
└─────────────────────────────────────────────────────┘
```

## 2. Schema do Banco de Dados

### Entidades Principais

```sql
-- OPERADORES (Usuários do sistema)
TABLE users
  id SERIAL PRIMARY KEY
  email VARCHAR(255) UNIQUE NOT NULL
  password_hash VARCHAR(255) NOT NULL
  name VARCHAR(255)
  created_at TIMESTAMP DEFAULT NOW()

-- CAMPEONATO (Uma única instância por vez)
TABLE championships
  id SERIAL PRIMARY KEY
  name VARCHAR(255) NOT NULL
  date DATE NOT NULL
  location VARCHAR(255)
  created_by INT REFERENCES users(id)
  created_at TIMESTAMP DEFAULT NOW()

-- CATEGORIAS (Iniciante M/F, Scale M/F, RX Misto)
TABLE categories
  id SERIAL PRIMARY KEY
  championship_id INT REFERENCES championships(id) ON DELETE CASCADE
  name VARCHAR(50) NOT NULL -- "Iniciante M", "Iniciante F", "Scale M", "Scale F", "RX Misto"
  gender VARCHAR(20) -- "masculino", "feminino", "misto"
  level VARCHAR(20) -- "iniciante", "scale", "rx"
  UNIQUE(championship_id, name)

-- EQUIPES
TABLE teams
  id SERIAL PRIMARY KEY
  championship_id INT REFERENCES championships(id) ON DELETE CASCADE
  name VARCHAR(255) NOT NULL
  category_id INT REFERENCES categories(id) ON DELETE CASCADE
  registered_at TIMESTAMP DEFAULT NOW()
  -- Índice composto para rápido acesso
  UNIQUE(championship_id, name)

-- PROVAS/WORKOUTS
TABLE workouts
  id SERIAL PRIMARY KEY
  championship_id INT REFERENCES championships(id) ON DELETE CASCADE
  workout_number INT NOT NULL -- WOD 1, WOD 2, etc
  description TEXT -- "5 rounds: 10 thrusters, 10 pull-ups"
  type VARCHAR(50) -- "for_time", "amrap", "chipper", etc
  created_at TIMESTAMP DEFAULT NOW()
  UNIQUE(championship_id, workout_number)

-- BATERIAS (Heat/Grupos para cada prova)
TABLE heats
  id SERIAL PRIMARY KEY
  workout_id INT REFERENCES workouts(id) ON DELETE CASCADE
  heat_number INT NOT NULL -- Heat 1, 2, 3...
  category_id INT REFERENCES categories(id) ON DELETE CASCADE
  scheduled_time TIMESTAMP
  UNIQUE(workout_id, heat_number, category_id)

-- TIMES na Bateria (Associação)
TABLE heat_teams
  id SERIAL PRIMARY KEY
  heat_id INT REFERENCES heats(id) ON DELETE CASCADE
  team_id INT REFERENCES teams(id) ON DELETE CASCADE
  lane_number INT -- Número de pista/posição na bateria
  UNIQUE(heat_id, team_id)

-- RESULTADOS (O que foi alcançado em cada prova)
TABLE results
  id SERIAL PRIMARY KEY
  heat_team_id INT REFERENCES heat_teams(id) ON DELETE CASCADE
  place INT -- Colocação: 1º, 2º, 3º...
  score INT -- Pontos (igual à colocação no sistema linear)
  time_or_reps VARCHAR(100) -- "12:34" ou "45 reps" (info visual)
  notes TEXT -- Observações ("DNF", "No-Rep", etc)
  recorded_at TIMESTAMP DEFAULT NOW()
  UNIQUE(heat_team_id) -- Uma única posição por time/prova

-- RANKINGS AGREGADOS (Cache para performance)
TABLE team_standings
  id SERIAL PRIMARY KEY
  championship_id INT REFERENCES championships(id) ON DELETE CASCADE
  team_id INT REFERENCES teams(id) ON DELETE CASCADE
  total_score INT DEFAULT 0 -- Soma de todos os places
  place INT -- Colocação final
  workouts_completed INT DEFAULT 0
  updated_at TIMESTAMP DEFAULT NOW()
  UNIQUE(championship_id, team_id)
```

### Índices para Performance

```sql
-- Queries de leaderboard
CREATE INDEX idx_team_standings_championship_place 
  ON team_standings(championship_id, place);

-- Queries de uma equipe em competição
CREATE INDEX idx_results_team_championship 
  ON results(team_id, championship_id);

-- Queries de uma bateria
CREATE INDEX idx_heat_teams_heat 
  ON heat_teams(heat_id);

-- Queries de workouts por campeonato
CREATE INDEX idx_workouts_championship 
  ON workouts(championship_id);
```

## 3. Fluxo de Dados

### Criação de Campeonato (Operador)
```
1. Operador cria campeonato (data, local, nome)
2. Sistema cria 5 categorias:
   - Iniciante Masculino
   - Iniciante Feminino
   - Scale Masculino
   - Scale Feminino
   - RX Misto
3. Operador cadastra equipes (nome + categoria)
```

### Adição de Prova (Operador)
```
1. Operador cria WOD (descrição, tipo)
2. Sistema gera automaticamente heats por categoria
3. Sistema distribui equipes entre heats (round-robin ou manual)
4. Operador confirma distribuição
```

### Lançamento de Resultados (Operador)
```
1. Durante a bateria: operador digita colocação (1º, 2º, 3º...)
2. Sistema recalcula:
   - Pontuação individual (place = score)
   - Total acumulado da equipe
   - Novo ranking agregado
3. WebSocket notifica leaderboard público
4. Leaderboard atualiza em tempo real
```

## 4. Sistema de Pontuação

### Fórmula Linear (CrossFit Open Style)
```
Para cada WOD:
  Pontos = Colocação obtida (1º lugar = 1 ponto, 2º = 2, etc)

Ranking Final:
  Total Score = Soma de todos os pontos em todos os WODs
  Vencedor = Menor score (menos pontos acumulados)
```

### Exemplo Prático
```
Campeonato com 3 WODs, Categoria Scale Feminino (4 equipes):

WOD 1:
  Equipe A: 1º lugar → 1 ponto
  Equipe B: 2º lugar → 2 pontos
  Equipe C: 3º lugar → 3 pontos
  Equipe D: 4º lugar → 4 pontos

WOD 2:
  Equipe A: 2º lugar → 2 pontos
  Equipe B: 1º lugar → 1 ponto
  Equipe C: 4º lugar → 4 pontos
  Equipe D: 3º lugar → 3 pontos

WOD 3:
  Equipe A: 3º lugar → 3 pontos
  Equipe B: 4º lugar → 4 pontos
  Equipe C: 2º lugar → 2 pontos
  Equipe D: 1º lugar → 1 ponto

RANKING FINAL (menor score vence):
1. Equipe A: 1+2+3 = 6 pontos ✅ VENCEDOR
2. Equipe B: 2+1+4 = 7 pontos
3. Equipe D: 4+3+1 = 8 pontos
4. Equipe C: 3+4+2 = 9 pontos
```

## 5. Estrutura de Pastas (Node.js + React)

```
champy-clone/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   │   ├── authController.js
│   │   │   ├── teamController.js
│   │   │   ├── workoutController.js
│   │   │   ├── heatController.js
│   │   │   └── resultController.js
│   │   ├── models/
│   │   │   ├── User.js
│   │   │   ├── Championship.js
│   │   │   ├── Team.js
│   │   │   ├── Workout.js
│   │   │   ├── Heat.js
│   │   │   ├── Result.js
│   │   │   └── TeamStanding.js
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── teams.js
│   │   │   ├── workouts.js
│   │   │   ├── heats.js
│   │   │   ├── results.js
│   │   │   └── leaderboard.js
│   │   ├── middleware/
│   │   │   ├── auth.js (JWT validation)
│   │   │   └── errorHandler.js
│   │   ├── config/
│   │   │   └── database.js (Pool PostgreSQL)
│   │   ├── websocket/
│   │   │   └── leaderboard.js (Socket.io events)
│   │   └── app.js
│   ├── migrations/
│   │   ├── 001_initial_schema.sql
│   │   └── 002_indexes.sql
│   ├── package.json
│   ├── .env.example
│   └── server.js
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Teams.tsx (CRUD equipes)
│   │   │   ├── Workouts.tsx (Gerenciar provas)
│   │   │   ├── Heats.tsx (Distribuir baterias)
│   │   │   └── ResultsEntry.tsx (Lançar súmulas)
│   │   ├── components/
│   │   │   ├── AuthGuard.tsx
│   │   │   ├── Leaderboard.tsx
│   │   │   └── ResultForm.tsx
│   │   ├── hooks/
│   │   │   └── useWebSocket.ts
│   │   ├── App.tsx
│   │   └── index.tsx
│   ├── package.json
│   └── .env.example
│
├── leaderboard/ (Página pública - SPA simples)
│   ├── src/
│   │   ├── pages/
│   │   │   └── Leaderboard.tsx
│   │   ├── hooks/
│   │   │   └── useWebSocket.ts
│   │   └── App.tsx
│   └── package.json
│
├── README.md (Principal)
├── ARCHITECTURE.md (Este arquivo)
└── docker-compose.yml (Opcional: local dev)
```

## 6. Tecnologias por Camada

| Camada | Tecnologia | Razão |
|--------|-----------|-------|
| **Backend** | Node.js + Express | Leve, rápido, bom ecossistema |
| **Autenticação** | JWT (jsonwebtoken) | Stateless, seguro, padrão |
| **Real-time** | Socket.io | Fácil de implementar, funciona bem com Express |
| **Banco de dados** | PostgreSQL | Relacional, confiável, array/JSON nativo |
| **ORM** | Knex.js | Lightweight, bom para migrations |
| **Frontend** | React + TypeScript | Type-safe, familiar pro seu stack |
| **Validação** | Joi/Zod | Validação de entrada segura |
| **Segurança** | bcryptjs, helmet, cors | Best practices |

## 7. Decisões Arquiteturais Importantes

### ✅ Por quê PostgreSQL em vez de MongoDB?
- Relações entre equipes → provas → resultados são complexas
- Cálculos de agregação (soma de pontos) são mais eficientes em SQL
- UNIQUE constraints garantem integridade (uma equipe não aparece 2x na mesma bateria)
- JSON nativo do PG se você precisar flexibilidade depois

### ✅ Por quê Socket.io em vez de polling?
- Até 50 usuários simultâneos = WebSocket é apropriado
- Leaderboard fica "vivo" sem delay
- Experiência muito melhor para público acompanhando

### ✅ Por quê table `team_standings` separada?
- Leaderboard é consultado frequentemente (toda mudança de resultado)
- Recalcular soma todas as vezes é ineficiente
- Cache desnormalizado + trigger no banco mantém sincronizado

### ✅ Autenticação only para operadores
- Leaderboard é pública → nenhuma senha necessária
- JWT protege os endpoints de escrita (cadastro, resultado)
- Simples + seguro para seu escopo

## 8. Segurança Implementada

```
[ ] Senhas hasheadas com bcryptjs
[ ] JWT com expiração (1 dia para operador)
[ ] CORS restrito ao seu domínio
[ ] Helmet.js (headers de segurança)
[ ] SQL injection prevenido (queries parametrizadas com Knex)
[ ] Rate limiting nas rotas de auth
[ ] Validação de entrada em todos os endpoints
[ ] Logs de auditoria (quem fez cada lançamento de resultado)
```

## 9. Próximos Passos

1. **Criar repositório GitHub** com estrutura
2. **Implementar backend** (migrations + CRUD básico)
3. **Implementar painel operacional** (React)
4. **Integrar WebSocket** no leaderboard
5. **Deploy** (Railway/DigitalOcean/Vercel)
6. **Documentar no README** decisões e como rodar
