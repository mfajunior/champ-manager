import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { AuditLogEntry, Result } from '../types';

const heatKeysByWorkout = (workoutId: number) => ['heats', workoutId] as const;
const historyKey = (heatTeamId: number) => ['results', 'history', heatTeamId] as const;

interface CreateResultInput {
  heat_team_id: number;
  raw_value?: number;
  did_not_finish?: boolean;
}

// Toda mutação de resultado invalida a lista de baterias da prova (que já
// traz o resultado embutido por raia — ver heatController.getByWorkout no
// backend), não uma lista de resultados separada.
export function useCreateResult(workoutId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateResultInput) =>
      (await api.post<Result>('/api/results', input)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: heatKeysByWorkout(workoutId) });
    },
  });
}

interface UpdateResultInput {
  id: number;
  raw_value?: number;
  did_not_finish?: boolean;
}

export function useUpdateResult(workoutId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateResultInput) =>
      (await api.put<Result>(`/api/results/${id}`, body)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: heatKeysByWorkout(workoutId) });
    },
  });
}

export function useDeleteResult(workoutId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => api.delete(`/api/results/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: heatKeysByWorkout(workoutId) });
    },
  });
}

export function useResultHistory(heatTeamId: number | null) {
  return useQuery({
    queryKey: historyKey(heatTeamId ?? -1),
    queryFn: async () =>
      (await api.get<AuditLogEntry[]>(`/api/results/heat-teams/${heatTeamId}/history`)).data,
    enabled: heatTeamId !== null,
  });
}
