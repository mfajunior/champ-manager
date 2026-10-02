-- migrations/011-points-table-schema.sql
-- Estrutura do segundo modelo de pontuação (points_table), estilo CrossFit
-- Games, convivendo com o atual. Só adições: nenhuma tabela, coluna, função ou
-- constraint existente é renomeada, removida ou tem o tipo alterado.
--
-- COMO OS DOIS MODELOS CONVIVEM
-- championships.scoring_model decide qual regra vale, e o DEFAULT 'legacy'
-- resolve sozinho a compatibilidade: toda competição que já existe fica no
-- modelo antigo sem precisar de um único UPDATE.
--
-- UMA TABELA DE PONTOS POR CAMPEONATO
-- A tabela vale para todas as provas, as já cadastradas e as futuras. Não há
-- vínculo por prova nem por divisão — foi decisão explícita, e é por isso que
-- não existe coluna de tabela de pontos em workout_variants. Se um dia a final
-- precisar valer o dobro, isso entra como coluna opcional numa migration
-- aditiva; não vale pagar agora por uma necessidade que não existe.

-- ============================================================================
-- 1. TABELAS DE PONTOS
-- ============================================================================
CREATE TABLE IF NOT EXISTS points_tables (
  id              SERIAL PRIMARY KEY,
  championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,
  -- Fixo em 100 na interface. A coluna existe assim mesmo para o 100 não virar
  -- número mágico dentro da função PL/pgSQL: mudar o valor máximo vira
  -- alteração de tela, sem migration.
  max_points      INTEGER NOT NULL DEFAULT 100 CHECK (max_points > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (championship_id, name)
);

-- Faixas no formato "da colocação A até B, decrescer C pontos".
-- end_place NULL = faixa aberta ("desta colocação em diante"). A última faixa
-- é sempre aberta, o que garante por construção que nenhuma colocação fica sem
-- regra — inclusive as equipes que se inscreverem depois da tabela pronta.
CREATE TABLE IF NOT EXISTS points_table_ranges (
  id              SERIAL PRIMARY KEY,
  points_table_id INTEGER NOT NULL REFERENCES points_tables(id) ON DELETE CASCADE,
  start_place     INTEGER NOT NULL CHECK (start_place >= 1),
  end_place       INTEGER NULL,
  decrement       INTEGER NOT NULL CHECK (decrement >= 0),
  CHECK (end_place IS NULL OR end_place >= start_place),
  UNIQUE (points_table_id, start_place)
);

-- No máximo uma faixa aberta por tabela. Índice parcial em vez de
-- UNIQUE NULLS NOT DISTINCT, que só existe do Postgres 15 em diante — não vale
-- criar dependência de versão por açúcar sintático, ainda mais com hospedagem
-- em aberto.
CREATE UNIQUE INDEX IF NOT EXISTS uq_points_table_open_range
  ON points_table_ranges (points_table_id) WHERE end_place IS NULL;

-- ============================================================================
-- 2. CORTE POR PROVA
-- ============================================================================
-- "A prova 5 é disputada só pelo top 4". O top N conta DENTRO de cada
-- categoria, porque os leaderboards já são independentes por divisão desde a
-- migration 002 — um corte global eliminaria uma categoria pequena inteira.
--
-- category_id NULL é a linha padrão, que vale para todas as divisões; uma
-- linha com category_id preenchido sobrescreve a padrão naquela divisão. Cobre
-- o caso de uma categoria com 6 equipes e outra com 18 sem obrigar a
-- configurar cada uma.
CREATE TABLE IF NOT EXISTS workout_cuts (
  id          SERIAL PRIMARY KEY,
  workout_id  INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  category_id INTEGER NULL REFERENCES categories(id) ON DELETE CASCADE,
  keep_top_n  INTEGER NOT NULL CHECK (keep_top_n > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- O Postgres trata NULLs como distintos num UNIQUE comum, então uma constraint
-- só não impediria duas linhas padrão para a mesma prova. Dois índices parciais.
CREATE UNIQUE INDEX IF NOT EXISTS uq_workout_cuts_default
  ON workout_cuts (workout_id) WHERE category_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_workout_cuts_category
  ON workout_cuts (workout_id, category_id) WHERE category_id IS NOT NULL;

-- ============================================================================
-- 3. COLUNAS NOVAS EM TABELAS EXISTENTES
-- ============================================================================
ALTER TABLE championships
  ADD COLUMN IF NOT EXISTS scoring_model VARCHAR(20) NOT NULL DEFAULT 'legacy';

ALTER TABLE championships DROP CONSTRAINT IF EXISTS chk_scoring_model;
ALTER TABLE championships ADD CONSTRAINT chk_scoring_model
  CHECK (scoring_model IN ('legacy', 'points_table'));

-- ON DELETE RESTRICT de propósito: apagar a tabela de pontos de um campeonato
-- em andamento apagaria a régua do placar. O organizador troca a tabela, não a
-- remove pelas costas.
ALTER TABLE championships
  ADD COLUMN IF NOT EXISTS points_table_id INTEGER NULL
    REFERENCES points_tables(id) ON DELETE RESTRICT;

-- Para ligar o modelo novo é obrigatório ter escolhido a tabela. Uma decisão,
-- não uma por prova.
ALTER TABLE championships DROP CONSTRAINT IF EXISTS chk_points_table_required;
ALTER TABLE championships ADD CONSTRAINT chk_points_table_required
  CHECK (scoring_model <> 'points_table' OR points_table_id IS NOT NULL);

-- total_points é coluna nova em vez de reaproveitar total_score de propósito: a
-- mesma coluna significando "soma de colocações, menor vence" num modelo e
-- "soma de pontos, maior vence" no outro seria uma armadilha para quem ler
-- depois. total_score continua sendo preenchido nos dois modelos, para o
-- contrato da API não mudar.
ALTER TABLE team_standings
  ADD COLUMN IF NOT EXISTS total_points INTEGER NULL;

ALTER TABLE team_standings
  ADD COLUMN IF NOT EXISTS is_cut BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================================
-- 4. ÍNDICES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_points_tables_championship
  ON points_tables(championship_id);
CREATE INDEX IF NOT EXISTS idx_points_table_ranges_table
  ON points_table_ranges(points_table_id);
CREATE INDEX IF NOT EXISTS idx_workout_cuts_workout
  ON workout_cuts(workout_id);
