# 🏗️ ScoreUp — Arquitetura

Este documento é a referência técnica do backend: schema atual do banco,
camadas da API e os fluxos principais. As decisões de projeto — **por quê**
PostgreSQL, por que `RANK()` num lugar e `ROW_NUMBER()` em outro, por que o
round-robin nas baterias — estão detalhadas no [README.md](./README.md),
seção "Por Quê Estas Escolhas?". Este arquivo não repete aquela discussão;
ele documenta o estado atual do sistema.

> Versão anterior deste arquivo descrevia o schema antes das migrations 002
> e 003 (sem `workout_variants`, sem `scoring_type`, com `place` digitado
> manualmente pelo operador). Ficou desatualizado por dias enquanto o backend
> mudava — reescrito para bater com o código de verdade.

---

## 1. Visão geral

```
┌───────────────────────────────────────────────────────────┐
│  PÚBLICO (sem login)                                       │
│  GET /api/leaderboard         + WebSocket (leaderboard_updated) │
├───────────────────────────────────────────────────────────┤
│  OPERADOR (JWT)                                             │
│  CRUD de campeonatos, equipes, provas, baterias, resultados │
└───────────────────────────────────────────────────────────┘
                          │ HTTP + WebSocket
┌───────────────────────────────────────────────────────────┐
│  Backend — Node.js + Express (backend/src)                 │
│                                                              │
│  helmet + cors                                              │
│    → rate limiting (express-rate-limit, por IP)             │
│      → JWT (middleware/auth.js, nas rotas protegidas)       │
│        → Joi (middleware/validate.js, nas rotas de escrita) │
│          → controller (regra de negócio + acesso ao banco)  │
│                                                              │
│  server.js sobe o HTTP server + Socket.io (src/socket.js)   │
└───────────────────────────────────────────────────────────┘
                          │ SQL (pg, queries parametrizadas)
┌───────────────────────────────────────────────────────────┐
│  PostgreSQL 16 (Docker)                                     │
│  10 tabelas + triggers PL/pgSQL para recálculo automático   │
└───────────────────────────────────────────────────────────┘
```

Frontend: ainda não iniciado. Todo o backend abaixo é consumível hoje via
Postman/Insomnia ou pelo `smoke-test-results.ps1` na raiz do repo.

---

## 2. Camadas de validação (da entrada até o banco)

Um request de escrita passa por até três camadas antes de gravar algo,
cada uma pega um tipo de erro diferente:

1. **Rate limiting** (`middleware/rateLimiter.js`) — `authLimiter` (10
   requisições / 15 min) na rota de login, `apiLimiter` (300 /
   15 min) no resto de `/api`. Desligado quando `NODE_ENV=test`. (Não existe
   mais rota de registro público — só o operador já cadastrado consegue
   logar; ver seção sobre autenticação.)
2. **Joi** (`middleware/validate.js` + `validations/schemas.js`) — checa
   *forma*: campo obrigatório presente, tipo certo (número vs string), enum
   válido (`scoring_type` só pode ser `time`/`reps`/`load`). Roda antes do
   controller, então um corpo malformado nunca gasta uma query no banco.
   Cobre `auth`, `championships`, `teams` e `workouts`. **Não cobre `results`
   nem `heats`**: essas duas rotas têm validação própria em JS puro
   (`validateScoreShape` em `resultController.js`, checagem de `lanes_per_heat`
   em `heatController.js`) porque a regra ali já é testada por unidade
   (`tests/unit/`) e trocar por Joi não agregaria — é uma escolha deliberada,
   não um esquecimento.
3. **Controller + Postgres** — regra de negócio que só o banco sabe responder:
   "esse `category_id` existe?", "essa equipe já tem resultado nessa
   bateria?". Como última linha de defesa, o próprio schema tem `CHECK`
   constraints (`workouts_scoring_type_check`, `results_value_or_dnf`) que
   seguram um dado inválido mesmo que alguém escreva direto no banco,
   ignorando a API.

---

## 3. Schema do banco (pós migrations 001–003)

```
users
  id, email (unique), password_hash, name

championships
  id, name, date, location, is_active, created_by → users

categories                                    (5 por campeonato, fixas)
  id, championship_id → championships, name, gender, level
  UNIQUE(championship_id, name)

teams
  id, championship_id → championships, category_id → categories,
  name, registered_by → users
  UNIQUE(championship_id, category_id, name)   -- por categoria, não só por campeonato

workouts
  id, championship_id → championships, workout_number, name, type,
  scoring_type ('time'|'reps'|'load', default 'time'), status, description,
  created_by → users
  UNIQUE(championship_id, workout_number)
  CHECK (scoring_type IN ('time','reps','load'))

workout_variants                              (descrição por categoria)
  id, workout_id → workouts, category_id → categories,
  description, time_cap_seconds
  UNIQUE(workout_id, category_id)

heats
  id, workout_id → workouts, heat_number, category_id → categories,
  scheduled_time, status
  UNIQUE(workout_id, heat_number, category_id)

heat_teams                                    (equipe ↔ raia numa bateria)
  id, heat_id → heats, team_id → teams, lane_number
  UNIQUE(heat_id, team_id)

results
  id, heat_team_id → heat_teams (UNIQUE — 1 resultado por raia),
  place (calculado, nullable até o trigger rodar),
  raw_value NUMERIC(10,2) (tempo em segundos, reps, ou carga — nunca texto),
  did_not_finish BOOLEAN, recorded_by → users
  CHECK (results_value_or_dnf): raw_value XOR did_not_finish, nunca os dois
  nem nenhum dos dois

team_standings                                (cache — só leitura pela API)
  id, championship_id → championships, category_id → categories,
  team_id → teams, total_score, place, workouts_completed
  UNIQUE(championship_id, team_id)
```

