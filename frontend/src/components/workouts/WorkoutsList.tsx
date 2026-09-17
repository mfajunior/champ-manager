import { Link } from 'react-router-dom';
import { SCORING_TYPE_LABELS } from '../../lib/scoring';
import type { Workout } from '../../types';

export function WorkoutsList({ championshipId, workouts }: { championshipId: number; workouts: Workout[] }) {
  if (workouts.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma prova cadastrada ainda.</p>;
  }

  return (
    <ul className="divide-y divide-border border border-border">
      {workouts.map((workout) => (
        <li key={workout.id}>
          <Link
            to={`/campeonatos/${championshipId}/provas/${workout.id}`}
            className="flex items-center justify-between px-4 py-3 hover:bg-muted"
          >
            <div>
              <span className="font-display text-lg uppercase">
                Prova {workout.workout_number} — {workout.name}
              </span>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {SCORING_TYPE_LABELS[workout.scoring_type]}
              </p>
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {workout.variants_count ?? 0} variante(s)
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
