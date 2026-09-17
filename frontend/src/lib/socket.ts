import { io, type Socket } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// Uma única conexão para o app inteiro, criada só quando alguém precisa dela
// (autoConnect: false) — a maior parte das telas do painel não usa
// WebSocket, só a tela pública de placar (ver src/socket.js no backend:
// o evento 'leaderboard_updated' só é emitido para quem entrou na sala
// `championship:<id>` via 'subscribe_championship').
let socket: Socket | null = null;

const getSocket = (): Socket => {
  if (!socket) {
    socket = io(API_URL, { autoConnect: false });
  }
  return socket;
};

export const subscribeToChampionship = (
  championshipId: number,
  onUpdate: (standings: unknown) => void
): (() => void) => {
  const s = getSocket();

  if (!s.connected) {
    s.connect();
  }

  s.emit('subscribe_championship', championshipId);
  s.on('leaderboard_updated', onUpdate);

  // Função de limpeza: o componente chama isso no cleanup do useEffect, para
  // não acumular listener duplicado se o usuário trocar de campeonato no filtro.
  return () => {
    s.off('leaderboard_updated', onUpdate);
  };
};
