-- migrations/012-points-table-functions.sql
-- A regra do modelo points_table, inteira dentro do banco. Backend e frontend
-- não duplicam cálculo de pontuação em lugar nenhum.
--
-- O DESVIO ENTRE OS DOIS MODELOS FICA NUM LUGAR SÓ
-- Três triggers recalculam o placar hoje: o de results, o de heats (migration
-- 010) e o deferido de provas/equipes (010). Se cada um decidisse por conta
-- própria qual modelo usar, seriam três lugares para errar. Em vez disso todos
-- passam a chamar recalculate_championship(), que é quem lê o scoring_model e
-- despacha. Um ponto de decisão.

-- ============================================================================
-- 1. points_for_place — quanto vale uma colocação
-- ============================================================================
-- 1º lugar recebe max_points integralmente. Cada colocação seguinte subtrai o
-- decremento DA FAIXA A QUE ELA PERTENCE — na virada de faixa vale o decremento
-- da faixa nova. Trava em zero, nunca negativo.
--
-- A soma é feita POR FAIXA, não colocação a colocação: para cada faixa, conta
-- quantas das colocações entre 2 e N caem dentro dela e multiplica pelo
-- decremento. Custo proporcional ao número de faixas (no máximo 3), não à
-- colocação — calcular o 200º custa o mesmo que o 2º.
CREATE OR REPLACE FUNCTION points_for_place(
  p_points_table_id INTEGER,
  p_place           INTEGER
) RETURNS INTEGER
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_max_points      INTEGER;
  v_total_decrement BIGINT;
BEGIN
  IF p_place IS NULL OR p_place < 1 OR p_points_table_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT max_points INTO v_max_points
    FROM points_tables WHERE id = p_points_table_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tabela de pontos % não encontrada', p_points_table_id;
  END IF;

  SELECT COALESCE(SUM(
           GREATEST(
             0,
             LEAST(p_place, COALESCE(r.end_place, p_place))
               - GREATEST(2, r.start_place) + 1
           )::BIGINT * r.decrement
         ), 0)
    INTO v_total_decrement
    FROM points_table_ranges r
   WHERE r.points_table_id = p_points_table_id;

  RETURN GREATEST(0, v_max_points - v_total_decrement);
END;
$$;

-- ============================================================================
-- 2. validate_points_table_ranges — as faixas precisam cobrir todo mundo
-- ============================================================================
-- Constraint trigger DEFERRABLE INITIALLY DEFERRED: valida no COMMIT, porque a
-- validação é sobre o CONJUNTO. Editar três faixas passa por estados
-- intermediários legitimamente inválidos, e barrar no meio impediria a edição.
CREATE OR REPLACE FUNCTION validate_points_table_ranges()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_table_id  INTEGER := COALESCE(NEW.points_table_id, OLD.points_table_id);
  v_count     INTEGER;
  v_prev_end  INTEGER := 0;
  v_open_seen BOOLEAN := FALSE;
  r           RECORD;
BEGIN
  -- A tabela inteira pode ter sido apagada (CASCADE); nada a validar.
  PERFORM 1 FROM points_tables WHERE id = v_table_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM points_table_ranges WHERE points_table_id = v_table_id;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'A tabela de pontos precisa de pelo menos uma faixa';
  END IF;

  FOR r IN
    SELECT start_place, end_place
      FROM points_table_ranges
     WHERE points_table_id = v_table_id
     ORDER BY start_place
  LOOP
    IF v_open_seen THEN
      RAISE EXCEPTION 'A faixa aberta ("em diante") precisa ser a última';
    END IF;

    IF r.start_place <> v_prev_end + 1 THEN
      IF v_prev_end = 0 THEN
        RAISE EXCEPTION 'A primeira faixa precisa começar na 1ª colocação (começa na %)',
          r.start_place;
      ELSE
        RAISE EXCEPTION 'Faixas com buraco: depois da colocação % vem a %, deveria vir a %',
          v_prev_end, r.start_place, v_prev_end + 1;
      END IF;
    END IF;

    IF r.end_place IS NULL THEN
      v_open_seen := TRUE;
    ELSE
      v_prev_end := r.end_place;
    END IF;
  END LOOP;

  IF NOT v_open_seen THEN
    RAISE EXCEPTION
      'A última faixa precisa ser aberta ("desta colocação em diante"), senão colocações acima da % ficam sem pontuação',
      v_prev_end;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_points_table_ranges ON points_table_ranges;
