-- migrations/018-planned-lanes.sql
-- Quantas raias uma bateria VAI ter, quando ela ainda não tem equipe nenhuma.
--
-- POR QUE A COLUNA PRECISA EXISTIR
--
-- O cronograma pode ser gerado antes de a escalação existir: a prova 4 só tem
-- equipes definidas depois que a 3 termina e o corte é aplicado, mas o
-- organizador e a plateia precisam saber a que horas ela começa. Essas
-- baterias nascem sem nenhuma linha em heat_teams.
--
-- A tela quer desenhar as raias numeradas para mostrar o tamanho da bateria. Sem
-- esta coluna ela teria que usar championships.lanes_per_heat, e aí mentiria
-- justamente na última bateria de cada prova — com 30 equipes em 12 raias a
-- distribuição é 10, 10 e 10, nunca 12, 12 e 6. Desenhar 12 raias numa bateria
-- que terá 10 promete duas vagas que não existem.
--
-- NULL = bateria com escalação. Ali o número de raias é o número de linhas em
-- heat_teams, que é o dado de verdade; a coluna só serve para a bateria vazia.
ALTER TABLE heats
  ADD COLUMN IF NOT EXISTS planned_lanes INTEGER
  CHECK (planned_lanes IS NULL OR planned_lanes > 0);
