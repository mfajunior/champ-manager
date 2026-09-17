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
- `results-history.test.js` cobre o log de auditoria (migration 004): cria um
  resultado, corrige, apaga, e confere que cada ação gera uma entrada própria
  (`created`/`updated`/`deleted`) sem apagar as anteriores — inclusive que a
  entrada `deleted` preserva o `raw_value` antigo mesmo com `result_id` zerado
  pela FK.
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
   nome do banco — isso inclui a `004-result-audit-log.sql`, então se você já
   tinha o banco de teste criado de antes, rode este passo de novo para pegar
   a tabela nova):

   ```powershell
   docker compose cp backend/migrations/. postgres:/tmp/migrations
   docker compose exec postgres sh -c 'for f in /tmp/migrations/*.sql; do psql -U champy_user -d champy_championship_test -f "$f"; done'
   ```

   O mesmo vale para o banco de **desenvolvimento** (`champy_championship`,
   sem o `_test`): rode o loop acima trocando o nome do banco, ou aplique só
   a `004-result-audit-log.sql` isoladamente — ela usa `CREATE TABLE IF NOT
   EXISTS`, então rodar de novo por engano não quebra nada.

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

### Cobertura de código

```powershell
npm run test:coverage
```

Gera relatório em `coverage/` (HTML em `coverage/lcov-report/index.html`) e
imprime o resumo no terminal. Não há limite mínimo configurado (nenhum
`coverageThreshold` no `jest.config.js`) — rodar isso é só para saber onde
faltam testes, não é gate de CI. Última medição: ~85% de statements/lines,
~70% de branches, ~91% de funções, no geral. Os pontos mais fracos são
`teamController.js` (75%) e `workoutController.js` (79%) — vale revisar os
`Uncovered Line #s` do relatório antes de mexer nesses dois arquivos.

### Paralelismo (`maxWorkers`)

Cada arquivo de teste de integração cria seu próprio campeonato (nome e
email únicos por timestamp+random) e só enxerga linhas com o
`championship_id` dele — arquivos diferentes nunca disputam a mesma linha.
Por isso `jest.config.js` não fixa `maxWorkers`: o Jest decide sozinho com
base nos núcleos disponíveis, e isso foi validado rodando a suíte várias
vezes seguidas (localmente e seria o padrão do runner de CI) sem nenhuma
falha intermitente. O que continua garantido em série é dentro do MESMO
arquivo — testes que leem/escrevem o mesmo campeonato — porque o Jest
sempre roda os testes de um arquivo em ordem, nunca em paralelo entre si.

### O que ainda falta aqui (sendo honesto)

- Sem teste de carga/concorrência: dois `POST /api/results` simultâneos na
  mesma raia não têm cenário de teste dedicado.
- `auth.js` (middleware) está em 71% de cobertura — os branches de token
  expirado/malformado não têm teste próprio ainda.