CREATE CONSTRAINT TRIGGER trg_validate_points_table_ranges
  AFTER INSERT OR UPDATE OR DELETE ON points_table_ranges
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_points_table_ranges();

-- ============================================================================
-- 3. eligible_teams_for_workout — quem disputa a prova
-- ============================================================================
-- Sem corte configurado, devolve todas as equipes da categoria. Com corte,
-- ordena pelo acumulado NAS PROVAS ANTERIORES (workout_number menor) e devolve
-- as keep_top_n primeiras.
--
-- É recalculada sempre, sem lista congelada: corrigir um resultado digitado
-- errado muda o leaderboard e muda o corte junto. Decisão consciente — quando a
-- escalação já gerada deixar de bater com a classificação, quem avisa é a tela
-- de baterias, não o banco mudando as coisas por conta própria.
CREATE OR REPLACE FUNCTION eligible_teams_for_workout(
  p_workout_id  INTEGER,
  p_category_id INTEGER
) RETURNS SETOF INTEGER
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_championship_id  INTEGER;
  v_workout_number   INTEGER;
  v_points_table_id  INTEGER;
  v_keep_top_n       INTEGER;
BEGIN
  SELECT w.championship_id, w.workout_number, c.points_table_id
    INTO v_championship_id, v_workout_number, v_points_table_id
    FROM workouts w
    JOIN championships c ON c.id = w.championship_id
   WHERE w.id = p_workout_id;

  IF v_championship_id IS NULL THEN
    RETURN;
  END IF;

  -- Linha específica da categoria ganha da linha padrão.
  SELECT wc.keep_top_n INTO v_keep_top_n
    FROM workout_cuts wc
   WHERE wc.workout_id = p_workout_id
     AND (wc.category_id = p_category_id OR wc.category_id IS NULL)
   ORDER BY (wc.category_id IS NULL)
   LIMIT 1;

  IF v_keep_top_n IS NULL THEN
    RETURN QUERY
      SELECT t.id FROM teams t
       WHERE t.championship_id = v_championship_id
         AND t.category_id = p_category_id
       ORDER BY t.id;
    RETURN;
  END IF;

  RETURN QUERY
  WITH acumulado AS (
    SELECT t.id AS team_id,
           COALESCE(SUM(points_for_place(v_points_table_id, r."place")), 0) AS pontos,
           ARRAY_AGG(r."place" ORDER BY r."place")
             FILTER (WHERE r."place" IS NOT NULL) AS colocacoes
      FROM teams t
      -- As condições ficam no ON, não no WHERE: no WHERE elas eliminariam a
      -- equipe inteira em vez de só as linhas, e quem só tem resultado em prova
      -- posterior sumiria do corte em vez de entrar com zero.
      LEFT JOIN heat_teams ht ON ht.team_id = t.id
      LEFT JOIN heats h ON h.id = ht.heat_id
      LEFT JOIN workouts w2 ON w2.id = h.workout_id
                           AND w2.workout_number < v_workout_number
      LEFT JOIN results r ON r.heat_team_id = ht.id AND w2.id IS NOT NULL
     WHERE t.championship_id = v_championship_id
       AND t.category_id = p_category_id
     GROUP BY t.id
  )
  SELECT a.team_id
    FROM acumulado a
   ORDER BY a.pontos DESC,
            COALESCE(a.colocacoes, ARRAY[]::INTEGER[]) ASC,
            a.team_id ASC
   LIMIT v_keep_top_n;
END;
$$;

