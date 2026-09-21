import { Spinner } from '../ui/Spinner';
import { ErrorBanner } from '../ui/ErrorBanner';
import { useTeamResults } from '../../hooks/useTeams';
import { formatResultDisplay } from '../../lib/scoring';
import { getErrorMessage } from '../../lib/errors';

// Conteúdo da seção que abre embaixo da equipe no StandingsTable ao clicar
// (accordion, não modal — decisão de UX pedida depois da primeira versão).
// Lista todas as provas do campeonato, na ordem — não só as que a equipe já
// correu — porque o pedido original foi exatamente esse: mostrar a prova que
// ainda falta com "—", não só omitir ela.
export function TeamWorkoutResults({ teamId }: { teamId: number }) {
  const { data, isLoading, isError, error } = useTeamResults(teamId);

  if (isLoading) {
    return <Spinner label="Carregando provas..." />;
  }

  if (isError) {
    return <ErrorBanner message={getErrorMessage(error)} />;
  }

  if (!data || data.workouts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Nenhuma prova cadastrada neste campeonato.</p>
    );
  }

  return (
    <table className="w-full">
      <thead>
        <tr className="text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <th className="py-2 pr-3">Prova</th>
          <th className="py-2 pr-3 text-right">Resultado</th>
          <th className="py-2 text-right">Colocação</th>
        </tr>
      </thead>
      <tbody>
        {data.workouts.map((workout) => {
          // Sem heat_team_id nenhum pra essa prova (nem bateria foi gerada
          // ainda pra categoria da equipe) — os 3 campos vêm null juntos.
          // Isso é diferente de WO (que É um resultado, só que sem valor).
          const notYetPlayed = workout.raw_value === null && !workout.did_not_finish;

          return (
            <tr key={workout.workout_id} className="border-b border-border/60 last:border-0">
              <td className="py-2 pr-3 text-sm">
                Prova {workout.workout_number} — {workout.workout_name}
              </td>
              <td className="py-2 pr-3 text-right text-sm">
                {notYetPlayed ? (
                  <span className="text-muted-foreground">—</span>
                ) : workout.did_not_finish || !workout.raw_value ? (
                  <span className="font-semibold text-destructive">WO</span>
                ) : (
                  (() => {
                    const display = formatResultDisplay(workout.raw_value, workout.scoring_type);
                    return (
                      <span>
                        {display.value}{' '}
                        {display.unit && <span className="text-muted-foreground">{display.unit}</span>}
                      </span>
                    );
                  })()
                )}
              </td>
              <td className="py-2 text-right text-sm font-bold">
                {notYetPlayed ? (
                  <span className="text-muted-foreground">—</span>
                ) : workout.place ? (
                  `${workout.place}º`
                ) : (
                  '—'
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
