import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Championship } from '../types';

const championshipKeys = {
  all: ['championships'] as const,
  detail: (id: number) => ['championships', id] as const,
};

// includeArchived traz também os campeonatos arquivados (is_active = false)
// — usado só na seção "Arquivados" da tela de campeonatos. A chave de
// cache inclui a flag pra não misturar a lista ativa com a lista completa.
export function useChampionships(includeArchived = false) {
  return useQuery({
    queryKey: [...championshipKeys.all, { includeArchived }],
    queryFn: async () =>
      (
        await api.get<Championship[]>(
          `/api/championships${includeArchived ? '?include_archived=true' : ''}`
        )
      ).data,
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

interface UpdateChampionshipInput {
  name?: string;
  date?: string;
  location?: string;
  is_active?: boolean;
  lanes_per_heat?: number;
  transition_seconds?: number;
  start_time?: string;
}

export function useUpdateChampionship(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateChampionshipInput) =>
      (await api.put<Championship>(`/api/championships/${id}`, input)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: championshipKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: championshipKeys.all });
    },
  });
}
