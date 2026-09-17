// test-websocket.js
// Ouve o leaderboard de UM campeonato em tempo real via WebSocket, para
// confirmar que o broadcastLeaderboard (resultController) está de fato
// emitindo o evento quando um resultado é criado, corrigido ou apagado.
//
// Não faz parte do backend em si — é só uma ferramenta de teste manual,
// porque ainda não existe frontend para consumir o evento leaderboard_updated.
//
// Uso:
//   cd backend
//   npm install --save-dev socket.io-client   (só na primeira vez)
//   node test-websocket.js <championship_id>
//
// Depois, em outro terminal, dispare uma mudança de resultado nesse mesmo
// campeonato (ex.: rodando trigger-test-broadcast.ps1 <championship_id>,
// ou o smoke-test-results.ps1 inteiro se o campeonato for novo) e observe
// o leaderboard chegando aqui, sem precisar dar refresh em nada.

const { io } = require('socket.io-client');

const championshipId = process.argv[2];

if (!championshipId) {
  console.error('Uso: node test-websocket.js <championship_id>');
  console.error('O id aparece no final de qualquer smoke-test-*.ps1: "Campeonato de teste: id=X"');
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
