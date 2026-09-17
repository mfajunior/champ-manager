# 🏆 Champy - Gerenciador de Campeonatos de CrossFit

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
- ⏳ **Updates ao Vivo (WebSocket)**: o servidor já inicializa Socket.io e aceita inscrição por campeonato (`server.js`), mas nenhum controller chama a função de broadcast ainda. Hoje é preciso um novo GET para ver o ranking atualizado — não é uma feature pronta, é infraestrutura à espera de ser ligada.

---

## 🏗️ Arquitetura

### Stack Técnico

```
Frontend (React)          →  Backend (Node.js)       →  Database (PostgreSQL)
├─ Painel Operacional     ├─ Express.js              ├─ 10 tabelas normalizadas
├─ Leaderboard Público    ├─ JWT Authentication      ├─ Triggers auto-recalc
└─ (ainda não iniciado)   ├─ Socket.io (preparado,   └─ Índices otimizados
                          │  broadcast não ligado)
                          └─ Validação manual por controller
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

#### **Socket.io vs Polling — decisão tomada, implementação pela metade**
- **Polling**: frontend bate no servidor a cada 1s = 50 requests/s = pesado
- **Socket.io**: conexão persistente, push de dados só quando há mudança
- **Status real**: o servidor já sobe com Socket.io e um evento `subscribe_championship` (`backend/src/server.js`), com uma função `broadcastLeaderboardUpdate` pronta para emitir. Só que nenhum controller a chama — lançar, corrigir ou apagar um resultado hoje não dispara nada pelo socket. A decisão está tomada e a infraestrutura está de pé; falta ligar o fio entre "resultado mudou" e "avisar quem está ouvindo". Registro isso aqui de propósito, para não passar a impressão de que o real-time já funciona.

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
   └─ (leaderboard fica correto na próxima consulta; broadcast em tempo real ainda não está ligado)

5. ATLETAS consultam o leaderboard e veem "Guerreiros RJ" na posição atualizada
```

---

## 🚀 Início Rápido

### Pré-requisitos
- Node.js 18+
- PostgreSQL 13+
- Docker + Docker Compose

### Instalação

```bash
# Clone o repositório
git clone https://github.com/mfajunior/champy-manager.git
cd champy-manager

# Configure variáveis de ambiente (nunca versione o .env real)
cp .env.example .env
# Edite .env com suas credenciais e gere um JWT_SECRET novo:
#   openssl rand -hex 32

# Suba banco + backend
docker compose up -d

# Rode as migrations dentro do container do banco
docker compose cp backend/migrations/. postgres:/tmp/migrations
docker compose exec postgres sh -c 'for f in /tmp/migrations/*.sql; do psql -U $POSTGRES_USER -d $POSTGRES_DB -f "$f"; done'

docker compose restart backend
```

### Acesse

- **API Health**: http://localhost:5000/health
- **Endpoints**: veja `ARCHITECTURE.md` para o schema completo e `smoke-test*.ps1` na raiz do projeto para exemplos reais de cada chamada

O frontend (painel operacional + leaderboard) ainda não foi iniciado — hoje o projeto é só a API.

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
- ✅ CORS restrito por variável de ambiente (`CORS_ORIGIN`)
- ✅ Helmet.js (headers HTTP)
- ✅ SQL Injection prevenido (queries sempre parametrizadas, nunca concatenação de string)
- ✅ Segredos fora do código-fonte: `docker-compose.yml` exige `DB_PASSWORD`, `JWT_SECRET` etc. via `.env` não versionado. Antes eram valores fixos direto no arquivo versionado — foram rotacionados ao corrigir isso, porque só remover do arquivo não invalida um segredo que já esteve no histórico do git
- ✅ Validação de entrada manual em cada controller (campos obrigatórios, tipos e regras de negócio checados antes de tocar no banco)

### Não implementada (apesar de aparecer no `package.json`)
- ❌ **Joi**: está instalado como dependência, mas nenhum controller o importa — toda validação hoje é feita "na mão" com `if`/mensagens de erro custom. Fica como decisão pendente: ou passa a ser usado de verdade, ou é removido do `package.json` — do jeito que está, é peso morto que sugere uma camada de schema validation que não existe.
- ❌ **Rate limiting em endpoints de auth**: não há nenhum middleware de rate limit no projeto.
- ❌ 2FA (MFA), OAuth2, auditoria detalhada, criptografia de dados sensíveis — fora de escopo, sem pretensão de implementar.

---

## 🧪 Testes

Não há testes unitários ainda: `jest` e `supertest` estão como devDependencies, mas nenhum arquivo de teste foi escrito — `npm test` roda o Jest contra uma suíte vazia.

O que existe hoje é validação de integração via PowerShell, rodando contra o backend local de verdade (banco incluso):

```powershell
.\smoke-test.ps1              # auth, campeonatos, equipes, provas, baterias
.\smoke-test-results.ps1      # lançamento de resultado, empate, DNF, correção e recálculo
.\smoke-test-leaderboard.ps1  # scoring_type e leaderboard por categoria
```

Cada script cria seu próprio campeonato de teste (não reaproveita dados) e imprime OK/FALHA por etapa. Não substitui testes automatizados em CI, mas cobre de ponta a ponta o fluxo que mais importa neste projeto — é a próxima melhoria de qualidade planejada.

---

## 📱 Responsividade

O frontend ainda não foi iniciado, então não há nada a avaliar aqui hoje.

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

### Frontend (Vercel, Netlify) — quando existir

```bash
npm run build
# Deploy pasta ./build
```

---

## 📝 Roadmap

### MVP (Atual)
- ✅ CRUD Equipes
- ✅ Gestão de Provas/Baterias (com variantes por categoria e `scoring_type`)
- ✅ Lançamento de Resultados (colocação sempre calculada, com empate e DNF)
- ✅ Leaderboard por categoria (consulta via API)
- ⏳ Leaderboard em tempo real — infraestrutura de WebSocket já existe (`server.js`), falta ligar o broadcast aos controllers de resultado

### v0.2 (Próximo)
- ⏳ Ligar o Socket.io ao fluxo de resultados (real-time de fato)
- ⏳ Testes automatizados (Jest) substituindo os smoke tests manuais em PowerShell
- ⏳ Decidir entre usar Joi de verdade ou remover a dependência não utilizada
- ⏳ Frontend em React (painel operacional + leaderboard público)
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

Encontrou um bug? Abra uma [issue](https://github.com/mfajunior/champy-manager/issues).

Dúvidas? Cria uma [discussion](https://github.com/mfajunior/champy-manager/discussions).

---

## 🙏 Agradecimentos

- Inspiração: Plataforma Champy (Tecnofit)
- Stack: Express.js, PostgreSQL, Socket.io

---

**⭐ Se este projeto foi útil, considere dar uma estrela!**
