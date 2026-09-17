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

interface GenerateHeatsInput {
  category_id: number;
  lanes_per_heat: number;
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
