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
