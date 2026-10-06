# ScoreUp — gerenciador de campeonatos de CrossFit

[![Backend Tests](https://github.com/mfajunior/champ-manager/actions/workflows/backend-tests.yml/badge.svg)](https://github.com/mfajunior/champ-manager/actions/workflows/backend-tests.yml)

Cadastro de equipes, provas com variante por categoria, distribuição de baterias,
lançamento de resultados e placar ao vivo. Node.js, PostgreSQL e React.

O sistema está **em produção, operando um campeonato real** — o ALTIORA GAMES, de
duplas, 29 equipes em cinco categorias. Isso muda o que o projeto é: as decisões
abaixo foram tomadas sob a restrição de que, no dia do evento, não existe janela
de manutenção, o organizador não vai reiniciar nada, e a plateia abre o placar no
celular toda junta quando uma bateria termina.

Documentos irmãos: [ARCHITECTURE.md](./ARCHITECTURE.md) para o schema completo,
[DEVELOPMENT.md](./DEVELOPMENT.md) para padrões de código e troubleshooting,
[frontend/README.md](./frontend/README.md) para as decisões do front.

---

## O que ele faz

**Para o organizador (autenticado)**

- Equipes por categoria, com o nome dos dois atletas da dupla
- Provas com uma variante por categoria (cargas e movimentos diferentes) e
  `scoring_type` por prova: tempo, repetições ou carga
- Prova com duas pontuações independentes (ex.: tempo *e* reps na mesma prova) e
  critério de desempate próprio
- Baterias geradas automaticamente, equilibradas pelo número de raias do box, com
  horário calculado em cadeia a partir do início do evento
- Remanejamento depois de geradas: trocar duas equipes de raia, ou mover alguém
  para uma raia livre de outra bateria
- Corte por prova: a partir da prova N, só as X primeiras de cada categoria
  disputam
- Lançamento do desempenho bruto (tempo, reps, carga ou DNF) — a colocação nunca
  é digitada
- Correção e exclusão de resultado, com trilha de auditoria de quem mexeu

**Para a plateia (sem login)**

- Placar por categoria, atualizando sozinho por WebSocket a cada resultado
- Lista de baterias com horário, raia e equipe — clicando no nome, os atletas
- Provas e variantes, com o que cada categoria faz

---

## Decisões de arquitetura

Esta é a parte que importa. Cada seção responde "por que assim" e, onde houve,
qual bug real levou à decisão.

### A colocação é sempre calculada, nunca digitada

A tentação óbvia era deixar o organizador digitar a colocação de cada equipe. O
problema: qualquer correção — equipe que relançou errado, desclassificação depois
de revisão — obrigaria a recalcular na mão todas as outras colocações daquela
prova. Escala mal e é fonte garantida de erro humano num evento ao vivo, sob
pressão de tempo.

`results` guarda só o dado bruto (`raw_value`: tempo em segundos, número de reps
ou carga; ou `did_not_finish`). A coluna `place` é preenchida por trigger:

```sql
CREATE TRIGGER trg_result_changed
  AFTER INSERT OR UPDATE OR DELETE ON results
  FOR EACH ROW
  EXECUTE FUNCTION trigger_result_changed();
```

O organizador lança um número; o sistema garante que todo o resto do campeonato
fica consistente sozinho.

**O risco que isso introduz:** uma função que altera a própria tabela que a
disparou pode entrar em recursão infinita — `recalculate_placements` faz `UPDATE`
em `results`, que é exatamente a tabela com o trigger. A trava é
`pg_trigger_depth() > 1`: se a função já está rodando dentro de outro disparo do
mesmo trigger, ela retorna sem recalcular de novo. Foi um bug real, encontrado em
teste local antes de qualquer dado de verdade passar por ali.

### Um único ponto decide qual modelo de pontuação aplicar

Três situações diferentes invalidam o placar: um resultado lançado, corrigido ou
apagado; uma bateria apagada; uma prova ou equipe apagada — esta última chega por
trigger `DEFERRABLE`, porque a remoção em cascata só termina no commit.

A alternativa óbvia seria cada gatilho recalcular por conta própria. O problema
aparece quando existe mais de um modelo de pontuação: cada gatilho precisaria
saber qual aplicar, e seriam três lugares para errar — e para esquecer de
atualizar quando nascesse um quarto gatilho.

Em vez disso, todos chamam `recalculate_championship(championship_id)`, que lê o
`scoring_model` do campeonato e despacha:

```
results (INSERT/UPDATE/DELETE)  ─┐
heats (bateria apagada)         ─┼──→  recalculate_championship()
workouts/teams (deferido)       ─┘          lê scoring_model
                                                    │
                   ┌────────────────────────────────┴─────────────────────────┐
              'legacy'                                               'points_table'
      recalculate_standings()                          recalculate_points_standings()
    soma colocações · menor vence                          soma pontos · maior vence
                   └────────────────────────────────┬─────────────────────────┘
                                             team_standings
                                     place · total_score · total_points
                                                    │
                                 backend emite leaderboard_updated (Socket.io)
```

Acrescentar um terceiro modelo é escrever a função nova e adicionar um ramo ali.
Nenhum gatilho é tocado.

### Dois modelos de pontuação, porque os dois existem no esporte

**`legacy`** — soma das colocações, menor vence. É o formato clássico: 1º lugar
vale 1, 2º vale 2, campeã é quem somar menos.

**`points_table`** — tabela de pontos configurável por faixas, maior vence. O 1º
lugar vale `max_pontos` e cada colocação seguinte decrementa conforme as faixas
(100, 97, 94... com decremento 3, por exemplo).

No `legacy`, com três provas e três equipes na mesma categoria:

```
            prova 1 (tempo)   prova 2 (reps)    prova 3 (tempo)   soma
Equipe A    500s  -> 1º        120 reps -> 2º    DNF      -> 3º     6
Equipe B    500s  -> 1º        140 reps -> 1º    480s     -> 1º     3   <- campeã
Equipe C    600s  -> 3º        100 reps -> 3º    500s     -> 2º     8
             ↑ A e B empatam:   ↑ mais reps é     ↑ DNF sempre por
             RANK() dá 1º às    melhor, porque    último, mesmo sem
             duas e pula o 2º   scoring_type      raw_value
                                é 'reps'
```

O mesmo quadro em `points_table` com máximo 100 e decremento 3: Equipe B somaria
300, Equipe A 291, Equipe C 285 — mesma ordem, escala invertida.

Por que manter os dois: sob **uma faixa uniforme** eles produzem exatamente o
mesmo ranking — conferi por força bruta, 192.815 comparações, zero divergência. A
diferença aparece quando o organizador quer faixas diferentes (decremento maior no
topo, para separar o pódio) ou quando precisa de granularidade para desempatar. E
empate não é raro: com poucas provas, a chance de um empate decidir pelo menos uma
posição de pódio é alta.

O ALTIORA roda em `points_table`. O modelo é por campeonato
(`championships.scoring_model`), não global, e trocar o valor dispara o recálculo
de tudo pelo trigger `trigger_scoring_model_changed`.

### `RANK()` na prova, `ROW_NUMBER()` no pódio

As duas funções de janela do Postgres, de propósito, para dois problemas
diferentes.

**Colocação dentro de uma prova usa `RANK()`.** Duas equipes empatadas devem
dividir a mesma colocação, e a próxima deve pular o número certo de posições (1º,
2º, 2º, **4º** — não 3º). É assim que um campeonato de verdade registra empate.

```sql
RANK() OVER (
  ORDER BY
    did_not_finish ASC,                                               -- DNF por último
    CASE WHEN scoring_type = 'time' THEN raw_value END ASC,           -- tempo: menor vence
    CASE WHEN scoring_type IN ('reps','load') THEN raw_value END DESC -- reps/carga: maior vence
)
```

**Ranking geral usa `ROW_NUMBER()` com desempate estável.** O pódio final precisa
de ordem única (1, 2, 3, 4...) mesmo que a soma de duas equipes seja idêntica.
`ROW_NUMBER()` nunca repete número, e o desempate fixo garante que a mesma dupla
empatada saia sempre na mesma ordem, toda vez que a função rodar.

Usar `RANK()` nos dois lugares pareceria mais consistente, mas geraria pódio com
posição vaga ou dois primeiros lugares. Usar `ROW_NUMBER()` por prova esconderia
empates reais que o organizador precisa ver. A escolha depende do que cada tabela
representa, não de manter a mesma função em todo lugar por uniformidade.

### Por que a regra de pontuação mora no banco, não no backend

Dois motivos.

O recálculo tem que acontecer **mesmo quando ninguém chamou a API**. Apagar uma
bateria direto no banco, ou uma remoção em cascata que o backend não orquestrou,
continua invalidando o placar. Regra que vive na aplicação só vale quando a
aplicação é o único caminho — e aqui ela não é.

O cálculo é trabalho de conjunto: ordenar por soma de colocações, aplicar `RANK()`
com empate que pula posição, particionar por categoria, comparar arrays de
colocações elemento a elemento para desempatar. Em JavaScript viraria laço sobre
linhas trazidas do banco: mais lento, mais longo e mais fácil de divergir entre os
dois modelos.

**O custo aceito:** a regra de negócio mais importante do sistema está escrita em
plpgsql, versionada nas migrations, e não aparece em nenhum diff de JavaScript.
Quem chegar ao projeto procurando a pontuação em `src/` não vai encontrar. É
justamente por isso que está escrito aqui.

### Distribuição equilibrada das baterias

A restrição física de um box é o número de raias, não o de baterias. O organizador
informa `lanes_per_heat` e o sistema calcula quantas baterias são necessárias. A
parte não óbvia é como distribuir:

```
6 equipes, 4 raias
encher até o limite:  bateria 1 com 4, bateria 2 com 2  ->  a segunda fica vazia
equilibrado:          bateria 1 com 3, bateria 2 com 3  ->  1 raia livre em cada
```

A implementação distribui por índice (`índice % número de baterias`), o que espalha
as equipes com a menor diferença possível entre a maior e a menor bateria — nunca
mais de uma equipe. Isso importa porque a condição de prova muda conforme quantas
raias estão ocupadas ao lado: duas baterias de 3 são mais justas entre si do que
uma de 4 e outra de 2.

### Horário de bateria é hora de parede, não instante

"A bateria começa às 08:00" não é um ponto na linha do tempo universal — é o que o
relógio da parede do box vai mostrar. Por isso `heats.scheduled_time` é `TIMESTAMP`
**sem** fuso, o backend devolve como texto puro via `to_char`
(`"2026-10-31T08:00:00"`, sem Z e sem offset) e o frontend nunca constrói um `Date`
a partir disso.

A versão anterior usava `new Date(iso)` + `getUTCHours()`, no raciocínio de que o
driver `pg` devolve os dígitos crus como se fossem UTC. Não é verdade: ele
interpreta um TIMESTAMP sem fuso **no fuso do processo Node**. Medido, com 08:00
gravado no banco:

```
backend em container UTC    ->  chega "08:00Z"  ->  exibia 08:00   correto
backend no Windows (UTC-3)  ->  chega "11:00Z"  ->  exibia 11:00   errado
```

O horário exibido dependia de *onde o backend rodava*. Sem `Date`, não há fuso para
converter errado.

**A mesma classe de bug mordeu de novo, pelo outro lado.** O cadastro de campeonato
validava a data com `Joi.date().iso()`, que converte a string num `Date`; o driver
serializava no fuso do processo (-03:00 em produção) e o Postgres truncava para
`DATE`, gravando o **dia anterior**. O ALTIORA foi cadastrado como 31/10 e ficou
30/10 no banco, em produção. Hoje a data de calendário é validada como string e
nunca vira `Date`. Quatro testes de regressão conferem com `to_char` direto no
banco — porque conferir pela resposta da API passaria pela mesma conversão que
causou o bug, e não provaria nada.

### Cache de leitura nas rotas públicas

A plateia não gera carga constante: gera picos. Quando uma bateria termina, todo
mundo abre o placar no mesmo segundo. Medindo a API com concorrência crescente, o
joelho da curva ficava entre 10 e 20 clientes simultâneos.

A resposta foi um cache em memória, por rota, com TTL curto, e invalidação total a
cada escrita bem-sucedida em `/api`:

| rota | TTL | por quê |
|---|---|---|
| `GET /api/leaderboard` | 5 s | o dado mais sensível do evento; TTL curto porque a correção de verdade vem da invalidação |
| `GET /api/workouts/:id/heats` | 10 s | muda só em remanejamento |
| `GET /api/workouts` e `/:id` | 60 s | as provas são cadastradas na véspera |

Resultado medido no mesmo teste de carga: **53,8 → 130 req/s**, p95 de **796 → 197
ms**. O joelho saiu do alcance do evento.

Duas decisões dentro disso. A invalidação mora num único middleware montado em
`/api`, antes das rotas, e não em cada controller — ponto de invalidação por
controller é ponto que alguém esquece de adicionar. E o cache fica **desligado em
teste** por padrão, com um interruptor explícito para a suíte que testa o próprio
cache: cache ligado silenciosamente é a forma mais fácil de um teste passar por
motivo errado.

### Por que PostgreSQL

Não por ser "melhor que MongoDB" — a escolha depende do problema. Aqui os dados são
densamente relacionais (equipe pertence a categoria, que pertence a campeonato;
resultado pertence a uma raia de uma bateria de uma prova) e as regras que não
podem ser violadas são **propriedades do conjunto**, não de um documento:

- nome de equipe único dentro da categoria, não do campeonato (a mesma "Equipe
  Alpha" pode existir em Iniciante Masculino e em RX Misto)
- uma raia não pode ter duas equipes na mesma bateria
- a soma de colocações de uma categoria tem que ser consistente com as colocações
  individuais

Isso é `UNIQUE`, `FOREIGN KEY`, `CHECK` e constraint `DEFERRABLE` — garantido pelo
banco, não pela aplicação. Uma condição que o banco não garante é uma condição que
vai ser violada por algum caminho que ninguém previu, e num evento ao vivo não há
tempo de descobrir qual.

O resultado concreto: `results` aponta para `heat_teams` (a atribuição de raia), não
para `teams`. Mover uma equipe de bateria carrega os resultados dela junto, sem
migração de dado nem código de sincronização.

---

## Schema

14 tabelas. Resumo das relações; o detalhe está em
[ARCHITECTURE.md](./ARCHITECTURE.md).

```
users (organizadores)

championships
├─ categories (5 padrão: Iniciante M/F, Scale M/F, RX Misto)
│  └─ teams (únicas por categoria; athlete_1, athlete_2)
├─ workouts (provas, com scoring_type e scoring_type_2)
│  ├─ workout_variants (descrição e time cap por categoria)
│  ├─ workout_cuts (corte: quantas avançam, por categoria)
│  └─ heats (bateria, com scheduled_time)
│     └─ heat_teams (equipe ↔ raia)
│        └─ results (raw_value ou DNF; place calculado) ─→ result_audit_log
├─ points_tables ─→ points_table_ranges (faixas de decremento)
└─ team_standings (cache do ranking, escrito por trigger)
```

Migrations numeradas em `backend/migrations/`, aplicadas por
`backend/scripts/migrate.js`, que registra cada arquivo em `schema_migrations` e
roda cada um exatamente uma vez. **Mudança de schema só entra como migration nova;
nunca editando uma existente** — reaplicar o conjunto num banco já migrado quebra
(a 002 cria um índice sobre `heats.category_id`, que a 005 apaga), e foi esse bug
que deu origem ao script.

---

## Rodando localmente

Requisitos: Node.js 18+, Docker e Docker Compose.

```bash
git clone https://github.com/mfajunior/champ-manager.git
cd champ-manager

cp .env.example .env
# edite o .env e gere um JWT_SECRET próprio:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

docker compose up -d
cd backend && npm install && npm run migrate && cd ..
docker compose restart backend
```

Confirme em `http://localhost:5000/health`. Depois o frontend, que roda fora do
Docker:

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

Não existe usuário nem campeonato pré-cadastrado, e não existe tela de cadastro
(ver "sem autocadastro", abaixo). Crie a conta direto no banco:

```bash
cd backend
npm run create-user -- "voce@exemplo.com" "sua-senha" "Seu Nome"
```

**`npm run migrate` não é opcional nem só da primeira vez.** O `docker-compose.yml`
monta apenas `001-initial-schema.sql` em `docker-entrypoint-initdb.d`, então um
banco novo nasce no schema inicial e o app quebra de formas confusas até as
migrations seguintes rodarem. Vale o mesmo depois de um `git pull` que traga
migration nova.

Para popular um campeonato inteiro de uma vez (equipes, provas, variantes, tabela
de pontos e, opcionalmente, baterias) há o `npm run seed` com um JSON de entrada —
veja `backend/scripts/evento.exemplo.json`. Arquivos `evento-*.json` são
ignorados pelo git de propósito: eles carregam nome de atleta real.

Acesso pela rede local (celular na mesma Wi-Fi), túnel para acesso externo e
troubleshooting estão em [DEVELOPMENT.md](./DEVELOPMENT.md).

---

## Testes

186 testes (Jest + Supertest) contra um **PostgreSQL real**, não mock,
localmente e no CI a cada push e PR para `main`.

```bash
cd backend
npm run migrate:test   # o banco de teste é outro, e também precisa das migrations
npm test               # suíte inteira, em paralelo
npm run test:coverage
npm run test:handles   # em série, com detecção de handle aberto — só para depurar
```

```
backend/tests/
├─ integration/   19 arquivos: auth, campeonatos, equipes, provas, baterias,
│                 agenda, raias, corte, resultados, duas pontuações, histórico,
│                 leaderboard, tabela de pontos, recálculo em cascata, cache,
│                 websocket
└─ unit/          heatController, resultController, workoutController
```

**Por que banco real e não mock:** a regra de pontuação está em plpgsql. Um mock de
banco testaria o mock, não a regra — e a regra é o produto. O custo é que a suíte
exige Postgres de pé; o retorno é que ela pega bug de trigger, de constraint e de
fuso horário, que foi exatamente onde os bugs reais apareceram.

**Por que em paralelo:** cada arquivo cria o próprio campeonato, com nome e e-mail
únicos, e só enxerga linhas daquele `championship_id` — arquivos diferentes nunca
disputam a mesma linha. Atenção à armadilha que já custou tempo aqui:
`--detectOpenHandles` faz o Jest rodar tudo em série (ele trata a flag como
`--runInBand`, porque não rastreia handle vazado dentro de um worker). É por isso
que ela vive num script separado.

Além da suíte, `npm run smoke` monta um campeonato de volume realista falando com a
API por HTTP — 60 equipes desiguais entre as categorias, três provas de
`scoring_type` diferentes, baterias geradas, um resultado por raia com ~4% de WO —
e confere o placar no fim, reportando média e p95 do tempo de resposta do
lançamento.

**Frontend sem suíte automatizada ainda.** A verificação é um fluxo manual
ponta a ponta contra o backend real, documentado em
[frontend/README.md](./frontend/README.md). É a maior lacuna conhecida do projeto.

---

## Deploy

Em produção no Render, plano gratuito em tudo, declarado como código em
`render.yaml` — infraestrutura em arquivo em vez de cliques, o que torna a
recriação reprodutível.

Duas decisões que valem registro:

**As migrations rodam no build, não no start** (`npm ci && npm run migrate`). O
Render só troca a versão no ar depois que o build passa, então código novo nunca
encontra banco velho. A regra "migration antes do código" deixa de ser disciplina e
passa a ser automática.

**Três consequências do plano gratuito, aceitas de propósito:**

1. O web service hiberna após 15 min sem tráfego e leva cerca de um minuto para
   voltar. No dia do evento isso é coberto por um ping externo em `/health`.
2. O Postgres gratuito **expira 30 dias depois de criado**, não de usado, e é
   apagado com os dados (há um período de carência). Daí o `pg_dump` ao fim de cada
   prova não ser recomendação, e sim o plano.
3. Há um CDN na frente do serviço. Isso tem efeito sobre o rate limiting — ver
   abaixo.

---

## Segurança

**Implementado**

- Senhas com bcryptjs; JWT com expiração (72 h em produção: o organizador cadastra
  na véspera e opera na manhã seguinte — com 24 h a sessão teria vencido no pior
  momento)
- Validação de entrada com Joi, um schema por rota de escrita, antes do controller.
  Substituiu a checagem manual campo a campo, que não pegava tipo errado: um número
  enviado como texto só quebrava adiante, na query, com erro de banco confuso em
  vez de um 400 claro
- Queries sempre parametrizadas — nenhuma concatenação de string em SQL
- Helmet, CORS restrito por variável de ambiente (aceita lista, necessário para
  abrir pela rede local sem liberar para qualquer origem)
- Segredos fora do código. Eles já estiveram fixos no `docker-compose.yml`
  versionado; ao corrigir isso foram **rotacionados**, porque remover do arquivo não
  invalida um segredo que esteve no histórico do git
- Sem autocadastro: `POST /api/auth/register` foi removido de propósito. O sistema
  tem um único operador e não tem separação de papéis, então cadastro aberto deixava
  qualquer um que descobrisse a rota criar conta com acesso total
- Trilha de auditoria de resultados (`result_audit_log`): quem lançou, corrigiu ou
  apagou cada resultado

**`trust proxy` só em produção.** Atrás de um proxy, o IP real do visitante chega
só no header `X-Forwarded-For`; sem `trust proxy`, o rate limit do login vira um
balde único compartilhado por todos, e um atacante errando a senha dez vezes tranca
o login de qualquer pessoa. Mas ligar sempre seria pior: rodando exposto na rede
local, qualquer aparelho poderia forjar o header e furar o limite sozinho —
verificado com `curl`. Por isso a checagem por `NODE_ENV`.

**Limitação conhecida:** com o CDN na frente, a chave que o `express-rate-limit`
usa varia entre requisições, então o limite por IP não está efetivamente ativo em
produção. Um teste de carga com 4.735 requisições não recebeu nenhum 429. Não está
resolvido, está **medido e registrado** — a mitigação real para o evento é o cache
de leitura acima, que mudou a capacidade de 53,8 para 130 req/s.

**Fora de escopo:** 2FA, OAuth2, criptografia em repouso, auditoria de acesso geral
(a existente é escopada a resultados).

---

## Limitações conhecidas

- Frontend sem testes automatizados
- Responsividade testada no uso real do evento, não sistematicamente em vários
  aparelhos
- Rate limit por IP inoperante atrás do CDN (acima)
- Sem exportação de resultados em CSV ou PDF
- Um organizador por instalação, sem papéis nem permissões

---

## Autor

**Milton Faria Andrade Júnior** — [@mfajunior](https://github.com/mfajunior) ·
mfajunior1@gmail.com

Engenheiro de Telecomunicações em transição para desenvolvimento de software,
graduando em Engenharia da Computação. Este projeto nasceu como portfólio e virou
sistema de produção de um cliente real.

## Licença

MIT — veja [LICENSE](./LICENSE).
