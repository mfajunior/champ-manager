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
  `leaderboard.test.js`, `results.test.js` falam com `src/app.js` via
  `supertest`, sem precisar de servidor HTTP nem de WebSocket.
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

### O que ainda falta aqui (sendo honesto)

- `heatController.generate` (a geração de baterias em si, com transação e a
  trava contra apagar resultados existentes) só tem teste unitário da função
  pura `distributeTeams` — o fluxo completo do endpoint contra banco real
  ainda não tem teste de integração dedicado (é exercitado indiretamente pelo
  `beforeAll` de `leaderboard.test.js` e `websocket.test.js`, mas sem
  asserções próprias sobre ele).
- `workoutController.update` tem um aviso (`meta.warning`) quando o
  `scoring_type` muda numa prova que já tem resultados lançados — esse caso
  específico não está coberto, só o caminho sem resultados existentes.
- `jest.config.js` roda tudo em série (`maxWorkers: 1`) porque as suítes de
  integração ainda compartilham o mesmo banco de teste; se crescer, vale
  isolar por schema ou por transação por teste.
- Sem CI: os testes só rodam quando alguém lembra de rodar `npm test` local.
  Um GitHub Actions simples (subir Postgres em container, rodar migrations,
  `npm test`) fecharia esse gap — não foi feito ainda.
