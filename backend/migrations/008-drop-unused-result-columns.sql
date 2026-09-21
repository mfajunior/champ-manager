-- migrations/008-drop-unused-result-columns.sql
-- Remove results.score e results.notes, herdadas da migration 001 e sem uso.
--
-- CONTEXTO
-- As duas nasceram no modelo original de resultado, onde o organizador
-- digitava a colocação e anotava o resto em texto livre:
--   score  INTEGER  -- "Pontos (normalmente = place)"
--   notes  TEXT     -- '"DNF" (Did Not Finish), "No-Rep", etc'
-- A migration 003 substituiu esse modelo: o desempenho bruto virou
-- raw_value NUMERIC, "não terminou" virou a coluna booleana
-- did_not_finish, e o place passou a ser calculado por
-- recalculate_placements em vez de digitado. time_or_reps, a terceira
-- coluna daquele modelo, foi dropada na própria 003 — score e notes
-- ficaram para trás.
--
-- Hoje nenhuma query as lê ou escreve: nem os controllers, nem os scripts,
-- nem os testes, nem as funções recalculate_placements /
-- recalculate_standings / trigger_result_changed (verificado por busca em
-- backend/src, backend/scripts, backend/tests e nas migrations anteriores).
--
-- DROP COLUMN é irreversível: os dados de uma coluna dropada não voltam.
-- Por isso o bloco abaixo confere antes e ABORTA a migration inteira se
-- encontrar qualquer valor preenchido — nesse caso nada é dropado, a
-- transação inteira volta atrás, e quem estiver migrando decide o que fazer
-- com esses dados antes de tentar de novo. O caso esperado é contagem zero:
-- a versão do código que escrevia nessas colunas foi substituída na
-- migration 003.

BEGIN;

DO $$
DECLARE
  v_has_score  boolean;
  v_has_notes  boolean;
  v_score_rows bigint := 0;
  v_notes_rows bigint := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'results' AND column_name = 'score'
  ) INTO v_has_score;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'results' AND column_name = 'notes'
  ) INTO v_has_notes;

  -- EXECUTE (e não SELECT direto): num banco onde a coluna já não existe,
  -- uma referência direta a ela quebraria o bloco no planejamento, antes
  -- mesmo do IF ter chance de evitar a consulta.
  IF v_has_score THEN
    EXECUTE 'SELECT count(*) FROM results WHERE score IS NOT NULL' INTO v_score_rows;
  END IF;

  IF v_has_notes THEN
    EXECUTE 'SELECT count(*) FROM results WHERE notes IS NOT NULL' INTO v_notes_rows;
  END IF;

  IF v_score_rows > 0 OR v_notes_rows > 0 THEN
    RAISE EXCEPTION
      'Migration 008 abortada: results tem % linha(s) com score preenchido e % com notes. Exporte esses dados antes de dropar as colunas.',
      v_score_rows, v_notes_rows;
  END IF;
END $$;

ALTER TABLE results DROP COLUMN IF EXISTS score;
ALTER TABLE results DROP COLUMN IF EXISTS notes;

COMMIT;
