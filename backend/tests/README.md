# Testes automatizados

Duas camadas, propósitos diferentes:

## `tests/unit/`

Testa funções puras — sem banco, sem HTTP, sem Docker. Rodam em milissegundos:

```bash
npx jest tests/unit
```

Cobre: `validateScoreShape` (regra da constraint `results_value_or_dnf`),
`distributeTeams` (round-robin das baterias) e `ALLOWED_SCORING_TYPES`
(validação do `scoring_type`). Essas funções são exportadas dos respectivos
controllers só para isso — não mudam de comportamento fora dos testes.

## `tests/integration/`

Sobe o app Express de verdade contra um banco Postgres **real**, chamado
`champy_championship_test`.

- `auth.test.js`, `championships.test.js`, `teams.test.js`, `workouts.test.js`,
  `heats.test.js`, `leaderboard.test.js`, `results.test.js` falam com
  `src/app.js` via `supertest`, sem precisar de servidor HTTP nem de WebSocket.
- `websocket.test.js` é diferente dos outros: sobe um `http.createServer(app)`
  de verdade com Socket.io ligado (via `src/socket.js`) e conecta um cliente
  `socket.io-client` real, porque `supertest` sozinho nunca chama
  `server.listen` — sem servidor escutando numa porta não existe conexão de
  socket para testar.

`results.test.js` é a versão automatizada do antigo `smoke-test-results.ps1`
(mesmo cenário — 4 equipes, empate, DNF, correção, remoção — validado com
`npm test` em vez de exigir o backend de pé numa outra janela).

Por que precisa de banco de verdade e não de mock: o que mais importa neste
projeto é o trigger do Postgres (`recalculate_placements` com `RANK()`,
tratamento de empate e DNF) — isso só existe dentro do banco, não tem como
simular com um mock de `pg` sem reescrever a lógica em JS e testar outra
coisa. Pelo mesmo motivo, os testes de validação com Joi (`middleware/validate.js`)
também rodam pela rota real (supertest), não chamando o schema isolado: o que
importa não é só "o Joi rejeita isso", é "a rota devolve 400 antes de gastar
uma query no banco".

### Configuração (uma vez só)

1. Suba o Postgres (o mesmo do `docker-compose.yml`, já rodando pro
   desenvolvimento):

   ```powershell
   docker compose up -d postgres
   ```

2. Crie o banco de teste (é só mais um banco dentro do mesmo container —
   não sobe nada novo):

   ```powershell
   docker compose exec postgres psql -U champy_user -d champy_championship -c "CREATE DATABASE champy_championship_test OWNER champy_user;"
   ```

3. Rode as migrations nesse banco novo (mesmo comando de sempre, trocando o
   nome do banco):

   ```powershell
   docker compose cp backend/migrations/. postgres:/tmp/migrations
   docker compose exec postgres sh -c 'for f in /tmp/migrations/*.sql; do psql -U champy_user -d champy_championship_test -f "$f"; done'
   ```

4. Copie `.env.test.example` para `.env.test` (a senha já bate com o
   `docker-compose.yml`; ajuste só se você mudou algo lá):

   ```powershell
   cd backend
   copy .env.test.example .env.test
   ```

### Rodando

```powershell
npm test
```

Roda unit + integration juntos. Os testes de integração criam um
campeonato próprio (`Jest Championship`) e apagam ele no `afterAll` — não
tocam nos dados que você já tem no banco de desenvolvimento, porque usam
um banco separado.

### CI

`.github/workflows/backend-tests.yml` roda esta suíte inteira a cada push e
pull request pra `main`: sobe um Postgres 16 como service container, aplica
as três migrations na ordem, escreve o `.env.test` do runner e roda
`npm test`. Validado localmente antes de subir — apliquei as migrations do
zero num banco novo e rodei a suíte inteira contra ele, simulando exatamente
os passos do workflow, antes de confiar que o YAML ia funcionar de verdade no
GitHub.

### O que ainda falta aqui (sendo honesto)

- `jest.config.js` roda tudo em série (`maxWorkers: 1`) porque as suítes de
  integração ainda compartilham o mesmo banco de teste; se crescer, vale
  isolar por schema ou por transação por teste.
- Cobertura de código (`--coverage`) não é medida — não tem como afirmar
  "X% coberto", só que os fluxos principais de cada controller têm teste.
