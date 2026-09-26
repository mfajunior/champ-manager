// Espelha exatamente o que os controllers do backend devolvem — ver
// backend/src/controllers/*.js. Nenhum campo aqui é inventado; o que a API
// não manda, a UI não finge que tem.

export interface User {
  id: number;
  email: string;
  name: string;
}

export interface Category {
  id: number;
  name: string;
  gender: 'masculino' | 'feminino' | 'misto';
  level: 'iniciante' | 'scale' | 'rx';
  teams_count?: number;
}

export interface Championship {
  id: number;
  name: string;
  date: string;
  location: string;
  is_active: boolean;
  created_at: string;
  teams_count?: number;
  workouts_count?: number;
  categories?: Category[];
  // Parâmetros globais de agenda (migration 005) — null até serem
  // configurados uma vez em "configurações do campeonato". lanes_per_heat é
  // exigido pra gerar baterias; transition_seconds/start_time são opcionais
  // (sem eles, dá pra gerar baterias mas sem horário calculado).
  lanes_per_heat: number | null;
  transition_seconds: number | null;
  start_time: string | null;
  // Qual regra de pontuação vale (migration 011). 'legacy' é o default e o
  // que toda competição existente continua usando sem nenhum UPDATE.
  scoring_model: ScoringModel;
  // Obrigatório quando scoring_model é 'points_table' — o banco tem CHECK
  // garantindo isso, então não dá para ligar o modelo novo sem escolher.
  points_table_id: number | null;
}

export type ScoringModel = 'legacy' | 'points_table';

// Faixa da tabela de pontos: "da colocação start_place até end_place,
// decrescer decrement pontos". end_place null = faixa aberta ("em diante").
// A última faixa é sempre aberta, o que garante que nenhuma colocação fique
// sem regra — inclusive as equipes que se inscreverem depois.
export interface PointsTableRange {
  id?: number;
  start_place: number;
  end_place: number | null;
  decrement: number;
}

export interface PointsTable {
  id: number;
  championship_id: number;
  name: string;
  // Fixo em 100; não é campo de tela. Existe como coluna para o 100 não virar
  // número mágico dentro da função PL/pgSQL.
  max_points: number;
  ranges: PointsTableRange[];
  created_at: string;
  updated_at: string;
}

export interface PointsTablePreview {
  points_table_id: number;
  name: string;
  max_points: number;
  ranges: PointsTableRange[];
  places: Array<{ place: number; points: number }>;
  /** Primeira colocação que pontua zero; null se a tabela nunca zera. */
  zeroes_at: number | null;
  largest_category: { category_id: number; category_name: string; teams: number } | null;
  /** Texto pronto do aviso quando a zeragem cai dentro da maior categoria. */
  warning: string | null;
}

export interface WorkoutCut {
  id: number;
  workout_id: number;
  /** null = linha padrão, vale para todas as categorias. */
  category_id: number | null;
  category_name?: string | null;
  keep_top_n: number;
}

export interface EligibleTeamsCategory {
  category_id: number;
  category_name: string;
  /** null quando a prova não tem corte configurado. */
  keep_top_n: number | null;
  eligible: Array<{ team_id: number; team_name: string }>;
  /** Quem está escalado nas baterias hoje. */
  scheduled: Array<{ team_id: number; team_name: string }>;
  /** As baterias já geradas não batem mais com a classificação atual. */
  outdated: boolean;
}

export interface Team {
  id: number;
  championship_id: number;
  category_id: number;
  category_name: string;
  gender: Category['gender'];
  level: Category['level'];
  name: string;
  registered_at: string;
}

export type ScoringType = 'time' | 'reps' | 'load';

export interface WorkoutVariant {
  id: number;
  category_id: number;
  category_name: string;
  gender: Category['gender'];
  level: Category['level'];
  description: string;
  time_cap_seconds: number | null;
  updated_at: string;
}

