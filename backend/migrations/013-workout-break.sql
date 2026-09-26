-- migrations/013-workout-break.sql
-- Intervalo (almoço, premiação, o que for) entre uma prova e a seguinte.
--
-- POR QUE FICA NA PROVA, E NÃO NUM HORÁRIO DO DIA
--
-- Dentro de uma prova, as baterias misturam categorias de propósito — é assim
-- que se evita raia vazia (ver chunkIntoHeats). Abrir um intervalo no meio de
-- uma prova separaria categorias que deveriam competir em sequência.
--
-- Na virada de uma prova para a outra isso não acontece por construção. Por
-- isso o intervalo é um atributo DA PROVA: "depois da prova 2, uma hora". Não
-- existe intervalo "às 12:00" no modelo, e não existe intervalo no meio de uma
-- prova — as duas coisas deixam de ser possíveis em vez de precisarem ser
-- proibidas.
--
-- NÃO HÁ REGRA DE ATRASO
--
-- O intervalo é a própria folga do dia: o organizador configura uma hora e,
-- se a manhã atrasou, faz trinta minutos e recupera. Ancorar o almoço num
-- horário fixo exigiria decidir o que fazer quando a prova anterior invade o
-- horário — encurtar? empurrar? — e cada uma dessas decisões seria uma regra
-- a mais para acertar, resolvendo um problema que a organização já resolve
-- sozinha no dia.
--
-- Coluna em workouts, não tabela nova: é 1:1 com a prova e não varia por
-- categoria (ao contrário do corte, que varia e por isso tem tabela própria).

ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS break_after_seconds INTEGER NULL;

ALTER TABLE workouts DROP CONSTRAINT IF EXISTS chk_break_after_positive;
ALTER TABLE workouts ADD CONSTRAINT chk_break_after_positive
  CHECK (break_after_seconds IS NULL OR break_after_seconds > 0);
