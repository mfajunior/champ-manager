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

export function ResultHistoryModal({
  heatTeamId,
  teamName,
  scoringType,
  onClose,
}: {
  heatTeamId: number;
  teamName: string;
  scoringType: ScoringType;
  onClose: () => void;
}) {
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
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(entry.changed_at).toLocaleString('pt-BR')}
                </span>
              </div>
              <p className="mt-1 text-foreground">
                {entry.did_not_finish
                  ? 'DNF (não terminou)'
                  : entry.raw_value !== null
                    ? (() => {
                        const display = formatResultDisplay(entry.raw_value, scoringType);
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
