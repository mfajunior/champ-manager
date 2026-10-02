import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { ErrorBanner } from '../ui/ErrorBanner';
import { useResultHistory } from '../../hooks/useResults';
import { getErrorMessage } from '../../lib/errors';
import { formatResultDisplay } from '../../lib/scoring';
import type { ScoringType } from '../../types';

const ACTION_LABELS: Record<string, string> = {
  created: 'Lançado',
  updated: 'Corrigido',
  deleted: 'Removido',
};

/**
 * Histórico de uma RAIA — criação, correções e remoção do resultado.
 *
 * PROVA DE DUAS PONTUAÇÕES (migrations 014 e 015)
 *
 * O histórico é consultado por heat_team_id, e não por result_id, porque a
 * raia sobrevive ao resultado apagado. A consequência é que numa prova de
 * duas pontuações as duas histórias chegam na mesma lista: por isso cada
 * evento traz o próprio score_index, que aqui decide duas coisas — o rótulo
 * que separa uma pontuação da outra e o TIPO usado para formatar o valor.
 * Formatar tudo com o tipo da primeira pontuação mostrava 180 repetições
 * como "03:00".
 */
export function ResultHistoryModal({
  heatTeamId,
  teamName,
  scoringType,
  scoringType2 = null,
  onClose,
}: {
  heatTeamId: number;
  teamName: string;
  scoringType: ScoringType;
  scoringType2?: ScoringType | null;
  onClose: () => void;
}) {
  const temDuasPontuacoes = scoringType2 !== null;
  const history = useResultHistory(heatTeamId);

  return (
    <Modal title={`Histórico — ${teamName}`} onClose={onClose}>
      {history.isLoading && <Spinner label="Carregando histórico..." />}
      {history.isError && <ErrorBanner message={getErrorMessage(history.error)} />}

      {history.data && history.data.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum evento registrado para esta raia ainda.</p>
      )}

      {history.data && history.data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {history.data.map((entry) => (
            <li key={entry.id} className="border border-border px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-bold uppercase tracking-wider text-xs">
                  {ACTION_LABELS[entry.action] ?? entry.action}
                  {temDuasPontuacoes && (
                    <span className="ml-1.5 font-normal normal-case tracking-normal text-muted-foreground">
                      · pontuação {entry.score_index}
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(entry.changed_at).toLocaleString('pt-BR')}
                </span>
              </div>
              <p className="mt-1 text-foreground">
                {entry.did_not_finish
                  ? 'WO (não terminou)'
                  : entry.raw_value !== null
                    ? (() => {
                        const tipo =
                          entry.score_index === 2 && scoringType2 ? scoringType2 : scoringType;
                        const display = formatResultDisplay(entry.raw_value, tipo);
                        return `Valor: ${display.value}${display.unit ? ` ${display.unit}` : ''}${
                          entry.place ? ` · colocação ${entry.place}º` : ''
                        }`;
                      })()
                    : '—'}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                por {entry.changed_by_name ?? 'usuário removido'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
