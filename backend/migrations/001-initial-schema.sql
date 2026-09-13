-- migrations/001_initial_schema.sql
-- Initial database schema for Champy Championship Manager

-- ============= USERS (Operadores) =============
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============= CHAMPIONSHIPS (Campeonatos) =============
CREATE TABLE IF NOT EXISTS championships (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  location VARCHAR(255),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============= CATEGORIES (Categorias) =============
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  gender VARCHAR(20), -- "masculino", "feminino", "misto"
  level VARCHAR(20), -- "iniciante", "scale", "rx"
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(championship_id, name)
);

-- ============= TEAMS (Equipes) =============
CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  registered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(championship_id, name)
);

-- ============= WORKOUTS (Provas/WODs) =============
CREATE TABLE IF NOT EXISTS workouts (
  id SERIAL PRIMARY KEY,
  championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
  workout_number INTEGER NOT NULL,
  description TEXT,
  type VARCHAR(50), -- "for_time", "amrap", "chipper", etc
  status VARCHAR(50) DEFAULT 'scheduled', -- "scheduled", "in_progress", "completed"
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(championship_id, workout_number)
);

-- ============= HEATS (Baterias) =============
CREATE TABLE IF NOT EXISTS heats (
  id SERIAL PRIMARY KEY,
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  heat_number INTEGER NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  scheduled_time TIMESTAMP,
  status VARCHAR(50) DEFAULT 'scheduled', -- "scheduled", "in_progress", "completed"
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workout_id, heat_number, category_id)
);

-- ============= HEAT_TEAMS (Associação Time-Bateria) =============
CREATE TABLE IF NOT EXISTS heat_teams (
  id SERIAL PRIMARY KEY,
  heat_id INTEGER NOT NULL REFERENCES heats(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  lane_number INTEGER, -- Número de pista/posição na bateria
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(heat_id, team_id)
);

-- ============= RESULTS (Resultados de cada prova) =============
CREATE TABLE IF NOT EXISTS results (
  id SERIAL PRIMARY KEY,
  heat_team_id INTEGER NOT NULL REFERENCES heat_teams(id) ON DELETE CASCADE,
  "place" INTEGER NOT NULL, -- Colocação: 1, 2, 3, etc
  score INTEGER DEFAULT NULL, -- Pontos (normalmente = place)
  time_or_reps VARCHAR(100), -- "12:34" ou "45 reps"
  notes TEXT, -- "DNF" (Did Not Finish), "No-Rep", etc
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(heat_team_id)
);

-- ============= TEAM_STANDINGS (Cache de Rankings) =============
CREATE TABLE IF NOT EXISTS team_standings (
  id SERIAL PRIMARY KEY,
  championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  total_score INTEGER DEFAULT 0, -- Soma de todos os places
  "place" INTEGER, -- Colocação final
  workouts_completed INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(championship_id, team_id)
);

-- ============= INDEXES para Performance =============

-- Queries de leaderboard por campeonato
CREATE INDEX IF NOT EXISTS idx_team_standings_championship_place
  ON team_standings(championship_id, "place");

-- Queries de resultados por campeonato
CREATE INDEX IF NOT EXISTS idx_results_championship
  ON results(heat_team_id);

-- Queries de baterias por workout
CREATE INDEX IF NOT EXISTS idx_heats_workout
  ON heats(workout_id);

-- Queries de times por campeonato
CREATE INDEX IF NOT EXISTS idx_teams_championship
  ON teams(championship_id);

-- Queries de workouts por campeonato
CREATE INDEX IF NOT EXISTS idx_workouts_championship
  ON workouts(championship_id);

-- Queries de heat_teams por bateria
CREATE INDEX IF NOT EXISTS idx_heat_teams_heat
  ON heat_teams(heat_id);

-- ============= FUNCTIONS para Auto-recalcular Standings =============

/**
 * Função para recalcular o ranking de um campeonato
 * Chamada sempre que um resultado é inserido/atualizado
 */
CREATE OR REPLACE FUNCTION recalculate_standings(p_championship_id INTEGER)
RETURNS void AS $$
BEGIN
  -- Limpa os standings antigos
  DELETE FROM team_standings WHERE championship_id = p_championship_id;

  -- Recalcula totalizando os pontos de cada time
  INSERT INTO team_standings (championship_id, team_id, total_score, workouts_completed)
  SELECT
    c.id,
    t.id,
    COALESCE(SUM(r."place"), 0) as total_score,
    COUNT(DISTINCT r.id) as workouts_completed
  FROM championships c
  CROSS JOIN teams t
  LEFT JOIN heat_teams ht ON ht.team_id = t.id
  LEFT JOIN heats h ON h.id = ht.heat_id
  LEFT JOIN workouts w ON w.id = h.workout_id
  LEFT JOIN results r ON r.heat_team_id = ht.id
  WHERE c.id = p_championship_id AND t.championship_id = p_championship_id
  GROUP BY c.id, t.id
  ORDER BY total_score ASC;

  -- Atualiza o "place" (colocação) baseado no ranking
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (ORDER BY total_score ASC) as new_place
    FROM team_standings
    WHERE championship_id = p_championship_id
  )
  UPDATE team_standings ts
  SET "place" = r.new_place
  FROM ranked r
  WHERE ts.id = r.id;
END;
$$ LANGUAGE plpgsql;

-- ============= TRIGGERS =============

/**
 * Trigger: Após inserir um resultado, recalcula o ranking
 */
CREATE OR REPLACE FUNCTION trigger_result_inserted()
RETURNS TRIGGER AS $$
DECLARE
  v_championship_id INTEGER;
BEGIN
  -- Obtém o championship_id através da relação
  SELECT w.championship_id INTO v_championship_id
  FROM results r
  JOIN heat_teams ht ON r.heat_team_id = ht.id
  JOIN heats h ON ht.heat_id = h.id
  JOIN workouts w ON h.workout_id = w.id
  WHERE r.id = NEW.id;

  -- Recalcula standings
  PERFORM recalculate_standings(v_championship_id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_result_inserted ON results;
CREATE TRIGGER trg_result_inserted
  AFTER INSERT OR UPDATE ON results
  FOR EACH ROW
  EXECUTE FUNCTION trigger_result_inserted();

-- ============= SEED DATA (Exemplo) =============

-- Insert admin user (senha: admin123 -> precisa ser hasheada em produção!)
-- Este é apenas um exemplo; use bcryptjs no backend para hashear senhas
INSERT INTO users (email, name, password_hash)
VALUES ('admin@champy.local', 'Admin Champy', '$2a$10$...')
ON CONFLICT DO NOTHING;
