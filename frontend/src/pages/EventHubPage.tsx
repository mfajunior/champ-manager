import { Link, useParams } from 'react-router-dom';
import { PublicLayout } from '../components/layout/PublicLayout';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { Spinner } from '../components/ui/Spinner';
import { useChampionship } from '../hooks/useChampionships';
import { formatDate } from '../lib/format';
import { getErrorMessage } from '../lib/errors';

// Página "hub" de um campeonato específico: as 3 opções de leitura pública
// pedidas (leaderboard, baterias, provas), tudo escopado a esse championshipId
// vindo da URL — mesmo padrão que o link do placar público já usava
// (compartilhável, sem sessão).
export function EventHubPage() {
  const { id } = useParams<{ id: string }>();
  const championshipId = Number(id);

  const championship = useChampionship(championshipId);

  if (championship.isLoading) {
    return (
      <PublicLayout championshipId={championshipId}>
        <Spinner label="Carregando campeonato..." />
      </PublicLayout>
    );
  }

  if (championship.isError || !championship.data) {
    return (
      <PublicLayout championshipId={championshipId}>
        <ErrorBanner message={getErrorMessage(championship.error) || 'Campeonato não encontrado.'} />
      </PublicLayout>
    );
  }

  return (
    <PublicLayout championshipId={championshipId} subtitle={championship.data.name}>
      <Link to="/" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        ← Campeonatos
      </Link>

      <h1 className="mt-2 text-3xl">{championship.data.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatDate(championship.data.date)} · {championship.data.location}
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Link
          to={`/placar/${championshipId}`}
          className="border border-border bg-card p-6 text-center transition-colors hover:border-secondary"
        >
          <span className="font-display text-lg uppercase tracking-wide">Leaderboard</span>
          <p className="mt-1 text-xs text-muted-foreground">Ranking ao vivo por categoria</p>
        </Link>
        <Link
          to={`/evento/${championshipId}/baterias`}
          className="border border-border bg-card p-6 text-center transition-colors hover:border-secondary"
        >
          <span className="font-display text-lg uppercase tracking-wide">Baterias</span>
          <p className="mt-1 text-xs text-muted-foreground">Raias, horários e resultados</p>
        </Link>
        <Link
          to={`/evento/${championshipId}/provas`}
          className="border border-border bg-card p-6 text-center transition-colors hover:border-secondary"
        >
          <span className="font-display text-lg uppercase tracking-wide">Provas (WODs)</span>
          <p className="mt-1 text-xs text-muted-foreground">Descrição de cada prova por categoria</p>
        </Link>
      </div>
    </PublicLayout>
  );
}
