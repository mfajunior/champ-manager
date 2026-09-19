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
  total_score: number;
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
