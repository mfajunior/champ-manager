# 🏆 ScoreUp - Gerenciador de Campeonatos de CrossFit

[![Backend Tests](https://github.com/mfajunior/champ-manager/actions/workflows/backend-tests.yml/badge.svg)](https://github.com/mfajunior/champ-manager/actions/workflows/backend-tests.yml)

Uma plataforma de código aberto para gerenciar campeonatos de CrossFit: cadastro de equipes, gestão de provas, distribuição de baterias, lançamento de resultados e leaderboard por categoria.

## 📋 Sobre o Projeto

**Objetivo**: Solução completa para operadores e espectadores de campeonatos CrossFit, eliminando planilhas manuais.

**Inspiração**: Plataforma Champy (Tecnofit), simplificada e adaptada para campeonatos menores (10-50 equipes).

---

## ✨ Funcionalidades

### Para Operadores (Com Autenticação)
- ✅ **Gestão de Equipes**: cadastro de equipes por categoria (Iniciante M/F, Scale M/F, RX Misto)
- ✅ **Gestão de Provas**: criação de WODs com uma variante por categoria (cargas/movimentos diferentes) e `scoring_type` (tempo, reps ou carga) — decide como a colocação daquela prova é calculada
- ✅ **Distribuição de Baterias**: geração automática balanceada por número de raias do box
- ✅ **Lançamento de Resultados**: o operador registra só o desempenho bruto (tempo, reps, carga ou DNF) — a colocação nunca é digitada, é sempre calculada
- ✅ **Leaderboard por Categoria**: ranking calculado automaticamente a partir dos resultados

### Para Atletas/Público (Sem Login)
- ✅ **Leaderboard Público**: consulta de ranking via API, filtrável por categoria
- ✅ **Updates ao Vivo (WebSocket)**: toda vez que um resultado é lançado, corrigido ou apagado, `resultController` busca o leaderboard fresco e emite `leaderboard_updated` para quem estiver inscrito naquele campeonato — sem precisar de refresh ou novo GET. Coberto por `tests/integration/websocket.test.js` (cliente real de `socket.io-client`) e, manualmente, por `backend/test-websocket.js`; no frontend, validado de ponta a ponta com o placar público atualizando sozinho (ver seção Testes).

---

## 🏗️ Arquitetura

### Stack Técnico

```
Frontend (React + Vite)   →  Backend (Node.js)       →  Database (PostgreSQL)
├─ Painel Operacional     ├─ Express.js              ├─ 10 tabelas normalizadas
├─ Leaderboard Público    ├─ JWT Authentication      ├─ Triggers auto-recalc
└─ TanStack Query +       ├─ Socket.io (broadcast    └─ Índices otimizados
   Socket.io-client       │  ligado ao resultController)
                          └─ Validação com Joi por rota
```

### Por Quê Estas Escolhas?

#### **PostgreSQL vs MongoDB**
| Aspecto | PostgreSQL | MongoDB |
|---------|-----------|---------|
| Relações | Nativas (Foreign Keys) | Denormalizadas |
| Integridade | UNIQUE constraints | Aplicação |
| Agregações | SUM/GROUP BY (rápido) | Pipeline complexo |
| **Nossa escolha** | ✅ Sim | ❌ Excessivamente complexo |

**Motivo**: Dados de campeonato são altamente relacionais. Equipes → Provas → Resultados. PostgreSQL garante integridade com constraints do banco.

#### **JWT vs Session**
- **JWT**: Stateless, escalável, sem servidor de sessão necessário
- Ideal para arquitetura simples (nosso caso)

#### **Socket.io vs Polling**
- **Polling**: frontend bate no servidor a cada 1s = 50 requests/s = pesado
- **Socket.io**: conexão persistente, push de dados só quando há mudança
- **Como está ligado**: o servidor sobe com Socket.io e um evento `subscribe_championship` (`backend/src/server.js`) que coloca o cliente numa sala `championship:<id>`. Dentro de `resultController` (`create`, `update` e `delete`), depois que o banco já processou a escrita e o trigger já recalculou `team_standings`, uma função `broadcastLeaderboard` busca o ranking fresco daquele campeonato e chama `broadcastLeaderboardUpdate`, que emite `leaderboard_updated` só para quem está naquela sala — quem está vendo outro campeonato não recebe nada. Uma falha no broadcast (cliente caiu, erro de rede) fica isolada num `try/catch` e nunca derruba a resposta HTTP de quem lançou o resultado, porque o dado já foi salvo com sucesso antes do broadcast ser tentado.

#### **Colocação sempre calculada, nunca digitada**

A tentação óbvia era deixar o operador digitar a colocação de cada equipe. O problema: qualquer correção de resultado (equipe que relançou errado, desclassificação depois de revisão) obrigaria a recalcular manualmente todas as outras colocações daquela prova — escala mal e é fonte garantida de erro humano num campeonato ao vivo, sob pressão de tempo.

A solução: `results` guarda só o dado bruto (`raw_value` — tempo em segundos, número de reps ou carga levantada — ou `did_not_finish`). A coluna `place` é preenchida por um trigger, nunca pelo cliente:

```sql
-- Roda depois de qualquer INSERT, UPDATE ou DELETE em results
CREATE TRIGGER trg_result_changed
  AFTER INSERT OR UPDATE OR DELETE ON results
  FOR EACH ROW
  EXECUTE FUNCTION trigger_result_changed();
```

`trigger_result_changed()` encadeia duas funções: `recalculate_placements()` (recoloca as equipes daquela prova/categoria) e `recalculate_standings()` (refaz o ranking geral do campeonato a partir de todas as colocações). O operador lança um número; o sistema garante que todo o resto do campeonato fica consistente sozinho.

**Risco que isso introduz**: uma função que altera a própria tabela que a disparou pode entrar em recursão infinita — `recalculate_placements` faz um `UPDATE` em `results`, que é exatamente a tabela com o trigger. Sem tratamento, cada `UPDATE` dispararia o trigger de novo, que faria outro `UPDATE`, e assim por diante até estourar o limite de profundidade do Postgres. A trava é `pg_trigger_depth() > 1`: se a função já está rodando dentro de outro disparo do mesmo trigger, ela simplesmente retorna sem recalcular de novo. Foi um bug real, encontrado e corrigido em teste local antes de qualquer dado real passar por ele.

#### **RANK() nos resultados da prova vs. ROW_NUMBER() no leaderboard final**

O sistema usa duas funções de ranking do PostgreSQL de propósito, para dois problemas diferentes:

- **Colocação dentro de uma prova (`recalculate_placements`) usa `RANK()`**: duas equipes empatadas na mesma prova devem dividir a mesma colocação, e a próxima colocação pula o número certo de posições (1º, 2º, 2º, **4º** — não 3º). É assim que um campeonato de verdade registra empate.

  ```sql
  RANK() OVER (
    ORDER BY
      did_not_finish ASC,                                              -- DNF sempre por último
      CASE WHEN scoring_type = 'time' THEN raw_value END ASC,          -- tempo: menor vence
      CASE WHEN scoring_type IN ('reps','load') THEN raw_value END DESC -- reps/carga: maior vence
  )
  ```

- **Ranking geral do campeonato (`recalculate_standings`) usa `ROW_NUMBER()` com desempate por `team_id`**: aqui o pódio final precisa de uma ordem única e estável (1, 2, 3, 4...), mesmo que a soma de pontos de duas equipes seja idêntica. `ROW_NUMBER()` nunca repete número; o `team_id` como critério de desempate garante que a mesma dupla empatada sempre saia na mesma ordem, toda vez que a função rodar de novo.

  Usar `RANK()` nos dois lugares pareceria mais "consistente", mas geraria pódios com posições vagas ou dois primeiros lugares — errado para uma classificação final. Usar `ROW_NUMBER()` nas colocações por prova esconderia empates reais que o operador precisa ver. A escolha depende do que cada tabela representa, não de manter a mesma função em todo lugar por uniformidade.

#### **Distribuição balanceada das baterias (round-robin)**

A restrição física de um box é o número de raias, não o número de baterias — o operador informa `lanes_per_heat` e o sistema calcula quantas baterias são necessárias. A parte não óbvia é como distribuir as equipes:

```
6 equipes, 4 raias
❌ "Encher até o limite":    bateria 1 com 4, bateria 2 com 2  → 2ª bateria claramente mais vazia
✅ Balanceado (round-robin): bateria 1 com 3, bateria 2 com 3  → 1 raia livre em cada
```

A implementação distribui por índice (`índice % número de baterias`), o que espalha as equipes em grupos com o mínimo de diferença possível entre o maior e o menor (nunca mais que 1 equipe). Isso importa porque a condição de prova muda dependendo de quantas raias estão ocupadas ao lado — duas baterias de 3 são mais justas entre si do que uma de 4 e outra de 2.

---

## 📊 Schema de Dados

### Diagrama Entidade-Relacionamento

```
users (operadores)
  ├─ created_by ──→ championships
  ├─ registered_by ──→ teams
  ├─ recorded_by ──→ results
  └─ created_by ──→ workouts

championships (1 campeonato ativo por vez)
  ├─ categories (5: Iniciante M/F, Scale M/F, RX Misto)
  │   └─ teams (múltiplos, únicos por categoria)
  │       └─ heat_teams (múltiplos)
  │           └─ results (1 por bateria — raw_value ou did_not_finish; place calculado)
  ├─ workouts (múltiplos WODs, com scoring_type)
  │   ├─ workout_variants (descrição/time_cap por categoria)
  │   └─ heats (por categoria)
  │       └─ heat_teams (associação time ↔ raia)
  └─ team_standings (cache de ranking, por categoria)
```

### Exemplo de Fluxo de Dados

```
1. ADMIN cria Championship "Brasileirão 2026"
   └─ Sistema cria automaticamente 5 Categories

2. OPERADOR registra Team "Guerreiros RJ" em "Scale Feminino"

3. OPERADOR cria Workout "5 rounds: 10 thrusters, 10 pull-ups" com scoring_type='time'
   └─ OPERADOR gera baterias informando raias disponíveis
      → Sistema distribui os times de forma balanceada (round-robin)

4. DURANTE A PROVA: OPERADOR lança que "Guerreiros RJ" fez 5:32 (raw_value=332)
   └─ Trigger calcula o place daquela prova via RANK()
   └─ Trigger refaz o ranking geral do campeonato via ROW_NUMBER()
   └─ resultController busca o leaderboard fresco e emite leaderboard_updated via WebSocket

5. ATLETAS veem "Guerreiros RJ" subir de posição no placar público na hora, sem dar refresh
```

---

## 🚀 Início Rápido

### Pré-requisitos
- Node.js 18+
- Docker + Docker Compose
- npm

### 1. Clonar e configurar variáveis de ambiente

```bash
git clone https://github.com/mfajunior/champ-manager.git
cd champ-manager

# .env da raiz — lido pelo docker-compose.yml (banco + backend em container)
cp .env.example .env
# Edite .env com suas credenciais e gere um JWT_SECRET novo:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### 2. Backend + banco de dados

```bash
# Sobe Postgres e o backend
docker compose up -d

# OBRIGATÓRIO: aplica as migrations pendentes
cd backend && npm install && npm run migrate && cd ..

docker compose restart backend
```

Confirma que subiu: `http://localhost:5000/health` deve responder `{"status":"ok",...}`.

O `npm run migrate` não é opcional nem só da primeira vez. O `docker-compose.yml` monta
apenas `001-initial-schema.sql` em `docker-entrypoint-initdb.d`, então um banco novo nasce
no schema de 2023 — com `heats.category_id`, coluna que a migration 005 removeu — e o app
quebra de formas confusas até as migrations seguintes rodarem. Vale o mesmo depois de dar
`git pull` numa branch que traga migration nova.

Rode sempre por esse script, nunca aplicando os `.sql` na mão com `psql`: ele registra cada
arquivo aplicado em `schema_migrations` e executa cada um exatamente uma vez. Reaplicar tudo
do zero num banco já migrado quebra — a 002 cria um índice sobre `heats.category_id`, que a
005 apaga —, e foi justamente esse bug que deu origem ao script (ver o comentário no topo de
`backend/scripts/migrate.js`).

Para desenvolver o backend com hot-reload, sem rebuildar o container a cada mudança, é possível também
subir só o banco (`docker compose up -d postgres`) e rodar o backend direto no host com
`cd backend && npm install && npm run dev` — nesse caso ele lê `backend/.env`
(copie de `backend/.env.example`), não o `.env` da raiz.

### 3. Frontend

O frontend é um projeto Vite à parte, roda fora do Docker:

```bash
cd frontend
npm install
cp .env.example .env    # aponta para http://localhost:5000 por padrão
npm run dev             # abre em http://localhost:3000
```

Não existe usuário nem campeonato pré-cadastrado, e não existe mais tela de cadastro (o app tem um
único operador — o organizador — sem autocadastro público). Crie sua conta direto no banco:

```bash
cd backend
npm run create-user -- "seu@email.com" "sua-senha" "Seu Nome"
```

### Acessando pelo celular (mesma rede Wi-Fi)

O Vite já escuta em `0.0.0.0` (não só `localhost`), e o proxy configurado em `vite.config.ts`
encaminha `/api` e `/socket.io` pro backend do lado do servidor — o navegador de quem acessa nunca
precisa saber que a porta 5000 existe. Isso significa que não é mais preciso mexer em
`VITE_API_URL` nem em `CORS_ORIGIN` só para abrir pelo celular:

1. Descubra o IP local do seu PC (Windows: `ipconfig`, procure "Endereço IPv4" no adaptador Wi-Fi —
   algo como `192.168.x.x`)
2. No celular, na mesma rede Wi-Fi, acesse `http://<seu-IP>:3000`

Se não abrir mesmo com o IP certo, o suspeito nº 1 é o Firewall do Windows bloqueando conexão de
entrada na porta 3000 vinda de outro aparelho (a 5000 nem precisa mais estar acessível de fora —
só o processo do Vite, na própria máquina, fala com ela).

### Publicando temporariamente para acesso externo (túnel)

Pra alguém fora da sua rede (ex.: um cliente) acessar sem você contratar hospedagem ainda, dá pra
usar um túnel: um programa que cria uma URL pública (tipo `https://algo-aleatorio.trycloudflare.com`)
e redireciona pro seu `localhost`. Só funciona enquanto o túnel, o `npm run dev` do frontend e o
`docker compose` do backend estiverem rodando na sua máquina — se qualquer um deles cair, o link para
de funcionar.

Usando [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
(gratuito, sem precisar criar conta pra um túnel temporário):

1. Instale o `cloudflared` ([instruções por sistema operacional](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/))
2. Com o backend (`docker compose up`) e o frontend (`npm run dev`, dentro de `frontend/`) já
   rodando, abra um terminal à parte e rode:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
3. O terminal mostra uma URL `https://....trycloudflare.com` — é essa que você manda pro cliente
4. Só o frontend (porta 3000) precisa de túnel: como ele já fala com o backend via proxy (ver acima),
   uma URL só é suficiente pras duas pontas funcionarem

Essa URL muda toda vez que você reinicia o `cloudflared` — se isso for um problema (cliente
guardando o link, por exemplo), o próximo passo natural é uma hospedagem de verdade (ver seção
"Deployment" abaixo), que dá uma URL fixa e não depende do seu PC ficar ligado.

### Acesse

- **Frontend**: http://localhost:3000
- **API Health**: http://localhost:5000/health
- **Endpoints**: veja `ARCHITECTURE.md` para o schema completo e `backend/tests/integration/` para exemplos reais de cada chamada (é a suíte que roda no CI, então os exemplos não envelhecem sem alguém perceber)

---

## 💾 Sistema de Pontuação (Explicado)

### Regra: soma das colocações em cada prova, menor vence

```
Campeonato com 3 WODs, 3 equipes na mesma categoria

┌─ WOD 1 (FOR_TIME) ────────┐  ┌─ WOD 2 (AMRAP) ────────────┐  ┌─ WOD 3 (FOR_TIME) ─────────┐
│ Equipe A: 500s  → 1º → 1pt│  │ Equipe A: 120 reps → 2º → 2pt│ │ Equipe A: DNF   → 3º → 3pt │
│ Equipe B: 500s  → 1º → 1pt│  │ Equipe B: 140 reps → 1º → 1pt│ │ Equipe B: 480s  → 1º → 1pt │
│ Equipe C: 600s  → 3º → 3pt│  │ Equipe C: 100 reps → 3º → 3pt│ │ Equipe C: 500s  → 2º → 2pt │
└────────────────────────────┘  └─────────────────────────────┘  └────────────────────────────┘
   ↑ A e B empatam: RANK()          ↑ maior vence, porque              ↑ DNF sempre por último,
   dá 1º pra ambas e pula              scoring_type='reps'                mesmo sem raw_value
   direto pro 3º (sem "2º")

RANKING FINAL (soma das colocações, menor vence):
1. Equipe B: 1+1+1 = 3 pontos ✅ CAMPEÃ
2. Equipe A: 1+2+3 = 6 pontos
3. Equipe C: 3+3+2 = 8 pontos
```

O `scoring_type` de cada prova (`time`, `reps` ou `load`) decide a direção do `ORDER BY` dentro de `recalculate_placements` — é o que faz uma prova AMRAP (mais reps é melhor) e uma FOR_TIME (menos tempo é melhor) conviverem no mesmo campeonato sem código duplicado por tipo de prova. Esse campo já existiu como coluna desde cedo, mas ficou sem uso real por um tempo: toda prova nova nascia com o valor padrão do banco (`'time'`), então uma prova de AMRAP criada sem informar o campo era rankeada como se fosse contra o relógio. Bug real, encontrado nos testes e corrigido no `workoutController`.

Colocação de cada prova e ranking final são recalculados automaticamente pelo trigger descrito na seção de Arquitetura, sempre que um resultado é lançado, corrigido ou apagado — nunca por uma chamada manual do frontend.

---

## 🔐 Segurança

### Implementada
- ✅ Senhas hasheadas com bcryptjs
- ✅ JWT com expiração (24h) — `authController` e `middleware/auth.js` compartilham a mesma função de geração de token (corrigido um bug em que cada um assinava o token de um jeito diferente, deixando `req.user.id` sempre `undefined` nas rotas protegidas)
- ✅ CORS restrito por variável de ambiente (`CORS_ORIGIN`) — aceita múltiplas origens separadas por vírgula (`config/cors.js`), necessário pra abrir o frontend pela rede local sem liberar CORS pra qualquer origem
- ✅ Helmet.js (headers HTTP)
- ✅ SQL Injection prevenido (queries sempre parametrizadas, nunca concatenação de string)
- ✅ Segredos fora do código-fonte: `docker-compose.yml` exige `DB_PASSWORD`, `JWT_SECRET` etc. via `.env` não versionado. Antes eram valores fixos direto no arquivo versionado — foram rotacionados ao corrigir isso, porque só remover do arquivo não invalida um segredo que já esteve no histórico do git
- ✅ Validação de entrada com Joi (`middleware/validate.js` + `validations/schemas.js`) — um schema por rota de escrita, checado antes do controller. Substituiu a validação manual campo a campo (`if (!x) return res.status(400)...`), que não pegava tipo errado — ex.: um número mandado como texto só quebraria lá na frente, na query SQL, com um erro de banco confuso em vez de um 400 claro
- ✅ Rate limiting (`express-rate-limit`, `middleware/rateLimiter.js`) — limite baixo (10 tentativas / 15 min, por IP) em `/api/auth/login`, contra força bruta e enumeração de e-mail; limite mais alto (300 / 15 min) no resto da API, contra abuso grosseiro sem incomodar uso normal
- ✅ Sem autocadastro público — `/api/auth/register` foi removido de propósito: este sistema tem um único operador (o organizador), sem separação de papel/role entre usuários, então manter cadastro aberto deixava qualquer pessoa que descobrisse a rota criar uma conta com acesso total. Conta nova se cria direto no banco (`npm run create-user`)

### Não implementada
- ❌ 2FA (MFA), OAuth2, criptografia de dados sensíveis em repouso — fora de escopo, sem pretensão de implementar.
- ❌ Auditoria geral de acesso (quem logou, quem acessou o quê). Existe um audit log, mas escopado a resultados de prova (`result_audit_log`, migration 004) — registra quem lançou/corrigiu/apagou cada resultado, não um trilha de acessos do sistema como um todo.

---

## 🧪 Testes

### Backend

88 testes automatizados (Jest + Supertest), rodando contra um PostgreSQL real — não mock —,
localmente e no CI a cada push/PR pra `main` (badge no topo deste README,
workflow em `.github/workflows/backend-tests.yml`):

```bash
cd backend
npm test               # roda a suíte inteira
npm run test:coverage  # com relatório de cobertura
```

```
backend/tests/
├── integration/   # auth, campeonatos, equipes, provas, baterias, resultados,
│                  # leaderboard, websocket, histórico de auditoria
└── unit/          # heatController, resultController, workoutController
```

Os scripts PowerShell que existiam na raiz (`smoke-test*.ps1`) foram removidos: eram os primeiros
testes do projeto, anteriores à suíte Jest, e pararam de funcionar quando o autocadastro foi
removido e a migration 005 mudou os parâmetros de geração de baterias. Os mesmos fluxos estão
cobertos em `backend/tests/integration/`, que roda no CI.

No lugar deles entrou `backend/scripts/smoke-seed.js`, que fala com a API pelo HTTP (não insere no
banco direto, justamente pra exercitar validação, trigger de colocação e broadcast) e monta um
campeonato completo de teste: 60 equipes divididas de forma desigual entre as 5 categorias, 3 provas
— uma de cada `scoring_type` — baterias geradas e um resultado aleatório por raia, com ~4% de WO. No
fim ele confere o leaderboard (60 linhas, colocação sem buraco dentro de cada categoria, total_score
na faixa possível) e informa média e p95 do tempo de resposta do lançamento de resultado:

```bash
cd backend
npm run create-user -- "voce@exemplo.com" "sua-senha" "Seu Nome"   # se ainda não tiver conta
npm run smoke -- "voce@exemplo.com" "sua-senha"
```

Cria dados reais no banco em uso — rode contra desenvolvimento. O campeonato nasce marcado com
`[SMOKE]` no nome e pode ser arquivado ou excluído pelo painel depois.

Para checar o broadcast do WebSocket contra um servidor já rodando, sem subir e derrubar o app,
`backend/test-websocket.js` continua disponível.

### Frontend

Sem suíte automatizada ainda. A verificação até aqui foi um fluxo E2E manual com Playwright,
ponta a ponta contra o backend real: cadastro → login → campeonato → equipes → prova → baterias →
lançamento de resultado → placar público, numa aba separada e sem login, atualizando sozinho via
WebSocket quando um resultado é corrigido. Documentado com detalhe em `frontend/README.md`
("O que foi testado"). Testar componente isolado com Testing Library é o próximo passo — ver
Roadmap.

---

## 📱 Responsividade

Não testado em telas de celular/tablet ainda — o desenvolvimento até aqui foi majoritariamente em
desktop (ver `frontend/README.md`, seção "o que ainda falta"). É o próximo passo antes de considerar
o frontend pronto para uso real num campeonato, onde o operador frequentemente lança resultado pelo
celular, na beira do tatame.

---

## 🚢 Deployment

Ainda não há deploy em produção. Quando acontecer:

### Backend (Railway, Render, DigitalOcean)

```bash
npm start
```

**Variáveis necessárias**:
```
DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
JWT_SECRET (gere com: openssl rand -hex 32)
NODE_ENV=production
CORS_ORIGIN=https://seu-dominio.com
```

### Frontend (Vercel, Netlify)

```bash
cd frontend
npm run build
# Deploy da pasta ./frontend/dist (saída padrão do Vite — não "build", como em
# projetos criados com Create React App)
```

Lembre de configurar `VITE_API_URL` apontando pro backend publicado (não `localhost`) nas variáveis
de ambiente da plataforma de deploy, e adicionar a origem final do frontend em `CORS_ORIGIN` no
backend.

---

## 📝 Roadmap

### MVP (Atual)
- ✅ CRUD Equipes
- ✅ Gestão de Provas/Baterias (com variantes por categoria e `scoring_type`)
- ✅ Lançamento de Resultados (colocação sempre calculada, com empate e DNF)
- ✅ Leaderboard por categoria (consulta via API)
- ✅ Leaderboard em tempo real via WebSocket, validado com cliente de teste
- ✅ Frontend em React (painel operacional + leaderboard público), com acesso pela rede local

### v0.2 (Próximo)
- ⏳ Testes automatizados no frontend (hoje a verificação é um fluxo E2E manual — ver `frontend/README.md`)
- ⏳ Exportar resultados (CSV/PDF)
- ⏳ Histórico de campeonatos

### v0.3 (Futuro)
- ⏳ App Mobile (React Native)
- ⏳ Cronometragem integrada
- ⏳ Rankings persistentes por atleta

---

## 🤝 Contribuindo

Contribuições são bem-vindas! Por favor:

1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

---

## 📄 Licença

MIT License - veja [LICENSE](./LICENSE) para detalhes.

---

## 👤 Autor

**Milton Faria Andrade Júnior**
- GitHub: [@mfajunior](https://github.com/mfajunior)
- Email: mfajunior1@gmail.com

Desenvolvido como projeto portfolio para posição de desenvolvedor júnior.

---

## 📞 Suporte

Encontrou um bug? Abra uma [issue](https://github.com/mfajunior/champ-manager/issues).

Dúvidas? Cria uma [discussion](https://github.com/mfajunior/champ-manager/discussions).

---

## 🙏 Agradecimentos

- Inspiração: Plataforma Champy (Tecnofit)
- Stack: Express.js, PostgreSQL, Socket.io

---

**⭐ Se este projeto foi útil, considere dar uma estrela!**
