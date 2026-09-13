# 🏆 Champy - Gerenciador de Campeonatos de CrossFit

Uma plataforma de código aberto para gerenciar campeonatos de CrossFit: cadastro de equipes, gestão de provas, distribuição de baterias, lançamento de resultados e leaderboard em tempo real.

## 📋 Sobre o Projeto

**Objetivo**: Solução completa para operadores e espectadores de campeonatos CrossFit, eliminando planilhas manuais e oferecendo leaderboard ao vivo.

**Inspiração**: Plataforma Champy (Tecnofit), simplificada e adaptada para campeonatos menores (10-50 equipes).

---

## ✨ Funcionalidades

### Para Operadores (Com Autenticação)
- ✅ **Gestão de Equipes**: Cadastro de equipes e categorias (Iniciante M/F, Scale M/F, RX Misto)
- ✅ **Gestão de Provas**: Criar WODs, descrever tipos e distribuir em baterias
- ✅ **Distribuição de Baterias**: Auto-gerar ou atribuir manualmente equipes a heats
- ✅ **Lançamento de Resultados**: Digitar colocações das equipes em cada prova
- ✅ **Cálculo Automático**: Sistema de pontuação linear (colocação = pontos)

### Para Atletas/Público (Sem Login)
- ✅ **Leaderboard Público**: Visualizar ranking em tempo real
- ✅ **Filtrar por Categoria**: Ver apenas sua categoria
- ✅ **Updates ao Vivo**: WebSocket atualiza placar instantaneamente

---

## 🏗️ Arquitetura

### Stack Técnico

```
Frontend (React)          →  Backend (Node.js)       →  Database (PostgreSQL)
├─ Painel Operacional     ├─ Express.js              ├─ 8 tabelas normalizadas
├─ Leaderboard Público    ├─ JWT Authentication      ├─ Triggers auto-recalc
└─ Real-time Updates      ├─ Socket.io (Real-time)   └─ Índices otimizados
                          └─ Joi Validation
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
- **Polling**: Frontend bate no servidor a cada 1s = 50 requests/s = pesado
- **Socket.io**: Conexão persistente, push de dados apenas quando há mudança
- Economia ~90% de requisições inúteis

#### **Real-time Standings Table**
```sql
-- Query sem cache (lento):
SELECT t.id, SUM(r.place) as total FROM teams t
LEFT JOIN heat_teams ht ON ...
LEFT JOIN results r ON ...
GROUP BY t.id
ORDER BY total -- executada a cada refresh

-- Com cache (rápido):
SELECT * FROM team_standings 
WHERE championship_id = ? 
ORDER BY place -- executada em <10ms
-- Auto-atualizado por TRIGGER após cada resultado
```

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
  │   └─ teams (múltiplos)
  │       └─ heat_teams (múltiplos)
  │           └─ results (1 por workout)
  ├─ workouts (múltiplos WODs)
  │   └─ heats (por categoria)
  │       └─ heat_teams (associação)
  └─ team_standings (cache de rankings)
```

### Exemplo de Fluxo de Dados

```
1. ADMIN cria Championship "Brasileirão 2024"
   └─ Sistema cria automaticamente 5 Categories

2. OPERADOR registra Team "Guerreiros RJ" em "Scale Feminino"

3. OPERADOR cria Workout "5 rounds: 10 thrusters, 10 pull-ups"
   └─ Sistema auto-distribui times em Heats por categoria

4. DURANTE PROVA: OPERADOR digita que "Guerreiros RJ" ficou em 2º lugar
   └─ Sistema insere Result: place=2, score=2
   └─ TRIGGER recalcula team_standings
   └─ WebSocket envia novo ranking para leaderboard público

5. ATLETAS veem no leaderboard que "Guerreiros RJ" agora tem 2 pontos no total
```

---

## 🚀 Início Rápido

### Pré-requisitos
- Node.js 18+
- PostgreSQL 13+
- npm ou yarn

### Instalação

#### 1. Clone e setup do backend

```bash
# Clone o repositório
git clone https://github.com/mfajunior/champy-manager.git
cd champy-manager

# Backend
cd backend
npm install

# Configure variáveis de ambiente
cp .env.example .env
# Edite .env com suas credenciais PostgreSQL

# Execute migrations
npm run migrate

# Inicie em desenvolvimento
npm run dev
```

#### 2. Setup do frontend

```bash
cd ../frontend
npm install

cp .env.example .env
# REACT_APP_API_URL=http://localhost:5000

npm start
```

#### 3. Acesse

- **Painel Operacional**: http://localhost:3000
  - Email: `admin@champy.local`
  - Senha: (configure no .env)