-- ============================================================================
-- 4. recalculate_points_standings — o leaderboard do modelo novo
-- ============================================================================
-- Mesma forma da recalculate_standings: apaga e reescreve o campeonato inteiro.
-- Nada de UPDATE parcial — as duas escrevem na mesma tabela e precisam deixá-la
-- num estado que não dependa de quem rodou antes.
CREATE OR REPLACE FUNCTION recalculate_points_standings(p_championship_id INTEGER)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_points_table_id INTEGER;
BEGIN
  SELECT points_table_id INTO v_points_table_id
    FROM championships WHERE id = p_championship_id;

  DELETE FROM team_standings WHERE championship_id = p_championship_id;

  INSERT INTO team_standings
    (championship_id, category_id, team_id, total_score, total_points, workouts_completed)
  SELECT
    t.championship_id,
    t.category_id,
    t.id,
    -- total_score continua sendo a soma de colocações mesmo aqui: é o que o
    -- contrato da API já expõe, e some da tela no modelo novo sem sumir do banco.
    COALESCE(SUM(r."place"), 0),
    COALESCE(SUM(points_for_place(v_points_table_id, r."place")), 0),
    COUNT(DISTINCT h.workout_id) FILTER (WHERE r.id IS NOT NULL)
  FROM teams t
  LEFT JOIN heat_teams ht ON ht.team_id = t.id
  LEFT JOIN heats h ON h.id = ht.heat_id
  LEFT JOIN results r ON r.heat_team_id = ht.id
  WHERE t.championship_id = p_championship_id
  GROUP BY t.championship_id, t.category_id, t.id;

  -- Fora do corte: existe alguma prova com corte configurado em que esta equipe
  -- não está entre as classificadas.
  UPDATE team_standings ts
     SET is_cut = TRUE
   WHERE ts.championship_id = p_championship_id
     AND EXISTS (
       SELECT 1
         FROM workout_cuts wc
         JOIN workouts w ON w.id = wc.workout_id
        WHERE w.championship_id = p_championship_id
          AND (wc.category_id IS NULL OR wc.category_id = ts.category_id)
          AND NOT EXISTS (
            SELECT 1 FROM eligible_teams_for_workout(w.id, ts.category_id) e
             WHERE e = ts.team_id
          )
     );

  WITH colocacoes AS (
    SELECT t.id AS team_id,
           ARRAY_AGG(r."place" ORDER BY r."place")
             FILTER (WHERE r."place" IS NOT NULL) AS places
      FROM teams t
      LEFT JOIN heat_teams ht ON ht.team_id = t.id
      LEFT JOIN results r ON r.heat_team_id = ht.id
     WHERE t.championship_id = p_championship_id
     GROUP BY t.id
  ),
  ranked AS (
    SELECT ts.id,
           ROW_NUMBER() OVER (
             PARTITION BY ts.category_id
             ORDER BY
               ts.is_cut ASC,                    -- cortadas por último
               (ts.workouts_completed = 0),      -- quem não competiu depois de quem competiu
               ts.total_points DESC,             -- mais pontos vence
               -- Desempate: melhor colocação individual. O Postgres compara
               -- arrays elemento a elemento, então {1,3,5} perde para {1,2,9}.
               COALESCE(c.places, ARRAY[]::INTEGER[]) ASC,
               ts.team_id ASC                    -- determinístico no empate total
           ) AS new_place
      FROM team_standings ts
      LEFT JOIN colocacoes c ON c.team_id = ts.team_id
     WHERE ts.championship_id = p_championship_id
  )
  UPDATE team_standings ts
     SET "place" = r.new_place, updated_at = CURRENT_TIMESTAMP
    FROM ranked r
   WHERE ts.id = r.id;
END;
$$;

-- ============================================================================
-- 5. recalculate_championship — o único lugar que escolhe o modelo
-- ============================================================================
CREATE OR REPLACE FUNCTION recalculate_championship(p_championship_id INTEGER)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_model VARCHAR(20);
BEGIN
  SELECT scoring_model INTO v_model
    FROM championships WHERE id = p_championship_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_model = 'points_table' THEN
    PERFORM recalculate_points_standings(p_championship_id);
  ELSE
    PERFORM recalculate_standings(p_championship_id);
  END IF;
END;
$$;

-- ============================================================================
-- 6. Os três triggers de recálculo passam a despachar pelo modelo
-- ============================================================================
CREATE OR REPLACE FUNCTION trigger_result_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_championship_id INTEGER;
  v_workout_id      INTEGER;
  v_category_id     INTEGER;
  v_heat_team_id    INTEGER;
