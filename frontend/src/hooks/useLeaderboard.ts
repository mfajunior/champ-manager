import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../lib/api';
import { subscribeToChampionship } from '../lib/socket';
import type { Standing } from '../types';

const leaderboardKey = (championshipId: number) => ['leaderboard', championshipId] as const;

/**
 * Busca inicial por HTTP (GET /api/leaderboard) + assinatura no WebSocket
 * para as atualizações seguintes. O evento 'leaderboard_updated' já vem com
 * o campeonato inteiro recalculado (ver resultController.broadcastLeaderboard
 * no backend), então a atualização é um queryClient.setQueryData direto —
 * não precisa refazer a requisição HTTP a cada resultado lançado.
 */
export function useLeaderboard(championshipId: number) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: leaderboardKey(championshipId),
    queryFn: async () =>
      (await api.get<Standing[]>(`/api/leaderboard?championship_id=${championshipId}`, {
        auth: false,
      })).data,
    enabled: Number.isFinite(championshipId),
  });

  useEffect(() => {
    if (!Number.isFinite(championshipId)) return undefined;

    const unsubscribe = subscribeToChampionship(championshipId, (standings) => {
      queryClient.setQueryData(leaderboardKey(championshipId), standings as Standing[]);
    });

    return unsubscribe;
  }, [championshipId, queryClient]);

  return query;
}
