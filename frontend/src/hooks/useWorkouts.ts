import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ApiEnvelope, ScoringType, Workout } from '../types';

const workoutKeys = {
  byChampionship: (championshipId: number) => ['workouts', championshipId] as const,
  detail: (id: number) => ['workouts', 'detail', id] as const,
};

export function useWorkouts(championshipId: number) {
  return useQuery({
    queryKey: workoutKeys.byChampionship(championshipId),
    queryFn: async () =>
      (await api.get<Workout[]>(`/api/workouts?championship_id=${championshipId}`)).data,
    enabled: Number.isFinite(championshipId),
  });
}

export function useWorkout(id: number) {
  return useQuery({
    queryKey: workoutKeys.detail(id),
    queryFn: async () => (await api.get<Workout>(`/api/workouts/${id}`)).data,
    enabled: Number.isFinite(id),
  });
}

interface CreateWorkoutInput {
  championship_id: number;
  workout_number: number;
  name: string;
  type?: string;
  scoring_type: ScoringType;
}

export function useCreateWorkout(championshipId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateWorkoutInput) =>
      (await api.post<Workout>('/api/workouts', input)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workoutKeys.byChampionship(championshipId) });
    },
  });
}

interface UpdateWorkoutResult {
  workout: Workout;
  warning?: string;
}

export function useUpdateWorkout(championshipId: number, workoutId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<CreateWorkoutInput>): Promise<UpdateWorkoutResult> => {
      const response = (await api.put<Workout>(
        `/api/workouts/${workoutId}`,
        input
      )) as ApiEnvelope<Workout>;
      return { workout: response.data, warning: response.meta?.warning };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workoutKeys.byChampionship(championshipId) });
      queryClient.invalidateQueries({ queryKey: workoutKeys.detail(workoutId) });
    },
  });
}

interface UpsertVariantInput {
  workoutId: number;
  categoryId: number;
  description: string;
  time_cap_seconds?: number | null;
}

export function useUpsertVariant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ workoutId, categoryId, description, time_cap_seconds }: UpsertVariantInput) =>
      api.put(`/api/workouts/${workoutId}/variants/${categoryId}`, {
        description,
        time_cap_seconds,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: workoutKeys.detail(variables.workoutId) });
    },
  });
}
