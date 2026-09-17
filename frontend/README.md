# Champy — Frontend

Painel do organizador (login, campeonatos, equipes, provas, baterias, lançamento
de resultados) e o placar público ao vivo. Consome a API em `../backend`.

## Stack e por quê

- **Vite + React + TypeScript** — não Next.js: este frontend é um painel por
  trás de login (SPA de verdade), não um site com páginas que precisam de SEO
  ou renderização no servidor. Next.js resolveria um problema que este projeto
  não tem.
- **React Router** para as rotas, **TanStack Query** para todo o estado que
  vem da API (cache, `invalidateQueries` depois de cada mutação, loading/error
  de cada tela) — nenhum `useState` guardando lista de campeonato/equipe/prova
  em componente nenhum. Isso evita a categoria de bug mais comum em painel
  CRUD: tela desatualizada porque alguém esqueceu de re-buscar depois de um
  POST/PUT/DELETE.
- **Tailwind CSS v3** (não v4) — v4 muda a forma de configurar tema (via CSS,
  não `tailwind.config.js`) e ainda tem menos exemplo/discussão disponível;
  para quem está aprendendo Tailwind agora, a v3 documentada é a escolha mais
  segura.
- **socket.io-client** — o mesmo protocolo que o backend já fala
  (`backend/src/socket.js`), sem tradução no meio.

## Decisões de arquitetura

### 1. De onde vêm a paleta e a tipografia

Cores, fontes e a ausência de `border-radius` em todo componente vêm de uma
referência visual externa (ver `claude/champy-decisoes-arquitetura.md`, seção
9, no projeto) — não foi inventado nem copiado de um template pronto. O
`destructive` (`#d43628`) especificamente **não é** o valor da referência
original: foi recalculado para não colidir visualmente nem com o `brand` nem
com o `foreground`, e validado por contraste (WCAG AA, 4.5:1) — não só "por
olho".

### 2. Um cliente de API só, não um por tela

`src/lib/api.ts` centraliza a URL base, o header `Authorization: Bearer`
(quando a rota exige) e a conversão do formato de erro do backend
(`{ error: { code, message } }`) numa exceção JS (`ApiError`) com `.code` e
`.message` tipados. Sem isso, cada tela reimplementaria o mesmo
`try { ... } catch { ... }` do zero — e divergiria com o tempo.

### 3. `ApiError.code` decide o fluxo, não só a mensagem

O caso mais claro é `POST /api/workouts/:id/heats`: o backend devolve `409
RESULTS_EXIST` quando regerar as baterias apagaria resultados já lançados.
`HeatGeneratorForm` verifica especificamente `err.code === 'RESULTS_EXIST'`
para abrir um `ConfirmDialog` de "gerar mesmo assim" (reenviando com
`force: true`) — qualquer outro erro vira só uma mensagem de erro comum. A UI
reage ao **tipo** do erro, não a um texto que poderia mudar.

### 4. Modal renderiza via Portal, não onde foi chamado

`components/ui/Modal.tsx` usa `createPortal` para sempre montar em
`document.body`. Motivo concreto, não teórico: o modal de correção de
resultado e o de histórico são abertos de dentro de uma linha de tabela
(`<tr>`, em `LaneRow.tsx`) — sem portal, o `<div>` do modal nasceria como
filho direto de um `<tr>`, o que é HTML inválido (`<tr>` só aceita
`<td>`/`<th>`), e o navegador reposicionaria esse conteúdo sozinho de um jeito
imprevisível.

### 5. Leaderboard: busca inicial por HTTP, atualização por WebSocket

`useLeaderboard` faz um `GET /api/leaderboard` uma vez (estado inicial) e
depois só escuta o evento `leaderboard_updated` do Socket.io, escrevendo
direto no cache do TanStack Query via `setQueryData` — nunca refaz a
requisição HTTP a cada resultado lançado. O evento já chega com o campeonato
inteiro recalculado (é o que `resultController.broadcastLeaderboard` monta no
backend), então não sobra nada para buscar de novo.

### 6. `raw_value` não tem parser de mm:ss

O input de resultado pede o valor bruto na unidade que o `scoring_type` da
prova pede (segundos, repetições ou kg) — sem campo "minutos" + "segundos"
combinados. O backend guarda `raw_value` como `NUMERIC` puro, sem unidade
nenhuma; um parser de "3:05" → 185 só nesta camada criaria uma conversão que
não existe em nenhum outro lugar do sistema (nem no `resultController`, nem
nos testes). Ficou como próximo passo deliberado, não esquecimento.

## Rodando localmente

```bash
cd frontend
npm install
cp .env.example .env      # ajuste VITE_API_URL só se o backend não estiver em :5000
npm run dev               # abre em http://localhost:3000
```

O backend precisa estar rodando (`docker compose up -d postgres` + `npm run
dev` dentro de `backend/`) — o Vite roda propositalmente na porta 3000 porque
é o `CORS_ORIGIN` padrão que o backend já espera (`backend/src/app.js`), sem
precisar mexer no `.env` do backend.

## O que foi testado antes deste código ser considerado pronto

Rodei o fluxo inteiro num navegador de verdade (Playwright, headless) contra o
backend real com Postgres: cadastro → login → criar campeonato → registrar
duas equipes na mesma categoria → criar prova → gerar baterias → lançar
resultado de cada equipe → abrir o placar público **numa aba separada, sem
login** → corrigir o resultado da equipe que estava em 2º para ela ultrapassar
a 1ª → conferir que o placar público mudou a ordem sozinho, via WebSocket, sem
dar reload na página. Foi nesse processo que dois bugs reais foram encontrados
e corrigidos antes de qualquer coisa ser empacotada: um `new Date()` montado
errado que mostrava "Invalid Date" ao lado de todo campeonato (o backend
devolve a data já como datetime ISO completo, não como `"YYYY-MM-DD"` puro), e
dois botões com o mesmo texto ("Registrar equipe" abrindo o modal E enviando o
formulário) que deixavam a interface ambígua.

## O que ainda falta (sendo honesto)

- Sem paginação em lugar nenhum — uma lista de 200 campeonatos ou 500 equipes
  carregaria tudo de uma vez. Não é problema até o volume de dados crescer bem
  além do que um campeonato de CrossFit real tem hoje.
- Sem teste automatizado neste frontend (o backend tem 88 testes Jest; aqui,
  a verificação foi o fluxo E2E manual descrito acima, não uma suíte que roda
  sozinha no CI). Testar componente isolado com Testing Library é o próximo
  passo natural.
- `AuthContext.tsx` exporta o componente `AuthProvider` e o hook `useAuth` no
  mesmo arquivo — o Oxlint avisa (`react/only-export-components`) que isso
  atrapalha o Fast Refresh do Vite (editar esse arquivo específico recarrega a
  página inteira em vez de só o componente). Não afeta produção, só a
  experiência de desenvolvimento; separar os dois arquivos resolveria.
- Sem parser de tempo (mm:ss) no input de resultado — ver decisão 6 acima.
