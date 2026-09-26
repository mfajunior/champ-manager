import { useState } from 'react';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Input } from '../ui/Input';
import { WarningBanner } from '../ui/WarningBanner';
import {
  useEligibleTeams,
  useRemoveWorkoutCut,
  useSetWorkoutCut,
  useWorkoutCut,
} from '../../hooks/useWorkoutCut';
import { getErrorMessage } from '../../lib/errors';

/**
 * Corte da prova: "esta prova é disputada só pelo top N de cada categoria".
 *
 * A LISTA DE CLASSIFICADOS VEM DO SERVIDOR, SEMPRE
 *
 * Seria tentador calcular aqui — pegar o leaderboard e cortar os N primeiros.
 * Seria errado: a classificação usada pelo corte considera só as provas
 * ANTERIORES a esta, e o desempate é por melhor colocação individual, coisas
 * que a tela não tem como reproduzir sem virar uma segunda implementação da
 * regra. Aí a lista mostrada aqui divergiria da que monta as baterias, e
 * alguém seria chamado para a raia sem estar no painel.
 *
 * O aviso de escalação desatualizada aparece quando as baterias já geradas
 * não batem mais com a classificação — o que acontece, por exemplo, quando um
 * resultado é corrigido depois de montar o dia. O sistema não regera sozinho:
 * trocar quem entra na bateria sem o organizador mandar é pior que a
 * divergência.
 */
export function WorkoutCutForm({ workoutId }: { workoutId: number }) {
  const cortes = useWorkoutCut(workoutId);
  const classificados = useEligibleTeams(workoutId);
  const salvar = useSetWorkoutCut(workoutId);
  const remover = useRemoveWorkoutCut(workoutId);

  const cortePadrao = cortes.data?.find((c) => c.category_id === null) ?? null;
  const [topN, setTopN] = useState<number>(cortePadrao?.keep_top_n ?? 4);
  const [error, setError] = useState<string | null>(null);

  const aplicar = async () => {
    setError(null);
    try {
      await salvar.mutateAsync({ keep_top_n: topN });
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const limpar = async () => {
    setError(null);
    try {
      await remover.mutateAsync(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorBanner message={error} />}

      <p className="text-sm text-muted-foreground">
        Por padrão todas as equipes disputam. Com corte, apenas as melhores
        colocadas <strong>de cada categoria</strong> entram nas baterias — as
        demais mantêm no placar os pontos que já conquistaram.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Input
            label="Disputam as primeiras"
            type="number"
            name="keep_top_n"
            min={1}
            value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
          />
        </div>
        <Button onClick={aplicar} disabled={salvar.isPending || topN < 1}>
          {salvar.isPending ? 'Salvando...' : cortePadrao ? 'Atualizar corte' : 'Aplicar corte'}
        </Button>
        {cortePadrao && (
          <Button variant="ghost" onClick={limpar} disabled={remover.isPending}>
            Remover corte
          </Button>
        )}
      </div>

      {cortePadrao && (
        <p className="text-xs text-muted-foreground">
          Corte ativo: top {cortePadrao.keep_top_n} de cada categoria.
        </p>
      )}

      {classificados.data?.anyOutdated && (
        <WarningBanner message="As baterias já geradas não batem mais com a classificação atual. Regere as baterias desta prova para alinhar." />
      )}

      {classificados.data && (
        <div className="flex flex-col gap-3">
          {classificados.data.categories.map((categoria) => (
            <div key={categoria.category_id} className="border border-border px-3 py-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-semibold">{categoria.category_name}</span>
                <span className="text-xs text-muted-foreground">
                  {categoria.keep_top_n === null
                    ? `${categoria.eligible.length} equipes, sem corte`
                    : `top ${categoria.keep_top_n} · ${categoria.eligible.length} classificadas`}
                </span>
              </div>
              <p className="text-sm text-foreground">
                {categoria.eligible.length === 0
                  ? 'Nenhuma equipe classificada.'
                  : categoria.eligible.map((e) => e.team_name).join(', ')}
              </p>
              {categoria.outdated && (
                <p className="mt-1 text-xs font-semibold text-secondary">
                  A bateria montada tem {categoria.scheduled.length} equipe
                  {categoria.scheduled.length === 1 ? '' : 's'} e não bate com esta lista.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
