import { useState } from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ResultHistoryModal } from './ResultHistoryModal';
import { useCreateResult, useDeleteResult, useUpdateResult } from '../../hooks/useResults';
import { getErrorMessage } from '../../lib/errors';
import { SCORING_TYPE_UNIT, formatResultDisplay, formatSecondsAsClock, parseClockToSeconds } from '../../lib/scoring';
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
  const isTimeScoring = scoringType === 'time';
  const [isEditing, setIsEditing] = useState(false);
  // Pra prova 'time', o campo já abre em mm:ss (é o que a pessoa vai
  // corrigir), não em segundos crus — raw_value sempre chega em segundos.
  const [rawValue, setRawValue] = useState(() =>
    isTimeScoring && lane.raw_value ? formatSecondsAsClock(lane.raw_value) : lane.raw_value ?? ''
  );
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

    let numericValue: number | undefined;
    if (!didNotFinish) {
      if (isTimeScoring) {
        const parsed = parseClockToSeconds(rawValue);
        if (parsed === null) {
          setError('Formato inválido — use mm:ss (ex.: 3:45)');
          return;
        }
        numericValue = parsed;
      } else {
        numericValue = Number(rawValue);
      }
    }

    try {
      if (hasResult && lane.result_id) {
        await updateResult.mutateAsync({
          id: lane.result_id,
          raw_value: numericValue,
          did_not_finish: didNotFinish,
        });
      } else {
        await createResult.mutateAsync({
          heat_team_id: lane.heat_team_id,
          raw_value: numericValue,
          did_not_finish: didNotFinish,
        });
      }
      setIsEditing(false);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const display = hasResult && lane.raw_value ? formatResultDisplay(lane.raw_value, scoringType) : null;

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2 text-sm font-semibold">{lane.lane_number}</td>
      <td className="truncate px-3 py-2 text-sm">{lane.team_name}</td>
      {/* Categoria da equipe, não da bateria: uma bateria pode misturar
          categorias (ver migration 005), então isso só faz sentido por raia.
          Coluna própria (não mais colada no nome da equipe) — nome variando
          de tamanho empurrava a categoria pra uma posição diferente em cada
          linha; como coluna, ela sempre começa no mesmo x. */}
      <td className="truncate px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {lane.category_name}
      </td>

      {!isEditing && (
        <>
          <td className="px-3 py-2 text-sm">
            {hasResult ? (
              lane.did_not_finish ? (
                <span className="font-semibold text-destructive">WO</span>
              ) : (
                <span>
                  {display?.value} {display?.unit && <span className="text-muted-foreground">{display.unit}</span>}
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
              WO
            </label>
            {!didNotFinish && (
              <input
                type={isTimeScoring ? 'text' : 'number'}
                step={isTimeScoring ? undefined : '0.01'}
                placeholder={isTimeScoring ? 'mm:ss' : SCORING_TYPE_UNIT[scoringType]}
                value={rawValue}
                // maxLength não tem efeito em input type="number" (o
                // navegador ignora), então o corte de 5 caracteres é feito
                // no onChange — funciona igual pros dois tipos de input.
                maxLength={5}
                onChange={(e) => setRawValue(e.target.value.slice(0, 5))}
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
          scoringType={scoringType}
          onClose={() => setIsViewingHistory(false)}
        />
      )}
    </tr>
  );
}
