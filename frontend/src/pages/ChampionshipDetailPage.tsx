import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TeamForm } from '../components/teams/TeamForm';
import { TeamsTable } from '../components/teams/TeamsTable';
import { Button } from '../components/ui/Button';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { Modal } from '../components/ui/Modal';
import { Spinner } from '../components/ui/Spinner';
import { WorkoutForm } from '../components/workouts/WorkoutForm';
import { WorkoutsList } from '../components/workouts/WorkoutsList';
import { useChampionship } from '../hooks/useChampionships';
import { useTeams } from '../hooks/useTeams';
import { useWorkouts } from '../hooks/useWorkouts';
import { formatDate } from '../lib/format';
import { getErrorMessage } from '../lib/errors';

type Tab = 'equipes' | 'provas';

export function ChampionshipDetailPage() {
  const { id } = useParams<{ id: string }>();
  const championshipId = Number(id);
  const [tab, setTab] = useState<Tab>('equipes');
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [isCreatingWorkout, setIsCreatingWorkout] = useState(false);

  const championship = useChampionship(championshipId);
  const teams = useTeams(championshipId);
  const workouts = useWorkouts(championshipId);

  if (championship.isLoading) {
    return <Spinner label="Carregando campeonato..." />;
  }

  if (championship.isError || !championship.data) {
    return <ErrorBanner message={getErrorMessage(championship.error) || 'Campeonato não encontrado.'} />;
  }

  const categories = championship.data.categories ?? [];
  const nextWorkoutNumber = (workouts.data?.length ?? 0) + 1;

  return (
    <div>
      <Link to="/" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        ← Campeonatos
      </Link>

      <h1 className="mt-2 text-3xl">{championship.data.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatDate(championship.data.date)} · {championship.data.location}
      </p>
      <Link
        to={`/placar/${championshipId}`}
        className="mt-3 inline-block text-xs font-bold uppercase tracking-widest text-brand"
      >
        Ver placar público →
      </Link>

      <div className="mt-8 flex gap-6 border-b border-border">
        <button
          onClick={() => setTab('equipes')}
          className={`pb-3 text-sm font-bold uppercase tracking-wider ${
            tab === 'equipes' ? 'border-b-2 border-brand text-brand' : 'text-muted-foreground'
          }`}
        >
          Equipes
        </button>
        <button
          onClick={() => setTab('provas')}
          className={`pb-3 text-sm font-bold uppercase tracking-wider ${
            tab === 'provas' ? 'border-b-2 border-brand text-brand' : 'text-muted-foreground'
          }`}
        >
          Provas
        </button>
      </div>

      <div className="mt-6">
        {tab === 'equipes' && (
          <div>
            <div className="mb-4 flex justify-end">
              <Button onClick={() => setIsCreatingTeam(true)}>Nova equipe</Button>
            </div>
            {teams.isLoading && <Spinner label="Carregando equipes..." />}
            {teams.isError && <ErrorBanner message={getErrorMessage(teams.error)} />}
            {teams.data && <TeamsTable championshipId={championshipId} teams={teams.data} />}
          </div>
        )}

        {tab === 'provas' && (
          <div>
            <div className="mb-4 flex justify-end">
              <Button onClick={() => setIsCreatingWorkout(true)}>Nova prova</Button>
            </div>
            {workouts.isLoading && <Spinner label="Carregando provas..." />}
            {workouts.isError && <ErrorBanner message={getErrorMessage(workouts.error)} />}
            {workouts.data && (
              <WorkoutsList championshipId={championshipId} workouts={workouts.data} />
            )}
          </div>
        )}
      </div>

      {isCreatingTeam && (
        <Modal title="Registrar equipe" onClose={() => setIsCreatingTeam(false)}>
          <TeamForm
            championshipId={championshipId}
            categories={categories}
            onCreated={() => setIsCreatingTeam(false)}
          />
        </Modal>
      )}

      {isCreatingWorkout && (
        <Modal title="Nova prova" onClose={() => setIsCreatingWorkout(false)}>
          <WorkoutForm
            championshipId={championshipId}
            nextWorkoutNumber={nextWorkoutNumber}
            onCreated={() => setIsCreatingWorkout(false)}
          />
        </Modal>
      )}
    </div>
  );
}
