-- migrations/004-result-audit-log.sql
-- Log de auditoria de resultados: quem lançou, corrigiu ou removeu cada
-- resultado, e com qual valor.
--
-- CONTEXTO
-- A coluna results.recorded_by existia desde a migration 001, mas só guarda
-- QUEM CRIOU o resultado — uma correção (UPDATE) não atualiza esse campo, e
-- não existia nenhum endpoint pra consultar sequer esse dado. Pra um sistema
-- que decide colocação de campeonato, "quem mudou o quê e quando" é
-- informação que o organizador pode precisar mostrar numa contestação.

BEGIN;

-- heat_team_id (não result_id) é a chave de consulta principal: é a raia da
-- equipe, que existe antes do primeiro resultado ser lançado e continua
-- existindo depois que um resultado é apagado. result_id usa ON DELETE
-- SET NULL (não CASCADE) de propósito — apagar o resultado não pode apagar
-- o histórico dele, ou a linha 'deleted' do log desapareceria junto com o
-- evento que ela deveria registrar.
CREATE TABLE IF NOT EXISTS result_audit_log (
  id SERIAL PRIMARY KEY,
  heat_team_id INTEGER NOT NULL REFERENCES heat_teams(id) ON DELETE CASCADE,
  result_id INTEGER REFERENCES results(id) ON DELETE SET NULL,
  action VARCHAR(10) NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  raw_value NUMERIC(10,2),
  did_not_finish BOOLEAN,
  "place" INTEGER,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Consulta típica: histórico de uma raia específica, em ordem cronológica.
CREATE INDEX IF NOT EXISTS idx_result_audit_log_heat_team
  ON result_audit_log(heat_team_id, changed_at);

COMMIT;