Índices relevantes: `team_standings(championship_id, place)`,
`team_standings(category_id, place)`, `teams(category_id)`,
`heats(workout_id, category_id)` — todos criados para as queries que o
leaderboard e a geração de baterias realmente fazem, não especulativos.

### Funções e triggers PL/pgSQL

- `recalculate_placements(workout_id, category_id)` — usa `RANK()`, roda
  depois de qualquer INSERT/UPDATE/DELETE em `results` daquela prova+categoria.
- `recalculate_standings(championship_id)` — usa `ROW_NUMBER() PARTITION BY
  category_id`, refaz o pódio de todas as categorias do campeonato.
- `trigger_result_changed()` — dispara as duas funções acima em sequência, com
  uma trava (`pg_trigger_depth() > 1`) contra recursão infinita, porque
  `recalculate_placements` faz um `UPDATE` na própria tabela `results` que
  tem o trigger.

O detalhe de cada uma (por que `RANK` aqui e `ROW_NUMBER` ali, o bug de
recursão encontrado em teste) está no README, não repetido aqui.

---

## 4. Fluxos principais

**Criar campeonato** → `POST /api/championships` insere o campeonato e, no
mesmo request, as 5 categorias fixas (Iniciante M/F, Scale M/F, RX Misto) num
único INSERT multi-valores.

**Gerar baterias** → `POST /api/workouts/:workout_id/heats` recebe
`lanes_per_heat`, busca as equipes da categoria, distribui em baterias
balanceadas (round-robin) dentro de uma transação (`BEGIN`/`COMMIT`), com
trava contra apagar resultados já lançados sem `force: true`.

**Lançar resultado** → `POST /api/results` grava só `raw_value` ou
`did_not_finish`; o trigger calcula `place`; `resultController` relê a linha
(o `RETURNING` do INSERT original não veria o `place` novo, calculado depois
pelo trigger) e chama `broadcastLeaderboard`, que busca o standings fresco do
campeonato inteiro e emite `leaderboard_updated` via Socket.io para a sala
`championship:<id>`.

**Consultar leaderboard** → `GET /api/leaderboard?championship_id=&category_id=`
lê só `team_standings` (nunca escreve nela). Campeonato com equipes mas sem
nenhum resultado lançado devolve lista vazia com uma mensagem explicando o
motivo, não um erro.

---

## 5. Testes

Suíte Jest (`backend/tests/`) com dois níveis — unitário (funções puras, sem
banco) e integração (banco Postgres real, `champy_championship_test`),
incluindo um teste de integração que sobe um servidor HTTP real com
Socket.io para validar o broadcast do leaderboard fim a fim. Detalhes de como
rodar e o que ainda falta cobrir: [`backend/tests/README.md`](./backend/tests/README.md).

---

## 6. Segurança

- Senhas: `bcryptjs` (10 rounds).
- Sessão: JWT (`jsonwebtoken`), expiração 24h, payload mínimo (`id`, `email`,
  `name`).
- Segredos (`DB_PASSWORD`, `JWT_SECRET`) em `.env`, fora do controle de
  versão (`.gitignore`); `.env.example` documenta as chaves sem valores reais.
- `helmet` (headers HTTP) e `cors` restrito à origem configurada.
- Rate limiting por IP (`express-rate-limit`) — ver seção 2.
- Toda query ao Postgres é parametrizada (`pg` com `$1, $2...`), nunca
  concatenação de string — SQL injection não é uma superfície de ataque válida
  aqui.
- Mensagem de erro de login idêntica para "email não existe" e "senha
  errada" (401 `INVALID_CREDENTIALS`), para não vazar quais emails estão
  cadastrados.

**Ainda não implementado** (honesto, não é checklist de marketing): logs de
auditoria de quem lançou cada resultado (o campo `recorded_by` existe na
tabela, mas não há endpoint para consultar histórico), CI automatizado
rodando a suíte de testes a cada push, HTTPS/TLS (delegado ao ambiente de
deploy, que ainda não existe).

---

## 7. Próximos passos

1. Frontend React (painel do operador + leaderboard público) — 0% feito.
2. Deploy (Railway ou similar) com Postgres gerenciado.
3. CI (GitHub Actions): Postgres em container de serviço, rodar migrations,
   `npm test` a cada push/PR.
4. Teste de integração dedicado para `heatController.generate` (hoje só
   exercitado indiretamente por outros testes, sem asserções próprias sobre
   a distribuição balanceada nem sobre a trava de `force`).
