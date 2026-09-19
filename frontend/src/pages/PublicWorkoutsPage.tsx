import { Link, useParams } from 'react-router-dom';
import { PublicLayout } from '../components/layout/PublicLayout';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { Spinner } from '../components/ui/Spinner';
import { useChampionship } from '../hooks/useChampionships';
import { useWorkouts } from '../hooks/useWorkouts';
import { SCORING_TYPE_LABELS } from '../lib/scoring';
import { getErrorMessage } from '../lib/errors';

// Lista de provas de um campeonato, só leitura — versão pública de
// WorkoutsList.tsx (que fica em components/workouts e é usada pela tela de
// gestão em /admin). Não reaproveitei aquele componente porque ele monta o
// link para a rota de edição (/admin/campeonatos/.../provas/...); aqui o link
// precisa ir para a versão pública do detalhe da prova.
export function PublicWorkoutsPage() {
  const { id } = useParams<{ id: string }>();
  const championshipId = Number(id);

  const championship = useChampionship(championshipId);
  const workouts = useWorkouts(championshipId);

  return (
    <PublicLayout championshipId={championshipId} subtitle={championship.data?.name}>
      <Link
        to={`/evento/${championshipId}`}
        className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
      >
        ← {championship.data?.name ?? 'Campeonato'}
      </Link>

      <h1 className="mt-2 text-3xl">Provas</h1>

      <div className="mt-6">
        {workouts.isLoading && <Spinner label="Carregando provas..." />}
        {workouts.isError && <ErrorBanner message={getErrorMessage(workouts.error)} />}

        {workouts.data && workouts.data.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma prova cadastrada ainda.</p>
        )}

        {workouts.data && workouts.data.length > 0 && (
          <ul className="divide-y divide-border border border-border">
            {workouts.data.map((workout) => (
              <li key={workout.id}>
                <Link
                  to={`/evento/${championshipId}/provas/${workout.id}`}
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
        )}
      </div>
    </PublicLayout>
  );
}
