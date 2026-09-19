import { Link } from 'react-router-dom';
import { PublicLayout } from '../components/layout/PublicLayout';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { Spinner } from '../components/ui/Spinner';
import { useChampionships } from '../hooks/useChampionships';
import { formatDate } from '../lib/format';
import { getErrorMessage } from '../lib/errors';

// Primeira página que qualquer visitante vê — sem login. Substitui o antigo
// comportamento de cair direto na tela de login: quem chega aqui (atleta,
// torcida, organizador) escolhe o campeonato e a partir dele acessa leaderboard,
// baterias ou provas, tudo em rotas públicas (GET sem authMiddleware no
// backend — ver routes/championships.js, workouts.js, heats.js).
export function HomePage() {
  const { data: championships, isLoading, isError, error } = useChampionships();

  return (
    <PublicLayout>
      <h1 className="text-3xl">Campeonatos</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Escolha um campeonato para ver o placar, as baterias e as provas.
      </p>

      <div className="mt-8">
        {isLoading && <Spinner label="Carregando campeonatos..." />}
        {isError && <ErrorBanner message={getErrorMessage(error)} />}

        {championships && championships.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum campeonato cadastrado ainda.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {championships?.map((championship) => (
            <Link
              key={championship.id}
              to={`/evento/${championship.id}`}
              className="border border-border bg-card p-5 transition-colors hover:border-secondary"
            >
              <h2 className="text-xl">{championship.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDate(championship.date)} · {championship.location}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </PublicLayout>
  );
}