export interface Workout {
  id: number;
  championship_id: number;
  workout_number: number;
  name: string;
  type: string | null;
  scoring_type: ScoringType;
  status: string;
  description?: string | null;
  created_at: string;
  // Intervalo depois desta prova, em segundos (migration 013). null = sem
  // intervalo. Fica na prova porque dentro de uma prova as baterias misturam
  // categorias — abrir intervalo ali separaria quem compete em sequência.
  break_after_seconds: number | null;
  variants_count?: number;
  variants?: WorkoutVariant[];
}

export interface HeatLane {
  heat_team_id: number;
  heat_id: number;
  lane_number: number;
  team_id: number;
  team_name: string;
  // Categoria da EQUIPE, não da bateria: desde a migration 005 uma bateria
  // pode misturar categorias, então cada raia carrega a sua própria.
  category_id: number;
  category_name: string;
  result_id: number | null;
  place: number | null;
  raw_value: string | null;
  did_not_finish: boolean | null;
}

export interface Heat {
  id: number;
  workout_id: number;
  heat_number: number;
  // Duração calculada (maior time cap entre as categorias presentes nela) —
  // null se alguma delas não tem time cap definido pra esta prova; nesse
  // caso o horário desta bateria e de todas as seguintes também é null.
  duration_seconds: number | null;
  scheduled_time: string | null;
  status: 'scheduled' | 'in_progress' | 'completed';
  teams: HeatLane[];
}

export interface Result {
  id: number;
  heat_team_id: number;
  place: number | null;
  raw_value: string | null;
  did_not_finish: boolean;
  recorded_at: string;
}

// Resultado de uma equipe numa prova específica, vindo de GET
// /api/teams/:id/results. Os 3 campos vêm juntos ou nulos juntos: sem
// resultado lançado para essa prova, os 3 são null (nem sequer existe bateria
// gerada pra essa categoria ainda) — não é o mesmo caso de HeatLane, que
// sempre representa uma raia existente.
export interface TeamWorkoutResult {
  workout_id: number;
  workout_number: number;
  workout_name: string;
  scoring_type: ScoringType;
  raw_value: string | null;
  did_not_finish: boolean | null;
  place: number | null;
}

export interface AuditLogEntry {
  id: number;
  result_id: number | null;
  action: 'created' | 'updated' | 'deleted';
  raw_value: string | null;
  did_not_finish: boolean | null;
  place: number | null;
  changed_at: string;
  changed_by_id: number | null;
  changed_by_name: string | null;
  changed_by_email: string | null;
}

export interface Standing {
  team_id: number;
  team_name: string;
  category_id: number;
  category_name: string;
  gender?: Category['gender'];
  level?: Category['level'];
  /** Qual regra de pontuação o campeonato usa (migration 011). */
  scoring_model: 'legacy' | 'points_table';
  /** Soma das colocações — menor é melhor. É o que o modelo `legacy` ranqueia. */
  total_score: number;
  // Pontos do modelo `points_table` — maior é melhor. Null no `legacy`, onde
  // pontos não existem: 0 sugeriria "fez zero pontos" onde a resposta certa é
  // "essa conta não se aplica". O contrato foi estendido, não redefinido —
  // total_score continua significando o que sempre significou.
  total_points: number | null;
  /** Fora do corte de alguma prova: mantém os pontos, sai das baterias. */
  is_cut: boolean;
  // null até a equipe ter pelo menos 1 resultado lançado em algum lugar do
  // campeonato (é quando o trigger do banco calcula o place de verdade,
  // inclusive das que ainda não pontuaram — ver leaderboardController.js).
  place: number | null;
  workouts_completed: number;
  updated_at: string | null;
}

// Formato de erro devolvido pelo error handler central (backend/src/app.js)
// e pelo middleware validate() — sempre { error: { code, message } }.
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export interface ApiMeta {
  message?: string;
  total?: number;
  warning?: string;
  [key: string]: unknown;
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: ApiMeta;
}