- **Leaderboard Público**: http://localhost:3000/leaderboard

- **API Health**: http://localhost:5000/health

---

## 📖 Fluxo de Uso (Operador)

### 1. Criar Campeonato
```
Dashboard → Novo Campeonato → Nome, Data, Local → Salvar
Resultado: 5 categorias criadas automaticamente
```

### 2. Registrar Equipes
```
Equipes → Adicionar → Nome, Categoria → Salvar
```

### 3. Criar Provas (WODs)
```
Provas → Novo WOD → Número, Descrição, Tipo → Salvar
Resultado: Baterias auto-distribuídas por categoria
```

### 4. Lançar Resultados
```
Resultados → Selecionar WOD → Selecionar Bateria → Digitar colocações → Salvar
Resultado: 
  - Pontuação recalculada
  - Leaderboard atualiza em tempo real
  - Espectadores veem mudanças instantaneamente
```

### 5. Acompanhar Ranking
```
Leaderboard (público) → Filtra por categoria → Vê times ordenados por total de pontos
```

---

## 💾 Sistema de Pontuação (Explicado)

### Regra: Colocação = Pontos (Menor é Melhor)

```
Campeonato com 4 WODs, 3 equipes

┌─ WOD 1 ──────────┐
│ Equipe A: 1º → 1pt
│ Equipe B: 2º → 2pts
│ Equipe C: 3º → 3pts
└───────────────────┘

┌─ WOD 2 ──────────┐
│ Equipe A: 3º → 3pts
│ Equipe B: 1º → 1pt
│ Equipe C: 2º → 2pts
└───────────────────┘

┌─ WOD 3 ──────────┐
│ Equipe A: 2º → 2pts
│ Equipe B: 3º → 3pts
│ Equipe C: 1º → 1pt
└───────────────────┘

┌─ WOD 4 ──────────┐
│ Equipe A: 2º → 2pts
│ Equipe B: 1º → 1pt
│ Equipe C: 3º → 3pts
└───────────────────┘

RANKING FINAL (menor score vence):
1. Equipe A: 1+3+2+2 = 8 pontos ✅ CAMPEÃ
2. Equipe B: 2+1+3+1 = 7 pontos
3. Equipe C: 3+2+1+3 = 9 pontos
```

**Implementação no Banco**:
```sql
-- Trigger recalcula isto automaticamente:
SELECT 
  team_id,
  SUM(place) as total_score,
  ROW_NUMBER() OVER (ORDER BY SUM(place)) as final_place
FROM results
GROUP BY team_id
```

---

## 🔐 Segurança

### Implementada
- ✅ Senhas hasheadas com bcryptjs (10 rounds)
- ✅ JWT com expiração (24h)
- ✅ CORS restrito ao domínio
- ✅ Helmet.js (headers HTTP)
- ✅ SQL Injection prevenido (queries parametrizadas)
- ✅ Rate limiting em endpoints de auth
- ✅ Validação de entrada com Joi

### Não Implementada (Por Escopo)
- ❌ 2FA (MFA)
- ❌ OAuth2 (Google, GitHub)
- ❌ Auditoria detalhada
- ❌ Criptografia de dados sensíveis

---

## 🧪 Testes

```bash
# Backend
cd backend
npm test

# Coverage
npm run test:coverage

# Frontend
cd ../frontend
npm test
npm run test:coverage
```

---

## 📱 Responsividade

- ✅ Painel operacional: Desktop + Tablet
- ✅ Leaderboard público: Desktop, Mobile (portrait/landscape)
- ✅ Otimizado para telões em locais de competição

---

## 🚢 Deployment

### Backend (Railway, Render, DigitalOcean)

```bash
# Build
npm run build

# Start
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
npm run build
# Deploy pasta ./build
```

---

## 📝 Roadmap

### MVP (Atual)
- ✅ CRUD Equipes
- ✅ Gestão de Provas/Baterias
- ✅ Lançamento de Resultados
- ✅ Leaderboard Real-time

### v0.2 (Próximo)
- ⏳ Exportar resultados (CSV/PDF)
- ⏳ Impressão de súmulas
- ⏳ Histórico de campeonatos
- ⏳ Múltiplos campeonatos simultâneos

### v0.3 (Futuro)
- ⏳ App Mobile (React Native)
- ⏳ Cronometragem integrada
- ⏳ Sistema de byes/faltas
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
- Stack: Express.js, React, PostgreSQL, Socket.io comunidade
- Feedback: Comunidade CrossFit Brasil

---

**⭐ Se este projeto foi útil, considere dar uma estrela!**
