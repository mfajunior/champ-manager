import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Padrão do React Query é refazer a query a cada foco de janela — bom
      // para a maioria dos apps, mas aqui o leaderboard já se atualiza via
      // WebSocket, e um refetch por foco só geraria requisições redundantes.
      refetchOnWindowFocus: false,
      // Medido nas telas publicas em producao: um passeio de 1,4 min por
      // Home, Provas, Leaderboard e Baterias gerou 103 requisicoes, com o
      // mesmo championships/2 pedido 15 vezes e workouts 7 vezes. Nao era
      // dado novo — era o staleTime padrao do React Query, que e 0: todo
      // componente que monta considera o cache velho e busca de novo.
      //
      // Trinta segundos nao custam frescor aqui pelo mesmo motivo que
      // justificou desligar o refetchOnWindowFocus acima: quem mantem o
      // placar atualizado e o WebSocket, nao o refetch. O que isso corta e
      // so a repeticao de ida e volta ao trocar de aba.
      staleTime: 30_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
