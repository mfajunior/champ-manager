-- migrations/016-heat-lane-unique.sql
-- Impede duas equipes na mesma raia da mesma bateria.
--
-- CONTEXTO
-- heat_teams tinha UNIQUE(heat_id, team_id) — a mesma equipe não entra duas
-- vezes na mesma bateria — e nada sobre lane_number. Até agora isso nunca deu
-- problema porque só o gerador escrevia ali, e ele numera as raias de 1 a N em
-- sequência. A edição manual de baterias muda isso: passa a existir um caminho
-- em que duas equipes podem acabar na raia 3 da bateria 5, e aí duas duplas
-- aparecem no mesmo lugar da folha do juiz.
--
-- POR QUE DEFERRABLE
-- A operação mais comum da edição é TROCAR duas equipes de lugar, e uma troca
-- passa obrigatoriamente por um estado inválido no meio: ao mover a primeira
-- para o destino, a segunda ainda está lá. Com constraint imediata, o primeiro
-- UPDATE falha e a troca é impossível sem valores temporários — gambiarra que
-- deixa lixo quando a transação quebra no meio.
--
-- DEFERRABLE INITIALLY IMMEDIATE mantém o comportamento rígido no uso normal
-- (qualquer INSERT errado falha na hora, como hoje) e permite que a transação
-- da troca peça SET CONSTRAINTS ... DEFERRED, adiando a checagem para o COMMIT
-- — o único momento em que o estado volta a ser consistente. É o mesmo
-- raciocínio dos gatilhos de recálculo das migrations 010 e 012.
--
-- NULL não conflita: lane_number é opcional, e no Postgres NULLs são
-- distintos entre si num UNIQUE comum.

BEGIN;

ALTER TABLE heat_teams
  DROP CONSTRAINT IF EXISTS uq_heat_teams_lane;

ALTER TABLE heat_teams
  ADD CONSTRAINT uq_heat_teams_lane
  UNIQUE (heat_id, lane_number)
  DEFERRABLE INITIALLY IMMEDIATE;

COMMIT;
