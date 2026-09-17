import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChampionshipForm } from '../components/championships/ChampionshipForm';
import { Button } from '../components/ui/Button';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { Modal } from '../components/ui/Modal';
import { Spinner } from '../components/ui/Spinner';
import { useChampionships } from '../hooks/useChampionships';
import { formatDate } from '../lib/format';
import { getErrorMessage } from '../lib/errors';

export function ChampionshipsPage() {
  const { data: championships, isLoading, isError, error } = useChampionships();
  const [isCreating, setIsCreating] = useState(false);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl">Campeonatos</h1>
        <Button onClick={() => setIsCreating(true)}>Novo campeonato</Button>
      </div>

      {isLoading && <Spinner label="Carregando campeonatos..." />}
      {isError && <ErrorBanner message={getErrorMessage(error)} />}

      {championships && championships.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhum campeonato cadastrado ainda. Crie o primeiro para começar.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {championships?.map((championship) => (
          <Link
            key={championship.id}
            to={`/campeonatos/${championship.id}`}
            className="border border-border bg-card p-5 transition-colors hover:border-secondary"
          >
            <h2 className="text-xl">{championship.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatDate(championship.date)} · {championship.location}
            </p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {championship.teams_count ?? 0} equipes · {championship.workouts_count ?? 0} provas
            </p>
          </Link>
        ))}
      </div>

      {isCreating && (
        <Modal title="Novo campeonato" onClose={() => setIsCreating(false)}>
          <ChampionshipForm onCreated={() => setIsCreating(false)} />
        </Modal>
      )}
    </div>
  );
}
