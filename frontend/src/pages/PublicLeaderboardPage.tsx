import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StandingsTable } from '../components/leaderboard/StandingsTable';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { Spinner } from '../components/ui/Spinner';
import { useChampionship } from '../hooks/useChampionships';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { getErrorMessage } from '../lib/errors';

export function PublicLeaderboardPage() {
  const { championshipId: championshipIdParam } = useParams<{ championshipId: string }>();
  const championshipId = Number(championshipIdParam);
  const [categoryFilter, setCategoryFilter] = useState<number | 'all'>('all');

  const championship = useChampionship(championshipId);
  const leaderboard = useLeaderboard(championshipId);

  const filteredStandings = useMemo(() => {
    if (!leaderboard.data) return [];
    if (categoryFilter === 'all') return leaderboard.data;
    return leaderboard.data.filter((s) => s.category_id === categoryFilter);
  }, [leaderboard.data, categoryFilter]);

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-5">
        <div>
          <Link to="/" className="font-display text-2xl uppercase tracking-wide">
            Champy
          </Link>
          {championship.data && (
            <p className="text-sm text-muted-foreground">{championship.data.name}</p>
          )}
        </div>
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-brand">
          <span className="h-2 w-2 animate-pulse rounded-full bg-brand" aria-hidden="true" />
          Ao vivo
        </span>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        {championship.data?.categories && (
          <div className="mb-8 flex flex-wrap gap-2">
            <button
              onClick={() => setCategoryFilter('all')}
              className={`border px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${
                categoryFilter === 'all' ? 'border-brand text-brand' : 'border-border text-muted-foreground'
              }`}
            >
              Todas
            </button>
            {championship.data.categories.map((category) => (
              <button
                key={category.id}
                onClick={() => setCategoryFilter(category.id)}
                className={`border px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${
                  categoryFilter === category.id
                    ? 'border-brand text-brand'
                    : 'border-border text-muted-foreground'
                }`}
              >
                {category.name}
              </button>
            ))}
          </div>
        )}

        {leaderboard.isLoading && <Spinner label="Carregando placar..." />}
        {leaderboard.isError && <ErrorBanner message={getErrorMessage(leaderboard.error)} />}
        {leaderboard.data && <StandingsTable standings={filteredStandings} />}
      </main>
    </div>
  );
}
