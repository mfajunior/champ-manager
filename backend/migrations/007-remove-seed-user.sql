-- migrations/007-remove-seed-user.sql
-- Remove o usuário de exemplo criado pela migration 001.
--
-- CONTEXTO
-- O final da 001 tem um INSERT de 'admin@champy.local' cujo password_hash é
-- o texto literal '$2a$10$...' — um placeholder que alguém deixou ali, não
-- um hash de verdade. Ninguém consegue entrar com essa conta (bcryptjs.
-- compare sempre falha contra um hash malformado), então nunca foi uma porta
-- aberta; mas é uma linha de usuário fantasma no banco de qualquer instalação
-- do sistema, inclusive na do cliente. E como o docker-compose monta
-- justamente a 001 em docker-entrypoint-initdb.d, todo banco novo nasce com
-- ela.
--
-- Migration existente não se edita (a 001 já rodou em bancos reais e o
-- controle em schema_migrations não a executa de novo), então a limpeza vem
-- aqui.
--
-- O DELETE casa email E o hash placeholder: se alguém tiver criado uma conta
-- real com esse mesmo email via scripts/create-user.js, o password_hash será
-- um bcrypt válido e a linha não será tocada.

BEGIN;

DELETE FROM users
WHERE email = 'admin@champy.local'
  AND password_hash = '$2a$10$...';

COMMIT;
