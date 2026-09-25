-- migrations/010-recalc-on-delete.sql
-- Recalcula o leaderboard quando baterias, provas ou equipes são apagadas.
--
-- O BUG
-- O placar era atualizado por um único caminho: o trigger trg_result_changed,
-- em results. Ele descobre QUAL prova recalcular subindo de results para
-- heat_teams e daí para heats e workouts:
--
--   SELECT w.championship_id, w.id, t.category_id
--     FROM heat_teams ht JOIN heats h ... WHERE ht.id = v_heat_team_id;
--
-- Isso funciona quando o resultado é apagado sozinho. Mas quando a BATERIA é
-- apagada, o cascade derruba heat_teams junto, e o trigger roda procurando uma
-- linha de heat_teams que já não existe: v_workout_id vem NULL, o IF não entra
-- e nada é recalculado.
--
-- Não é hipotético. heatController.generate faz exatamente isto ao regerar as
-- baterias de uma prova:
--
--   DELETE FROM heats WHERE workout_id = $1;
--
-- Reproduzido num Postgres 16 com as três funções reais: campeonato com duas
-- provas lançadas, regerar as baterias da prova 2 apaga os três resultados
-- dela, e team_standings continua dizendo workouts_completed = 2 e somando as
-- colocações de resultados que não existem mais. O placar público fica errado
-- até alguém lançar outro resultado qualquer naquele campeonato, e aí se
-- corrige sozinho — o que é pior, porque esconde a causa.
--
-- Os mesmos cascades passam por DELETE /api/workouts/:id e
-- DELETE /api/teams/:id, que têm rota exposta.
--
-- POR QUE DOIS MECANISMOS DIFERENTES
-- Apagar baterias direto é uma operação de um nível: um trigger de STATEMENT
-- roda depois do comando e de todos os cascades dele, e vê o estado final.
--
-- Apagar prova ou equipe tem cascade de vários níveis
-- (workouts -> heats -> heat_teams -> results), e um trigger de statement no
-- topo roda ANTES dos níveis de baixo terminarem. Medido: ao apagar a prova, o
-- recálculo rodava com as baterias já apagadas mas os resultados ainda vivos, e
-- gravava um placar sem sentido — zero provas completas, mas a soma das
-- colocações ainda contando.
--
-- Para esses dois casos o recálculo precisa esperar o cascade inteiro. Um
-- CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED roda no COMMIT, o único
-- momento garantidamente consistente. Constraint trigger só existe FOR EACH
-- ROW, então o custo é um recálculo por prova ou equipe apagada — aceitável,
-- já que as rotas apagam uma de cada vez.

-- ============================================================================
-- 1. BATERIAS — trigger de statement com transition table
-- ============================================================================
CREATE OR REPLACE FUNCTION trigger_heats_deleted()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
BEGIN
  -- Re-rankeia o que sobrou das provas afetadas. Necessário quando só PARTE
  -- das baterias de uma prova foi apagada: os resultados restantes mudam de
  -- colocação.
  FOR r IN
    SELECT DISTINCT w.id AS workout_id, w.championship_id
      FROM old_heats oh
      JOIN workouts w ON w.id = oh.workout_id
  LOOP
    PERFORM recalculate_placements(r.workout_id, c.id)
       FROM categories c
      WHERE c.championship_id = r.championship_id;
  END LOOP;

  -- Reescreve o leaderboard de cada campeonato afetado, uma vez só.
  -- O EXISTS evita trabalho inútil quando o campeonato inteiro está sendo
  -- apagado e as linhas já sumiram.
  FOR r IN
    SELECT DISTINCT w.championship_id
      FROM old_heats oh
      JOIN workouts w ON w.id = oh.workout_id
     WHERE EXISTS (SELECT 1 FROM championships ch WHERE ch.id = w.championship_id)
  LOOP
    PERFORM recalculate_standings(r.championship_id);
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_heats_deleted ON heats;
CREATE TRIGGER trg_heats_deleted
  AFTER DELETE ON heats
  REFERENCING OLD TABLE AS old_heats
  FOR EACH STATEMENT EXECUTE FUNCTION trigger_heats_deleted();

-- ============================================================================
-- 2. PROVAS e EQUIPES — constraint trigger deferido, roda no COMMIT
-- ============================================================================
CREATE OR REPLACE FUNCTION trigger_recalc_championship_deferred()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- O campeonato pode estar sendo apagado junto; aí não há o que recalcular.
  PERFORM 1 FROM championships WHERE id = OLD.championship_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Equipe apagada: as colocações das provas em que ela competiu precisam ser
  -- refeitas, senão quem ficava atrás dela mantém a colocação antiga. Prova
  -- apagada não precisa disso — os resultados dela sumiram inteiros.
  IF TG_TABLE_NAME = 'teams' THEN
    PERFORM recalculate_placements(w.id, OLD.category_id)
       FROM workouts w
      WHERE w.championship_id = OLD.championship_id;
  END IF;

  PERFORM recalculate_standings(OLD.championship_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_workout_deleted_recalc ON workouts;
CREATE CONSTRAINT TRIGGER trg_workout_deleted_recalc
  AFTER DELETE ON workouts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trigger_recalc_championship_deferred();

DROP TRIGGER IF EXISTS trg_team_deleted_recalc ON teams;
CREATE CONSTRAINT TRIGGER trg_team_deleted_recalc
  AFTER DELETE ON teams
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trigger_recalc_championship_deferred();
