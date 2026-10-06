-- migrations/017-team-athletes.sql
-- Nome dos dois atletas de cada equipe.
--
-- POR QUE DUAS COLUNAS E NÃO UMA TABELA `athletes`
--
-- O requisito é literalmente dois atletas por equipe: o campeonato é de duplas,
-- e as descrições das provas falam em "a dupla escolhe", "syncro", "cada dupla".
-- Uma tabela 1-N seria mais correta em tese, mas acrescentaria um JOIN à
-- consulta de baterias — que já é a mais pesada do sistema e a que a plateia
-- inteira abre ao mesmo tempo — além de CRUD próprio em todo lugar.
--
-- O custo aceito: se um dia existir categoria com equipes de quatro, isto
-- precisa ser refeito. Refazer é mover duas colunas para uma tabela, trabalho
-- contido e com a suíte de integração cobrindo as rotas de equipe.
--
-- NULAS DE PROPÓSITO
--
-- As equipes já cadastradas não têm atleta, e vão continuar sem até alguém
-- preencher. A tela simplesmente não mostra nada quando está vazio — nada de
-- backfill com string vazia, que depois obrigaria a distinguir "não informado"
-- de "informado como vazio".

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS athlete_1 VARCHAR(255),
  ADD COLUMN IF NOT EXISTS athlete_2 VARCHAR(255);
