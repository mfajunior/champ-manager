import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Team, TeamWorkoutResult } from '../types';

const teamKeys = {
  byChampionship: (championshipId: number) => ['teams', championshipId] as const,
};

export function useTeams(championshipId: number) {
  return useQuery({
    queryKey: teamKeys.byChampionship(championshipId),
    queryFn: async () =>
      (await api.get<Team[]>(`/api/teams?championship_id=${championshipId}`)).data,
    enabled: Number.isFinite(championshipId),
  });
}

export function useTeamResults(teamId: number | null) {
  return useQuery({
    queryKey: ['teams', teamId, 'results'] as const,
    queryFn: async () =>
      (await api.get<{ team: { id: number; name: string }; workouts: TeamWorkoutResult[] }>(
        `/api/teams/${teamId}/results`
      )).data,
    enabled: teamId !== null,
  });
}

interface CreateTeamInput {
  championship_id: number;
  category_id: number;
  name: string;
  athlete_1?: string;
  athlete_2?: string;
}

export function useCreateTeam(championshipId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTeamInput) => (await api.post<Team>('/api/teams', input)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.byChampionship(championshipId) });
    },
  });
}

export interface UpdateTeamInput {
  name?: string;
  athlete_1?: string | null;
  athlete_2?: string | null;
}

export function useUpdateTeam(championshipId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateTeamInput & { id: number }) =>
      (await api.put<Team>(`/api/teams/${id}`, body)).data,
    onSuccess: () => {
      // Invalida equipes E baterias: o nome da equipe e os atletas aparecem
      // nas duas telas, e a de baterias traz esses campos embutidos.
      queryClient.invalidateQueries({ queryKey: teamKeys.byChampionship(championshipId) });
      queryClient.invalidateQueries({ queryKey: ['heats'] });
    },
  });
}

export function useDeleteTeam(championshipId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => api.delete(`/api/teams/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.byChampionship(championshipId) });
    },
  });
}
