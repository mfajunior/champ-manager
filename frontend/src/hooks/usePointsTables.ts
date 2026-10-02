import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  Championship,
  PointsTable,
  PointsTablePreview,
  PointsTableRange,
  ScoringModel,
} from '../types';

const pointsTableKeys = {
  byChampionship: (championshipId: number) => ['points-tables', championshipId] as const,
  preview: (championshipId: number, pointsTableId: number) =>
    ['points-tables', championshipId, pointsTableId, 'preview'] as const,
};

export function usePointsTables(championshipId: number) {
  return useQuery({
    queryKey: pointsTableKeys.byChampionship(championshipId),
    queryFn: async () =>
      (await api.get<PointsTable[]>(`/api/championships/${championshipId}/points-tables`)).data,
    enabled: Number.isFinite(championshipId),
  });
}

/**
 * A pré-visualização é query separada, e não algo calculado no componente,
 * porque quem sabe quanto vale cada colocação é points_for_place() no banco.
 * Refazer a conta em JS criaria uma segunda régua — o organizador veria na
 * tela uma tabela que pode divergir da que vale no placar.
 */
export function usePointsTablePreview(
  championshipId: number,
  pointsTableId: number | null,
  places?: number
) {
  return useQuery({
    queryKey: [...pointsTableKeys.preview(championshipId, pointsTableId ?? 0), places ?? null],
    queryFn: async () => {
      const query = places ? `?places=${places}` : '';
      const response = await api.get<PointsTablePreview>(
        `/api/championships/${championshipId}/points-tables/${pointsTableId}/preview${query}`
      );
      // O aviso de zeragem vem em meta, não em data: é sobre o campeonato
      // (quantas equipes tem a maior categoria), não sobre a tabela.
      return { ...response.data, warning: (response.meta as { warning?: string | null })?.warning ?? null };
    },
    enabled: Number.isFinite(championshipId) && pointsTableId !== null,
  });
}

export interface PointsTableInput {
  name?: string;
  ranges?: Array<{ start_place: number; end_place: number | null; decrement: number }>;
}

export function useCreatePointsTable(championshipId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PointsTableInput) =>
      (await api.post<PointsTable>(`/api/championships/${championshipId}/points-tables`, input))
        .data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pointsTableKeys.byChampionship(championshipId) });
    },
  });
}

export function useUpdatePointsTable(championshipId: number, pointsTableId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PointsTableInput) =>
      (
        await api.put<PointsTable>(
          `/api/championships/${championshipId}/points-tables/${pointsTableId}`,
          input
        )
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pointsTableKeys.byChampionship(championshipId) });
      queryClient.invalidateQueries({ queryKey: ['points-tables', championshipId, pointsTableId] });
      // Mexer na régua reescreve o placar inteiro (trigger da migration 012).
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    },
  });
}

export function useDeletePointsTable(championshipId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (pointsTableId: number) =>
      (
        await api.delete<null>(
          `/api/championships/${championshipId}/points-tables/${pointsTableId}`
        )
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pointsTableKeys.byChampionship(championshipId) });
    },
  });
}

/**
 * Pré-visualização de RASCUNHO: manda as faixas que estão na tela e recebe a
 * tabela calculada, sem nada ser salvo.
 *
 * É um POST usado como query de propósito. A alternativa seria calcular no
 * navegador, e aí existiriam duas réguas — no dia em que a regra mudasse, a
 * tela prometeria uma pontuação e o placar entregaria outra. A chave inclui
 * as faixas serializadas, então editar um decremento refaz a consulta
 * sozinho, e voltar atrás reaproveita o cache.
 */
export function useDraftPreview(
  championshipId: number,
  ranges: PointsTableRange[] | null,
  places?: number
) {
  return useQuery({
    queryKey: ['points-tables', championshipId, 'draft-preview', JSON.stringify(ranges), places ?? null],
    queryFn: async () => {
      const response = await api.post<PointsTablePreview>(
        `/api/championships/${championshipId}/points-tables/preview`,
        { ranges, ...(places ? { places } : {}) }
      );
      return {
        ...response.data,
        warning: (response.meta as { warning?: string | null })?.warning ?? null,
      };
    },
    enabled: Number.isFinite(championshipId) && Array.isArray(ranges) && ranges.length > 0,
    // Rascunho não muda sozinho no servidor: o que muda é o que está na tela,
    // e isso já troca a chave.
    staleTime: Infinity,
    retry: false,
  });
}

export interface ScoringModelInput {
  scoring_model: ScoringModel;
  points_table_id?: number | null;
  /**
   * Sem isto, o backend devolve 409 com a contagem de resultados afetados
   * quando o campeonato já tem lançamentos. Não é formalidade: trocar o
   * modelo inverte o placar (menor soma de colocações liderava; passa a
   * liderar a maior soma de pontos).
   */
  confirm?: boolean;
}

export function useSetScoringModel(championshipId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ScoringModelInput) =>
      (
        await api.put<Championship>(
          `/api/championships/${championshipId}/scoring-model`,
          input
        )
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['championships'] });
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    },
  });
}
