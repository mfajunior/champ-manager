import { useState } from 'react';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Select } from '../ui/Select';
import { WarningBanner } from '../ui/WarningBanner';
import { useUpdateWorkout } from '../../hooks/useWorkouts';
import { getErrorMessage } from '../../lib/errors';
import { SCORING_TYPE_LABELS } from '../../lib/scoring';
import type { ScoringType, Workout } from '../../types';

/**
 * Como esta prova é pontuada: uma ou duas pontuações, e se usa desempate.
 *
 * DUAS PONTUAÇÕES CONTAM COMO DUAS PROVAS
 *
 * Cada uma tem a própria colocação e as duas entram no placar, então a prova
 * vale o dobro das outras no campeonato — decisão explícita, e o aviso na tela
 * existe para ninguém descobrir isso pelo placar.
 *
 * DESEMPATE NÃO APARECE NO PLACAR
 *
 * É o tempo de um round, usado só para ordenar quem empatou na pontuação da
 * prova. Não vale ponto e não é exibido no leaderboard — se fosse, viraria uma
 * terceira pontuação disfarçada.
 */
export function WorkoutScoringForm({
  championshipId,
  workout,
}: {
  championshipId: number;
  workout: Workout;
}) {
  const atualizar = useUpdateWorkout(championshipId, workout.id);
  const [temSegunda, setTemSegunda] = useState(workout.scoring_type_2 !== null);
  const [tipo2, setTipo2] = useState<ScoringType>(workout.scoring_type_2 ?? 'reps');
  const [desempate, setDesempate] = useState(workout.has_tiebreak);
  const [error, setError] = useState<string | null>(null);

  const salvar = async () => {
    setError(null);
    try {
      await atualizar.mutateAsync({
        scoring_type_2: temSegunda ? tipo2 : null,
        has_tiebreak: desempate,
      });
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const mudou =
    temSegunda !== (workout.scoring_type_2 !== null) ||
    (temSegunda && tipo2 !== workout.scoring_type_2) ||
    desempate !== workout.has_tiebreak;

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorBanner message={error} />}

      <div className="flex flex-col gap-3">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={temSegunda}
            onChange={(e) => setTemSegunda(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-semibold">Esta prova tem duas pontuações</span>
            <span className="block text-xs text-muted-foreground">
              Cada uma com colocação própria e independente — a equipe pode ser 1ª
              numa e última na outra.
            </span>
          </span>
        </label>

        {temSegunda && (
          <div className="ml-7 w-56">
            <Select
              label="Tipo da segunda pontuação"
              name="scoring_type_2"
              value={tipo2}
              onChange={(e) => setTipo2(e.target.value as ScoringType)}
            >
              {Object.entries(SCORING_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              A primeira continua sendo {SCORING_TYPE_LABELS[workout.scoring_type]}.
            </p>
          </div>
        )}

        {temSegunda && (
          <WarningBanner message="Com duas pontuações, esta prova vale o dobro das outras no placar geral — as duas colocações somam." />
        )}

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={desempate}
            onChange={(e) => setDesempate(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-semibold">Usar desempate (tie breaker)</span>
            <span className="block text-xs text-muted-foreground">
              Abre um campo de tempo no lançamento — por exemplo o tempo de um round.
              Serve só para ordenar quem empatou nesta prova e não aparece no placar.
            </span>
          </span>
        </label>
      </div>

      <div>
        <Button onClick={salvar} disabled={atualizar.isPending || !mudou}>
          {atualizar.isPending ? 'Salvando...' : 'Salvar pontuação da prova'}
        </Button>
      </div>
    </div>
  );
}
