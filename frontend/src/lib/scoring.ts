import type { ScoringType } from '../types';

// "For Time", "AMRAP" e "PR" são os nomes que o CrossFit usa pra esses três
// jeitos de pontuar uma prova. Só o nome — sem o hint de "menor/maior vence"
// entre parênteses, que só cabia bem no formulário de criação e ficava
// repetitivo nas outras telas que também usam esse rótulo (lista de provas,
// detalhe público). Quem precisa saber o sentido do ranking já vê isso no
// resultado/leaderboard.
export const SCORING_TYPE_LABELS: Record<ScoringType, string> = {
  time: 'For Time',
  reps: 'AMRAP',
  load: 'PR',
};

// Só um rótulo de unidade para o input de resultado — o backend guarda
// raw_value como NUMERIC puro (ver migrations), sem unidade nenhuma. Para
// 'time' o parser fica em parseClockToSeconds (abaixo): é ele quem converte
// "3:05" digitado pro valor em segundos que a API espera.
export const SCORING_TYPE_UNIT: Record<ScoringType, string> = {
  time: 'segundos',
  reps: 'repetições',
  load: 'kg',
};

// results.raw_value chega do backend como string, sempre com 2 casas
// decimais fixas (coluna NUMERIC(10,2) no Postgres — ex.: "212.00", mesmo pra
// um valor sem casa decimal nenhuma, como segundos ou repetições digitados
// como inteiro). Number() descarta os zeros à direita sem arredondar o valor
// de verdade: "212.00" -> "212", mas "62.50" (kg) continua "62.5", não vira
// "62" nem "63".
function formatRawValue(rawValue: string): string {
  return String(Number(rawValue));
}

// raw_value de uma prova 'time' é sempre guardado em segundos totais (é o
// que o input de lançamento manda, e o que os testes e o backend assumem —
// ver ALLOWED_SCORING_TYPES no backend). Exibir em segundos crus ("212")
// obriga quem tá lendo o placar a fazer a conta de cabeça; MM:SS é o formato
// que qualquer cronômetro de WOD usa.
//
// Arredonda pro segundo mais próximo (fração de segundo não faz sentido pra
// cronômetro de WOD) e NÃO limita minutos a 59 — uma prova de 75 minutos vira
// "75:00", não vira "1:15:00": é assim que cronômetro de CrossFit é lido.
export function formatSecondsAsClock(rawValue: string): string {
  const totalSeconds = Math.round(Number(rawValue));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Caminho inverso de formatSecondsAsClock, para o campo de lançamento de
// resultado aceitar "mm:ss" (ex.: "3:45") em vez de segundos crus. Aceita 1
// a 3 dígitos de minuto (uma prova pode passar de 99 minutos) e exige
// segundos entre 00 e 59 — "3:75" não é um tempo válido. Retorna null
// quando o texto não bate com esse formato, para quem chama decidir como
// avisar o erro (não lança exceção).
export function parseClockToSeconds(input: string): number | null {
  const match = input.trim().match(/^(\d{1,3}):([0-5]\d)$/);
  if (!match) {
    return null;
  }
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  return minutes * 60 + seconds;
}

// Formata um raw_value pra exibição, no formato certo pro scoring_type da
// prova: MM:SS pra 'time' (autoexplicativo, sem precisar de unidade), ou
// "valor unidade" pra reps/load. Centraliza a decisão aqui em vez de cada
// tela repetir o if/else de qual formato usar.
export function formatResultDisplay(
  rawValue: string,
  scoringType: ScoringType
): { value: string; unit: string | null } {
  if (scoringType === 'time') {
    return { value: formatSecondsAsClock(rawValue), unit: null };
  }
  return { value: formatRawValue(rawValue), unit: SCORING_TYPE_UNIT[scoringType] };
}
