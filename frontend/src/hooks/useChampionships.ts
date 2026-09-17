import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Championship } from '../types';

export const championshipKeys = {
  all: ['championships'] as const,
  detail: (id: number) => ['championships', id] as const,
};

export function useChampionships() {
  return useQuery({
    queryKey: championshipKeys.all,
    queryFn: async () => (await api.get<Championship[]>('/api/championships')).data,
  });
}

export function useChampionship(id: number) {
  return useQuery({
    queryKey: championshipKeys.detail(id),
    queryFn: async () => (await api.get<Championship>(`/api/championships/${id}`)).data,
    enabled: Number.isFinite(id),
  });
}

interface CreateChampionshipInput {
  name: string;
  date: string;
  location: string;
}

export function useCreateChampionship() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateChampionshipInput) =>
      (await api.post<Championship>('/api/championships', input)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: championshipKeys.all });
    },
  });
}

export function useDeleteChampionship() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => api.delete(`/api/championships/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: championshipKeys.all });
    },
  });
}
