import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PublicHeatsList } from '../components/heats/PublicHeatsList';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { Spinner } from '../components/ui/Spinner';
import { PublicLayout } from '../components/layout/PublicLayout';
import { useChampionship } from '../hooks/useChampionships';
import { useHeats } from '../hooks/useHeats';
import { useWorkouts } from '../hooks/useWorkouts';
import { getErrorMessage } from '../lib/errors';

// Baterias são filhas de uma prova (GET /api/workouts/:workout_id/heats), não
// existe "todas as baterias do campeonato" no backend — por isso esta tela
// primeiro deixa escolher a prova (abas), igual ao filtro de categoria do
// placar público, e só então busca as baterias daquela prova.
export function PublicHeatsPage() {
  const { id } = useParams<{ id: string }>();
  const championshipId = Number(id);

  const championship = useChampionship(championshipId);
  const workouts = useWorkouts(championshipId);
  const [workoutId, setWorkoutId] = useState<number | null>(null);

  useEffect(() => {
    if (workoutId === null && workouts.data && workouts.data.length > 0) {
      setWorkoutId(workouts.data[0].id);
    }
  }, [workouts.data, workoutId]);

  const heats = useHeats(workoutId ?? NaN);
  const selectedWorkout = workouts.data?.find((w) => w.id === workoutId);

  return (
    <PublicLayout championshipId={championshipId} subtitle={championship.data?.name}>
      <Link
        to={`/evento/${championshipId}`}
        className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
      >
        ← {championship.data?.name ?? 'Campeonato'}
      </Link>

      <h1 className="mt-2 text-3xl">Baterias</h1>

      {workouts.isLoading && <Spinner label="Carregando provas..." />}
      {workouts.isError && <ErrorBanner message={getErrorMessage(workouts.error)} />}

      {workouts.data && workouts.data.length === 0 && (
        <p className="mt-6 text-sm text-muted-foreground">Nenhuma prova cadastrada ainda.</p>
      )}

      {workouts.data && workouts.data.length > 0 && (
        <>
          <div className="mt-6 flex flex-wrap gap-2">
            {workouts.data.map((workout) => (
              <button
                key={workout.id}
                onClick={() => setWorkoutId(workout.id)}
                className={`border px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${
                  workoutId === workout.id
                    ? 'border-brand text-brand'
                    : 'border-border text-muted-foreground'
                }`}
              >
                Prova {workout.workout_number}
              </button>
            ))}
          </div>

          <div className="mt-6">
            {heats.isLoading && <Spinner label="Carregando baterias..." />}
            {heats.isError && <ErrorBanner message={getErrorMessage(heats.error)} />}
            {heats.data && selectedWorkout && (
              <PublicHeatsList heats={heats.data} />
            )}
          </div>
        </>
      )}
    </PublicLayout>
  );
}
