-- migrations/009-timestamptz-for-instants.sql
-- Converte para TIMESTAMPTZ as colunas que marcam um INSTANTE.
--
-- O BUG
-- O histórico de um resultado mostrava "22/09/2026, 13:12:05" para um
-- lançamento que aconteceu às 10:12 da manhã, horário de Brasília. Três
-- horas adiantado, e o caminho é este:
--
--   1. changed_at é TIMESTAMP (sem fuso) com DEFAULT CURRENT_TIMESTAMP, ou
--      seja, quem preenche é o relógio do servidor Postgres.
--   2. O container do Postgres roda em UTC (a imagem oficial sobe assim e o
--      docker-compose não define TZ). Às 10:12 de Brasília ele grava o
--      número 13:12.
--   3. O driver pg lê uma coluna sem fuso interpretando os dígitos no fuso
--      LOCAL DO PROCESSO NODE — verificado com pg-types 2.2.0. Rodando o
--      backend no Windows em UTC-3, "13:12" vira 13:12 de Brasília.
--   4. O frontend faz toLocaleString('pt-BR') e exibe 13:12.
--
-- O número atravessa a pilha inteira sem nunca ser convertido: o fuso de
-- origem some no passo 1 e um fuso diferente é assumido no passo 3. Não é
-- erro de formatação na tela — é o tipo da coluna sendo o errado.
--
-- Pior que estar errado é ser instável: hoje o backend roda no Windows
-- (UTC-3); rodando dentro do container ou hospedado (ambos UTC), o MESMO
-- dado passa a ser exibido de outro jeito, sem ninguém mudar uma linha.
-- Para um log de auditoria que existe justamente para responder "quem
-- mudou o quê e quando" numa contestação, isso é inaceitável.
--
-- A CORREÇÃO
-- TIMESTAMPTZ guarda o instante absoluto, não dígitos soltos: o Postgres
-- normaliza na escrita e o driver devolve um Date correto seja qual for o
-- fuso de quem lê. O frontend não muda — passa a receber o instante certo.
--
-- O `USING x AT TIME ZONE 'UTC'` diz ao Postgres como interpretar o que já
-- está gravado. 'UTC' é o valor certo aqui porque TODAS essas colunas são
-- preenchidas por CURRENT_TIMESTAMP do próprio servidor, que sempre rodou
-- em UTC — nunca houve um período com outro fuso para desencontrar os
-- dados históricos.
--
-- O QUE NÃO ENTRA, E POR QUÊ
-- heats.scheduled_time continua TIMESTAMP sem fuso, de propósito. Ali o
-- valor não é um instante, é um horário de parede: "a bateria começa às
-- 08:00" quer dizer 08:00 no relógio do box, e é assim que precisa ser
-- lido e exibido, independentemente de onde o servidor ou o espectador
-- estejam. Converter aquela coluna reintroduziria o bug de 07:00 virar
-- 04:00 que já foi corrigido em frontend/src/lib/format.ts. Mesma razão
-- para championships.date (DATE) e championships.start_time (TIME).

BEGIN;

ALTER TABLE users
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE championships
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE categories
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE teams
  ALTER COLUMN registered_at TYPE TIMESTAMPTZ USING registered_at AT TIME ZONE 'UTC';

ALTER TABLE workouts
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE workout_variants
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- heats: só os carimbos de criação/alteração da LINHA. scheduled_time fica
-- de fora (ver explicação acima).
ALTER TABLE heats
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE heat_teams
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE results
  ALTER COLUMN recorded_at TYPE TIMESTAMPTZ USING recorded_at AT TIME ZONE 'UTC';

ALTER TABLE team_standings
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE result_audit_log
  ALTER COLUMN changed_at TYPE TIMESTAMPTZ USING changed_at AT TIME ZONE 'UTC';

COMMIT;
