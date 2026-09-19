import { useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Input } from '../ui/Input';
import { useUpdateChampionship } from '../../hooks/useChampionships';
import { getErrorMessage } from '../../lib/errors';
import type { Championship } from '../../types';

/**
 * Raias, transição entre baterias e hora de início são parâmetros GLOBAIS do
 * campeonato (migration 005): configurados uma vez aqui, valem pra todas as
 * categorias — não é mais escolhido a cada geração de bateria. Juntos, eles
 * são o que permite calcular a hora exata de cada bateria (heatController.
 * generate encadeia a partir do time cap de cada prova/categoria).
 *
 * start_time vem do backend como "HH:mm:ss" (formato TIME do Postgres) mas um
 * <input type="time"> só aceita/devolve "HH:mm" — por isso o corte na
 * exibição e o Joi do backend aceitando os dois formatos na entrada.
 */
export function ChampionshipSettingsForm({
  championship,
  onSaved,
}: {
  championship: Championship;
  onSaved: () => void;
}) {
  const [lanesPerHeat, setLanesPerHeat] = useState(championship.lanes_per_heat ?? 4);
  const [transitionSeconds, setTransitionSeconds] = useState(championship.transition_seconds ?? 60);
  const [startTime, setStartTime] = useState(championship.start_time?.slice(0, 5) ?? '08:00');
  const [error, setError] = useState<string | null>(null);

  const updateChampionship = useUpdateChampionship(championship.id);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await updateChampionship.mutateAsync({
        lanes_per_heat: lanesPerHeat,
        transition_seconds: transitionSeconds,
        start_time: startTime,
      });
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && <ErrorBanner message={error} />}
      <Input
        label="Raias disponíveis no box"
        type="number"
        name="lanes_per_heat"
        min={1}
        required
        value={lanesPerHeat}
        onChange={(e) => setLanesPerHeat(Number(e.target.value))}
      />
      <p className="-mt-2 text-xs text-muted-foreground">
        Vale pra todas as categorias. Categorias diferentes podem dividir a
        mesma bateria, na sequência iniciante → scale → rx (feminino →
        masculino → misto dentro de cada nível), pra não deixar raia vazia.
      </p>
      <Input
        label="Tempo de transição entre baterias (segundos)"
        type="number"
        name="transition_seconds"
        min={0}
        required
        value={transitionSeconds}
        onChange={(e) => setTransitionSeconds(Number(e.target.value))}
      />
      <Input
        label="Hora de início do campeonato"
        type="time"
        name="start_time"
        required
        value={startTime}
        onChange={(e) => setStartTime(e.target.value)}
      />
      <p className="-mt-2 text-xs text-muted-foreground">
        Junto com o time cap de cada prova/categoria, é o que permite calcular
        a hora exata de cada bateria. Sem isso, as baterias ainda são geradas
        — só ficam sem horário.
      </p>
      <Button type="submit" disabled={updateChampionship.isPending} className="mt-2">
        {updateChampionship.isPending ? 'Salvando...' : 'Salvar configurações'}
      </Button>
    </form>
  );
}
