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

Sobe o app Express de verdade (`src/app.js`, sem HTTP nem WebSocket — o
`supertest` fala direto com ele) contra um banco Postgres **real**, chamado
`champy_championship_test`. É a versão automatizada do
`smoke-test-results.ps1`: mesmo cenário, mas validado com `npm test` em vez
de exigir o backend de pé numa outra janela.

Por que precisa de banco de verdade e não de mock: o que mais importa neste
projeto é o trigger do Postgres (`recalculate_placements` com `RANK()`,
tratamento de empate e DNF) — isso só existe dentro do banco, não tem como
simular com um mock de `pg` sem reescrever a lógica em JS e testar outra
coisa.

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

- Só `resultController` e `heatController` têm teste de verdade. `auth`,
  `championships`, `teams`, `workouts` (CRUD básico) e `leaderboard` ainda
  não têm — cobrem o caminho mais simples e não são o diferencial do
  projeto, mas idealmente entrariam também.
- Não testa o broadcast do WebSocket (precisaria de um cliente
  `socket.io-client` dentro do teste, ouvindo o evento — dá pra fazer, não
  foi feito ainda).
- `jest.config.js` roda tudo em série (`maxWorkers: 1`) porque as suítes de
  integração ainda compartilham o mesmo banco de teste; se crescer, vale
  isolar por schema ou por transação por teste.
