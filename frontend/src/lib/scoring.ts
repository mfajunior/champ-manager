import type { ScoringType } from '../types';

export const SCORING_TYPE_LABELS: Record<ScoringType, string> = {
  time: 'Tempo (menor vence)',
  reps: 'Repetições (maior vence)',
  load: 'Carga (maior vence)',
};

// Só um rótulo de unidade para o input de resultado — o backend guarda
// raw_value como NUMERIC puro (ver migrations), sem unidade nenhuma. A
// conversão de "3:05" para 185 segundos fica por conta de quem digita; não
// há parser de mm:ss aqui de propósito, para não divergir do que a API espera.
export const SCORING_TYPE_UNIT: Record<ScoringType, string> = {
  time: 'segundos',
  reps: 'repetições',
  load: 'kg',
};
