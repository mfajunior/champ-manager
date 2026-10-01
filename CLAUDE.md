# ScoreUp (champy-manager)

Sistema de gestão de campeonatos de CrossFit, **com cliente real usando em
evento**. Erro aqui não é bug de portfólio: é campeonato parado com atleta
esperando. Prefira a solução conservadora.

Responda sempre em **português**.

## Como me ajudar

- Seja direto sobre o que está ruim no código ou na documentação. Prefiro
  crítica útil a elogio.
- Sou iniciante em Git e boas práticas de repositório. Explique o **porquê**,
  não só o comando.
- Nos comentários e na documentação, explique as **decisões de arquitetura**,
  não só o "como rodar".
- Não afirme que eu domino tecnologia que eu não usei.

## Regras invioláveis

**Testes.** Rode `cd backend && npm test` depois de cada alteração que toca o
backend. Se quebrar, pare e me diga — **não ajuste o teste para passar**.

**Migrations.** Mudança de schema só via **nova migration numerada** (016 em
diante). Nunca editando uma migration existente: as antigas já rodaram no
banco do cliente, e editar o arquivo não desfaz o que já foi aplicado.

**Os dois bancos.** Toda migration precisa ser aplicada nos dois:

```
npm run migrate        # banco de desenvolvimento (.env)
npm run migrate:test   # banco de teste (.env.test), usado pelo npm test
```

Esquecer o segundo faz a suíte inteira falhar com "column ... does not exist",
e o erro aparece em testes que não têm nada a ver com a mudança.

**Branch.** Trabalhe numa branch nova a partir de `main`. O cliente acessa o
ambiente que sai da `main` — não commite direto nela.

**Segurança antes de qualquer commit.** Me alerte sobre `.env`, credenciais em
fluxos n8n exportados e chaves de API. Confira que nada disso entrou no diff.

**Atribuição.** Não adicione linhas `Co-Authored-By` nem `Claude-Session` nas
mensagens de commit. Já está desligado em `.claude/settings.json`.

**Formatação.** Não rode `prettier` ou `oxlint --fix` em arquivo que você não
está alterando por outro motivo.

## Regras do modelo de pontuação

- **Não renomeie** nenhuma tabela, coluna, view, função, trigger, enum ou
  constraint existente.
- **Reutilize** as tabelas que já existem em vez de criar paralelas.
- A regra de pontuação fica **centralizada no banco**. Backend e frontend não
  duplicam o cálculo — eles leem `place` e `total_points`, que os triggers já
  deixaram certos.

## Stack

Backend: Node + Express 4, PostgreSQL 16 em SQL puro (sem ORM), Socket.io,
JWT + bcryptjs, Joi, Helmet. Testes com Jest + Supertest contra Postgres real.

Frontend: React 19 + TypeScript + Vite + Tailwind 3, TanStack Query,
React Router 7.

## Armadilhas que já custaram tempo

**Porta do frontend é 3000**, não 5173.

**O serviço do Docker chama `postgres`** (container `champy-db`), não `db`.
`docker compose up -d postgres`.

**Fuso horário.** `backend/src/server.js` fixa `process.env.TZ` em
`America/São_Paulo` na primeira linha, antes de qualquer `require`.
`heats.scheduled_time` é `TIMESTAMP` **sem fuso de propósito** — é horário de
parede, não instante. O driver `pg` interpreta esse tipo no fuso do processo
Node, então o horário exibido mudaria conforme onde o backend roda. Por isso:
toda consulta devolve o campo via `to_char(scheduled_time,
'YYYY-MM-DD"T"HH24:MI:SS')`, e o frontend formata **sem construir `Date`**
(ver `frontend/src/lib/format.ts`).

**Prova com duas pontuações.** Uma raia pode ter duas linhas em `results`
(`score_index` 1 e 2), com colocações independentes. Qualquer `JOIN results`
precisa levar isso em conta: um `LEFT JOIN` simples duplica a equipe.

**O tipo de pontuação é da LINHA, não da prova.** Numa prova de duas
pontuações a segunda pode ser `reps` com a primeira em `time`. As consultas
resolvem isso com
`CASE WHEN r.score_index = 2 THEN w.scoring_type_2 ELSE w.scoring_type END`.
Não devolva um `scoring_type` único por prova para o cliente formatar.

**Triggers de constraint são `DEFERRABLE INITIALLY DEFERRED`.** A validação e o
recálculo acontecem no COMMIT, que é o único momento consistente depois de
cascatas de vários níveis. `pg_trigger_depth()` **não** aumenta em cascata de
DELETE — isso foi testado e a suposição contrária já gerou bug.