BEGIN
  -- recalculate_placements faz UPDATE em results, que dispara este mesmo
  -- trigger de novo. O guard corta a recursão.
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_heat_team_id := COALESCE(NEW.heat_team_id, OLD.heat_team_id);

  SELECT w.championship_id, w.id, t.category_id
    INTO v_championship_id, v_workout_id, v_category_id
  FROM heat_teams ht
  JOIN heats h ON h.id = ht.heat_id
  JOIN workouts w ON w.id = h.workout_id
  JOIN teams t ON t.id = ht.team_id
  WHERE ht.id = v_heat_team_id;

  IF v_workout_id IS NOT NULL THEN
    -- recalculate_placements serve aos DOIS modelos: RANK() já entrega o
    -- 1-2-2-4 que o modelo novo pede. Nada nela muda.
    PERFORM recalculate_placements(v_workout_id, v_category_id);
    PERFORM recalculate_championship(v_championship_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION trigger_heats_deleted()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT w.id AS workout_id, w.championship_id
      FROM old_heats oh
      JOIN workouts w ON w.id = oh.workout_id
  LOOP
    PERFORM recalculate_placements(r.workout_id, c.id)
       FROM categories c
      WHERE c.championship_id = r.championship_id;
  END LOOP;

  FOR r IN
    SELECT DISTINCT w.championship_id
      FROM old_heats oh
      JOIN workouts w ON w.id = oh.workout_id
     WHERE EXISTS (SELECT 1 FROM championships ch WHERE ch.id = w.championship_id)
  LOOP
    PERFORM recalculate_championship(r.championship_id);
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_recalc_championship_deferred()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1 FROM championships WHERE id = OLD.championship_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF TG_TABLE_NAME = 'teams' THEN
    PERFORM recalculate_placements(w.id, OLD.category_id)
       FROM workouts w
      WHERE w.championship_id = OLD.championship_id;
  END IF;

  PERFORM recalculate_championship(OLD.championship_id);
  RETURN NULL;
END;
$$;

-- ============================================================================
-- 7. Mexer na régua reescreve o placar
-- ============================================================================
-- Trocar o modelo ou alterar qualquer parâmetro da tabela de pontos obriga
-- recálculo. Fica no banco junto com o resto da regra: nenhuma rota precisa
-- lembrar de chamar nada, que é justamente o que se esquece numa rota nova seis
-- meses depois.
--
-- Deferido pelo mesmo motivo da validação: editar três faixas passa por estados
-- intermediários inválidos, e recalcular no meio daria número errado. No COMMIT
-- a tabela já está consistente. FOR EACH ROW porque constraint trigger só
-- existe assim — o custo é um recálculo por faixa alterada, e uma tabela tem no
-- máximo três.
CREATE OR REPLACE FUNCTION trigger_points_table_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_table_id INTEGER;
  r          RECORD;
BEGIN
  IF TG_TABLE_NAME = 'points_table_ranges' THEN
    v_table_id := COALESCE(NEW.points_table_id, OLD.points_table_id);
  ELSE
    v_table_id := COALESCE(NEW.id, OLD.id);
  END IF;

  FOR r IN
    SELECT id FROM championships
     WHERE points_table_id = v_table_id AND scoring_model = 'points_table'
  LOOP
    PERFORM recalculate_points_standings(r.id);
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_points_table_changed ON points_tables;
CREATE CONSTRAINT TRIGGER trg_points_table_changed
  AFTER INSERT OR UPDATE OR DELETE ON points_tables
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trigger_points_table_changed();

DROP TRIGGER IF EXISTS trg_points_table_ranges_changed ON points_table_ranges;
CREATE CONSTRAINT TRIGGER trg_points_table_ranges_changed
  AFTER INSERT OR UPDATE OR DELETE ON points_table_ranges
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trigger_points_table_changed();

-- Configurar, mudar ou remover um corte muda quem está classificado, e com isso
-- o is_cut e a ordem do placar. Sem este trigger a tela de cortes salvaria a
-- regra sem que o leaderboard soubesse dela — descoberto em teste, não em
-- revisão de código.
CREATE OR REPLACE FUNCTION trigger_workout_cut_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_championship_id INTEGER;
BEGIN
  SELECT w.championship_id INTO v_championship_id
    FROM workouts w
   WHERE w.id = COALESCE(NEW.workout_id, OLD.workout_id);

  IF v_championship_id IS NOT NULL THEN
    PERFORM recalculate_championship(v_championship_id);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_workout_cut_changed ON workout_cuts;
CREATE CONSTRAINT TRIGGER trg_workout_cut_changed
  AFTER INSERT OR UPDATE OR DELETE ON workout_cuts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trigger_workout_cut_changed();

-- Trocar o modelo do campeonato também recalcula.
CREATE OR REPLACE FUNCTION trigger_scoring_model_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.scoring_model IS DISTINCT FROM OLD.scoring_model
     OR NEW.points_table_id IS DISTINCT FROM OLD.points_table_id THEN
    PERFORM recalculate_championship(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_scoring_model_changed ON championships;
CREATE CONSTRAINT TRIGGER trg_scoring_model_changed
  AFTER UPDATE ON championships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trigger_scoring_model_changed();
