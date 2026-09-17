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
  result_id: number | null;
  place: number | null;
  raw_value: string | null;
  did_not_finish: boolean | null;
}

export interface Heat {
  id: number;
  workout_id: number;
  heat_number: number;
  category_id: number;
  category_name: string;
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
  id: number;
  team_id: number;
  team_name: string;
  category_id: number;
  category_name: string;
  gender?: Category['gender'];
  level?: Category['level'];
  total_score: number;
  place: number;
  workouts_completed: number;
  updated_at: string;
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
