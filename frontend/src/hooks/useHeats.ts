import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Heat } from '../types';

const heatKeys = {
  byWorkout: (workoutId: number) => ['heats', workoutId] as const,
};

export function useHeats(workoutId: number) {
  return useQuery({
    queryKey: heatKeys.byWorkout(workoutId),
    queryFn: async () => (await api.get<Heat[]>(`/api/workouts/${workoutId}/heats`)).data,
    enabled: Number.isFinite(workoutId),
  });
}

// category_id/lanes_per_heat saíram daqui: raias virou parâmetro global do
// campeonato (championship.lanes_per_heat — ver migration 005), e a prova
// inteira é gerada de uma vez, cruzando todas as categorias com equipe
// cadastrada, não mais uma categoria por chamada.
interface GenerateHeatsInput {
  force?: boolean;
  // Ordena as equipes de cada categoria pela colocação atual, do pior pro
  // melhor — ver heatController.generate. Sem ele, a ordem é a de cadastro.
  order_by_standings?: boolean;
}

export function useGenerateHeats(workoutId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: GenerateHeatsInput) =>
      (await api.post<Heat[]>(`/api/workouts/${workoutId}/heats`, input)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: heatKeys.byWorkout(workoutId) });
    },
  });
}

/**
 * Remanejamento manual de raias (migration 016).
 *
 * Duas operações em vez de uma porque são situações diferentes: TROCAR quando
 * o destino está ocupado, MOVER quando está livre. Quem decide qual chamar é
 * a tela, pelo que ela já sabe — o organizador clica num lugar só.
 *
 * Invalida a prova inteira, não a bateria: remanejar muda a duração das
 * baterias afetadas (ela sai do maior time cap entre as categorias presentes)
 * e o backend reagenda o campeonato a partir dali, então o horário de TODAS
 * as baterias seguintes pode ter mudado.
 */
export function useSwapLanes(workoutId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { heat_team_id_a: number; heat_team_id_b: number }) =>
      api.post('/api/heats/lanes/swap', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: heatKeys.byWorkout(workoutId) });
    },
  });
}

export function useMoveLane(workoutId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      heatTeamId,
      ...input
    }: {
      heatTeamId: number;
      heat_id: number;
      lane_number: number;
    }) => api.put(`/api/heats/lanes/${heatTeamId}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: heatKeys.byWorkout(workoutId) });
    },
  });
}
