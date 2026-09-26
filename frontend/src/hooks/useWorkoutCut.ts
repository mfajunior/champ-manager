import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { EligibleTeamsCategory, WorkoutCut } from '../types';

const cutKeys = {
  byWorkout: (workoutId: number) => ['workout-cut', workoutId] as const,
  eligible: (workoutId: number) => ['eligible-teams', workoutId] as const,
};

export function useWorkoutCut(workoutId: number) {
  return useQuery({
    queryKey: cutKeys.byWorkout(workoutId),
    queryFn: async () => (await api.get<WorkoutCut[]>(`/api/workouts/${workoutId}/cut`)).data,
    enabled: Number.isFinite(workoutId),
  });
}

/**
 * Quem disputa a prova, por categoria — e se as baterias já geradas ainda
 * batem com essa lista.
 *
 * `outdated` existe porque corrigir um resultado recalcula o corte na hora,
 * mas não mexe em baterias já montadas. O sistema avisa; quem decide regerar
 * é uma pessoa. Trocar quem entra na raia sem o organizador mandar seria pior
 * que a divergência.
 */
export function useEligibleTeams(workoutId: number, enabled = true) {
  return useQuery({
    queryKey: cutKeys.eligible(workoutId),
    queryFn: async () => {
      const response = await api.get<EligibleTeamsCategory[]>(
        `/api/workouts/${workoutId}/eligible-teams`
      );
      return {
        categories: response.data,
        anyOutdated: Boolean((response.meta as { any_outdated?: boolean })?.any_outdated),
      };
    },
    enabled: enabled && Number.isFinite(workoutId),
  });
}

export interface WorkoutCutInput {
  keep_top_n: number;
  /** null (ou ausente) é a linha padrão, que vale para todas as categorias. */
  category_id?: number | null;
}

export function useSetWorkoutCut(workoutId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: WorkoutCutInput) =>
      (await api.put<WorkoutCut>(`/api/workouts/${workoutId}/cut`, input)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cutKeys.byWorkout(workoutId) });
      queryClient.invalidateQueries({ queryKey: cutKeys.eligible(workoutId) });
      // Configurar corte muda is_cut e a ordem do placar (trigger da 012).
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    },
  });
}

export function useRemoveWorkoutCut(workoutId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (categoryId?: number | null) => {
      const query = categoryId ? `?category_id=${categoryId}` : '';
      return (await api.delete<null>(`/api/workouts/${workoutId}/cut${query}`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: cutKeys.byWorkout(workoutId) });
      queryClient.invalidateQueries({ queryKey: cutKeys.eligible(workoutId) });
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    },
  });
}
