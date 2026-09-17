import { useState } from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ResultHistoryModal } from './ResultHistoryModal';
import { useCreateResult, useDeleteResult, useUpdateResult } from '../../hooks/useResults';
import { getErrorMessage } from '../../lib/errors';
import { SCORING_TYPE_UNIT } from '../../lib/scoring';
import type { HeatLane, ScoringType } from '../../types';

export function LaneRow({
  lane,
  workoutId,
  scoringType,
}: {
  lane: HeatLane;
  workoutId: number;
  scoringType: ScoringType;
}) {
  const hasResult = lane.result_id !== null;
  const [isEditing, setIsEditing] = useState(false);
  const [rawValue, setRawValue] = useState(lane.raw_value ?? '');
  const [didNotFinish, setDidNotFinish] = useState(lane.did_not_finish ?? false);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isViewingHistory, setIsViewingHistory] = useState(false);

  const createResult = useCreateResult(workoutId);
  const updateResult = useUpdateResult(workoutId);
  const deleteResult = useDeleteResult(workoutId);

  const isSaving = createResult.isPending || updateResult.isPending;

  const handleSave = async () => {
    setError(null);
    try {
      if (hasResult && lane.result_id) {
        await updateResult.mutateAsync({
          id: lane.result_id,
          raw_value: didNotFinish ? undefined : Number(rawValue),
          did_not_finish: didNotFinish,
        });
      } else {
        await createResult.mutateAsync({
          heat_team_id: lane.heat_team_id,
          raw_value: didNotFinish ? undefined : Number(rawValue),
          did_not_finish: didNotFinish,
        });
      }
      setIsEditing(false);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2 text-sm font-semibold">{lane.lane_number}</td>
      <td className="px-3 py-2 text-sm">{lane.team_name}</td>

      {!isEditing && (
        <>
          <td className="px-3 py-2 text-sm">
            {hasResult ? (
              lane.did_not_finish ? (
                <span className="font-semibold text-destructive">DNF</span>
              ) : (
                <span>
                  {lane.raw_value} <span className="text-muted-foreground">{SCORING_TYPE_UNIT[scoringType]}</span>
                </span>
              )
            ) : (
              <span className="text-muted-foreground">— não lançado</span>
            )}
          </td>
          <td className="px-3 py-2 text-sm font-bold">
            {lane.place ? `${lane.place}º` : '—'}
          </td>
          <td className="px-3 py-2 text-right text-xs font-bold uppercase tracking-wider">
            <button onClick={() => setIsEditing(true)} className="mr-3 text-secondary hover:opacity-70">
              {hasResult ? 'Corrigir' : 'Lançar'}
            </button>
            {hasResult && (
              <button
                onClick={() => setIsConfirmingDelete(true)}
                className="mr-3 text-destructive hover:opacity-70"
              >
                Remover
              </button>
            )}
            <button onClick={() => setIsViewingHistory(true)} className="text-muted-foreground hover:text-foreground">
              Histórico
            </button>
          </td>
        </>
      )}

      {isEditing && (
        <td colSpan={3} className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={didNotFinish}
                onChange={(e) => setDidNotFinish(e.target.checked)}
              />
              DNF
            </label>
            {!didNotFinish && (
              <input
                type="number"
                step="0.01"
                placeholder={SCORING_TYPE_UNIT[scoringType]}
                value={rawValue}
                onChange={(e) => setRawValue(e.target.value)}
                className="w-32 border border-border px-2 py-1 text-sm"
              />
            )}
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-brand px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-foreground"
            >
              {isSaving ? 'Salvando...' : 'Salvar'}
            </button>
            <button
              onClick={() => {
                setIsEditing(false);
                setError(null);
              }}
              className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
            >
              Cancelar
            </button>
          </div>
          {error && <p className="mt-1 text-xs font-semibold text-destructive">{error}</p>}
        </td>
      )}

      {isConfirmingDelete && (
        <ConfirmDialog
          title="Remover resultado"
          message={`Remover o resultado de "${lane.team_name}"? O histórico continua guardando o valor removido.`}
          confirmLabel="Remover"
          isLoading={deleteResult.isPending}
          onCancel={() => setIsConfirmingDelete(false)}
          onConfirm={async () => {
            if (lane.result_id) {
              await deleteResult.mutateAsync(lane.result_id);
            }
            setIsConfirmingDelete(false);
          }}
        />
      )}

      {isViewingHistory && (
        <ResultHistoryModal
          heatTeamId={lane.heat_team_id}
          teamName={lane.team_name}
          onClose={() => setIsViewingHistory(false)}
        />
      )}
    </tr>
  );
}
