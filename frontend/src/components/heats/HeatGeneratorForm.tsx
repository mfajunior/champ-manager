import { useState } from 'react';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ErrorBanner } from '../ui/ErrorBanner';
import { useGenerateHeats } from '../../hooks/useHeats';
import { ApiError } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import type { Championship } from '../../types';

/**
 * Raias, transição e hora de início não são mais escolhidas aqui — são
 * parâmetros globais do campeonato (championship.lanes_per_heat/
 * transition_seconds/start_time, configurados uma vez em "Configurar
 * agenda" — ver ChampionshipSettingsForm). A prova inteira é gerada de uma
 * vez, cruzando todas as categorias com equipe cadastrada: o que sobra de
 * uma categoria é completado pela próxima da sequência fixa (nível:
 * iniciante → scale → rx; dentro do nível: feminino → masculino → misto),
 * em vez de deixar raia vazia até a próxima prova.
 */
export function HeatGeneratorForm({
  workoutId,
  championship,
  onGenerated,
}: {
  workoutId: number;
  championship: Championship;
  onGenerated: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [orderByStandings, setOrderByStandings] = useState(false);
  const generateHeats = useGenerateHeats(workoutId);

  if (championship.lanes_per_heat === null) {
    return (
      <p className="text-sm text-destructive">
        Defina o número de raias do campeonato antes de gerar baterias — isso
        fica em "Configurar agenda", na página do campeonato.
      </p>
    );
  }

  const runGenerate = async (force: boolean) => {
    setError(null);
    try {
      await generateHeats.mutateAsync({ force, order_by_standings: orderByStandings });
      setConfirmMessage(null);
      onGenerated();
    } catch (err) {
      // RESULTS_EXIST é o único código de erro que vira uma pergunta em vez
      // de uma mensagem de erro — o backend (heatController.generate) devolve
      // 409 exatamente para dar essa chance de confirmar antes de apagar
      // resultados já lançados.
      if (err instanceof ApiError && err.code === 'RESULTS_EXIST') {
        setConfirmMessage(err.message);
      } else {
        setError(getErrorMessage(err));
      }
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorBanner message={error} />}
      <p className="text-sm text-muted-foreground">
        Gera baterias para todas as categorias com equipe cadastrada, usando
        as {championship.lanes_per_heat} raias configuradas para este
        campeonato. Categorias diferentes podem dividir a mesma bateria, na
        sequência iniciante → scale → rx. Gerar de novo substitui as baterias
        atuais desta prova.
      </p>
      <label className="flex items-start gap-2 border border-border px-3 py-2.5 text-sm">
        <input
          type="checkbox"
          checked={orderByStandings}
          onChange={(e) => setOrderByStandings(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Organizar pela colocação no leaderboard
          <span className="mt-1 block text-xs text-muted-foreground">
            Dentro de cada categoria, quem está melhor colocado compete nas últimas
            baterias — a decisão fica pro fim, na frente de todo mundo. Sem marcar, a
            ordem é a de cadastro das equipes. Na primeira prova não muda nada: ainda
            não existe colocação.
          </span>
        </span>
      </label>

      <Button onClick={() => runGenerate(false)} disabled={generateHeats.isPending} className="mt-2">
        {generateHeats.isPending ? 'Gerando...' : 'Gerar baterias'}
      </Button>

      {confirmMessage && (
        <ConfirmDialog
          title="Já existem resultados lançados"
          message={confirmMessage}
          confirmLabel="Gerar mesmo assim"
          isLoading={generateHeats.isPending}
          onCancel={() => setConfirmMessage(null)}
          onConfirm={() => runGenerate(true)}
        />
      )}
    </div>
  );
}
