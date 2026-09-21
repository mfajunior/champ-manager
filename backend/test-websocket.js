// test-websocket.js
// Ouve o leaderboard de UM campeonato em tempo real via WebSocket, para
// confirmar que o broadcastLeaderboard (resultController) está de fato
// emitindo o evento quando um resultado é criado, corrigido ou apagado.
//
// Não faz parte do backend em si — é uma ferramenta de teste manual, útil
// pra isolar o backend do frontend: o placar público já consome esse evento
// (frontend/src/hooks/useLeaderboard.ts), então quando o placar não atualiza
// este script responde de que lado está o problema.
//
// Uso:
//   cd backend
//   npm install --save-dev socket.io-client   (só na primeira vez)
//   node test-websocket.js <championship_id>
//
// Depois dispare uma mudança de resultado nesse mesmo campeonato — lançando
// ou corrigindo um resultado pelo painel (/admin, aba Baterias), ou com um
// POST/PUT em /api/results — e observe o leaderboard chegando aqui, sem
// precisar dar refresh em nada.

const { io } = require('socket.io-client');

const championshipId = process.argv[2];

if (!championshipId) {
  console.error('Uso: node test-websocket.js <championship_id>');
  console.error('O id do campeonato aparece na URL do placar público (/placar/<id>) e em GET /api/championships');
  process.exit(1);
}

const url = process.env.BACKEND_URL || 'http://localhost:5000';
const socket = io(url);

socket.on('connect', () => {
  console.log(`Conectado ao servidor (${url}), socket id=${socket.id}`);
  socket.emit('subscribe_championship', championshipId);
  console.log(`Inscrito no campeonato ${championshipId}. Aguardando atualizações... (Ctrl+C para sair)\n`);
});

socket.on('leaderboard_updated', (standings) => {
  console.log(`\n[${new Date().toLocaleTimeString()}] leaderboard_updated recebido — ${standings.length} linha(s):`);

  const byCategory = {};
  standings.forEach((row) => {
    (byCategory[row.category_name] ||= []).push(row);
  });

  Object.entries(byCategory).forEach(([categoryName, rows]) => {
    console.log(`  ${categoryName}:`);
    rows
      .slice()
      .sort((a, b) => a.place - b.place)
      .forEach((r) => {
        console.log(`    ${r.place}º  ${r.team_name}  — ${r.total_score} pts (${r.workouts_completed} prova(s))`);
      });
  });
});

socket.on('connect_error', (err) => {
  console.error('Erro de conexão:', err.message);
  console.error('O backend está rodando (docker compose up) e ouvindo em', url, '?');
});

socket.on('disconnect', (reason) => {
  console.log('Desconectado do servidor:', reason);
});

process.on('SIGINT', () => {
  console.log('\nEncerrando...');
  socket.close();
  process.exit(0);
});
