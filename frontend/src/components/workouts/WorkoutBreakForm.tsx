import { useState } from 'react';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Input } from '../ui/Input';
import { useUpdateWorkout } from '../../hooks/useWorkouts';
import { getErrorMessage } from '../../lib/errors';
import type { Workout } from '../../types';

/**
 * Intervalo depois desta prova — almoço, premiação, o que o dia pedir.
 *
 * Fica na prova, e não num horário do dia, porque dentro de uma prova as
 * baterias misturam categorias para não deixar raia vazia: abrir intervalo ali
 * separaria categorias que competem em sequência. Entre uma prova e outra isso
 * não acontece.
 *
 * Não existe "intervalo às 12:00" e não existe regra de atraso. O intervalo É
 * a folga do dia: configure uma hora e, se a manhã atrasar, faça trinta
 * minutos e recupere. Ancorar num horário fixo exigiria decidir o que fazer
 * quando a prova anterior invade o almoço — encurtar? empurrar? — e cada
 * decisão dessas seria uma regra a mais para resolver um problema que a
 * organização já resolve no dia.
 *
 * Em minutos na tela, segundos no banco, como o time cap.
 */
export function WorkoutBreakForm({
  championshipId,
  workout,
}: {
  championshipId: number;
  workout: Workout;
}) {
  const atualizar = useUpdateWorkout(championshipId, workout.id);
  const [minutos, setMinutos] = useState<number>(
    workout.break_after_seconds ? Math.round(workout.break_after_seconds / 60) : 60
  );
  const [error, setError] = useState<string | null>(null);

  const temIntervalo = workout.break_after_seconds !== null;

  const salvar = async (segundos: number | null) => {
    setError(null);
    try {
      await atualizar.mutateAsync({ break_after_seconds: segundos });
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBanner message={error} />}

      <p className="text-sm text-muted-foreground">
        Tempo entre a última bateria desta prova e a primeira da próxima. As
        baterias seguintes são reagendadas automaticamente.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Input
            label="Intervalo (minutos)"
            type="number"
            name="break_minutes"
            min={1}
            value={minutos}
            onChange={(e) => setMinutos(Number(e.target.value))}
          />
        </div>
        <Button
          onClick={() => salvar(minutos * 60)}
          disabled={atualizar.isPending || minutos < 1}
        >
          {atualizar.isPending ? 'Salvando...' : temIntervalo ? 'Atualizar' : 'Adicionar intervalo'}
        </Button>
        {temIntervalo && (
          <Button variant="ghost" onClick={() => salvar(null)} disabled={atualizar.isPending}>
            Remover
          </Button>
        )}
      </div>

      {temIntervalo && (
        <p className="text-xs text-muted-foreground">
          Intervalo ativo: {Math.round((workout.break_after_seconds ?? 0) / 60)} minutos depois
          desta prova.
        </p>
      )}
    </div>
  );
}
