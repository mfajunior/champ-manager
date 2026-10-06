import { useState } from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ResultHistoryModal } from './ResultHistoryModal';
import { useCreateResult, useDeleteResult, useUpdateResult } from '../../hooks/useResults';
import { getErrorMessage } from '../../lib/errors';
import {
  SCORING_TYPE_UNIT,
  formatResultDisplay,
  formatSecondsAsClock,
  parseClockToSeconds,
} from '../../lib/scoring';
import { NomeComAtletas } from '../teams/NomeComAtletas';
import type { HeatLane, ScoringType } from '../../types';

/**
 * Uma raia da bateria, com o lançamento do resultado.
 *
 * PROVA COM DUAS PONTUAÇÕES (migration 014)
 *
 * Quando a prova tem scoring_type_2, a raia carrega dois resultados
 * independentes — cada um com a sua colocação. A equipe pode ser 1ª numa e
 * última na outra, e as duas contam no placar.
 *
 * Os dois são gravados como LINHAS separadas em results (score_index 1 e 2),
 * então salvar dispara duas chamadas. Poderia ser uma só com as duas
 * pontuações no corpo, mas aí o endpoint precisaria de um formato novo e a
 * prova de pontuação única passaria a usar um caminho diferente do que usa
 * hoje. Duas chamadas mantêm o endpoint como está, e cada pontuação pode ser
 * corrigida sozinha depois.
 *
 * DESEMPATE
 *
 * Um campo só, mesmo com duas pontuações: é o tempo de um round, um fato da
 * execução da equipe naquela prova, não propriedade de uma das pontuações. Vai
 * gravado nas duas linhas.
 */
export function LaneRow({
  lane,
  workoutId,
  scoringType,
  scoringType2 = null,
  hasTiebreak = false,
}: {
  lane: HeatLane;
  workoutId: number;
  scoringType: ScoringType;
  scoringType2?: ScoringType | null;
  hasTiebreak?: boolean;
}) {
  const temDuasPontuacoes = scoringType2 !== null;
  const hasResult = lane.result_id !== null;
  const hasResult2 = lane.result_id_2 !== null;

  const paraCampo = (valor: string | null, tipo: ScoringType) =>
    tipo === 'time' && valor ? formatSecondsAsClock(valor) : valor ?? '';

  const [atletasAbertos, setAtletasAbertos] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  // Pra prova 'time', o campo já abre em mm:ss (é o que a pessoa vai
  // corrigir), não em segundos crus — raw_value sempre chega em segundos.
  const [rawValue, setRawValue] = useState(() => paraCampo(lane.raw_value, scoringType));
  const [rawValue2, setRawValue2] = useState(() =>
    paraCampo(lane.raw_value_2, scoringType2 ?? 'time')
  );
  const [didNotFinish, setDidNotFinish] = useState(lane.did_not_finish ?? false);
  const [didNotFinish2, setDidNotFinish2] = useState(lane.did_not_finish_2 ?? false);
  const [tiebreak, setTiebreak] = useState(() =>
    lane.tiebreak_seconds ? formatSecondsAsClock(lane.tiebreak_seconds) : ''
  );
  const [error, setError] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isViewingHistory, setIsViewingHistory] = useState(false);

  const createResult = useCreateResult(workoutId);
  const updateResult = useUpdateResult(workoutId);
  const deleteResult = useDeleteResult(workoutId);

  const isSaving = createResult.isPending || updateResult.isPending;

  /** Converte o que está no campo para o número que o backend espera. */
  const paraNumero = (valor: string, tipo: ScoringType, rotulo: string) => {
    if (tipo === 'time') {
      const parsed = parseClockToSeconds(valor);
      if (parsed === null) {
        throw new Error(`${rotulo}: formato inválido — use mm:ss (ex.: 3:45)`);
      }
      return parsed;
    }
    return Number(valor);
  };

  const handleSave = async () => {
    setError(null);

    try {
      let tiebreakSegundos: number | null = null;
      if (hasTiebreak && tiebreak.trim() !== '') {
        tiebreakSegundos = paraNumero(tiebreak, 'time', 'Desempate');
      }

      const salvarPontuacao = async (
        indice: 1 | 2,
        resultId: number | null,
        valor: string,
        wo: boolean,
        tipo: ScoringType,
        rotulo: string
      ) => {
        const numero = wo ? undefined : paraNumero(valor, tipo, rotulo);

        if (resultId) {
          await updateResult.mutateAsync({
            id: resultId,
            raw_value: numero,
            did_not_finish: wo,
            // Só manda o desempate quando a prova o usa: sem isso, o backend
            // entenderia "mandou null" e limparia um valor já lançado.
            ...(hasTiebreak ? { tiebreak_seconds: tiebreakSegundos } : {}),
          });
        } else {
          await createResult.mutateAsync({
            heat_team_id: lane.heat_team_id,
            raw_value: numero,
            did_not_finish: wo,
            score_index: indice,
            ...(hasTiebreak ? { tiebreak_seconds: tiebreakSegundos } : {}),
          });
        }
      };

      await salvarPontuacao(1, lane.result_id, rawValue, didNotFinish, scoringType, 'Pontuação 1');

      if (temDuasPontuacoes && scoringType2) {
        await salvarPontuacao(
          2,
          lane.result_id_2,
          rawValue2,
          didNotFinish2,
          scoringType2,
          'Pontuação 2'
        );
      }

      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error && !getErrorMessage(err) ? err.message : getErrorMessage(err));
    }
  };

  const display = hasResult && lane.raw_value ? formatResultDisplay(lane.raw_value, scoringType) : null;
  const display2 =
    hasResult2 && lane.raw_value_2 && scoringType2
      ? formatResultDisplay(lane.raw_value_2, scoringType2)
      : null;

  const celulaResultado = (
    lancado: boolean,
    wo: boolean | null,
    valor: { value: string; unit: string | null } | null
  ) => {
    if (!lancado) return <span className="text-muted-foreground">— não lançado</span>;
    if (wo) return <span className="font-semibold text-destructive">WO</span>;
    return (
      <span>
        {valor?.value} {valor?.unit && <span className="text-muted-foreground">{valor.unit}</span>}
      </span>
    );
  };

  const campoDePontuacao = (
    rotulo: string,
    tipo: ScoringType,
    valor: string,
    setValor: (v: string) => void,
    wo: boolean,
    setWo: (v: boolean) => void
  ) => (
    <div className="flex flex-wrap items-center gap-2">
      {temDuasPontuacoes && (
        <span className="w-24 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {rotulo}
        </span>
      )}
      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={wo} onChange={(e) => setWo(e.target.checked)} />
        WO
      </label>
      {!wo && (
        <input
          type={tipo === 'time' ? 'text' : 'number'}
          step={tipo === 'time' ? undefined : '0.01'}
          placeholder={tipo === 'time' ? 'mm:ss' : SCORING_TYPE_UNIT[tipo]}
          value={valor}
          // maxLength não tem efeito em input type="number" (o navegador
          // ignora), então o corte de 5 caracteres é feito no onChange.
          maxLength={5}
          onChange={(e) => setValor(e.target.value.slice(0, 5))}
          className="w-32 border border-border px-2 py-1 text-sm"
        />
      )}
    </div>
  );

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2 text-sm font-semibold">{lane.lane_number}</td>
      <td className="px-3 py-2 text-sm">
        <NomeComAtletas
          nome={lane.team_name}
          atleta1={lane.athlete_1}
          atleta2={lane.athlete_2}
          aberto={atletasAbertos}
          onAlternar={() => setAtletasAbertos((v) => !v)}
        />
      </td>
      {/* Categoria da equipe, não da bateria: uma bateria pode misturar
          categorias (ver migration 005), então isso só faz sentido por raia. */}
      <td className="truncate px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {lane.category_name}
      </td>

      {!isEditing && (
        <>
          <td className="px-3 py-2 text-sm">
            <div>{celulaResultado(hasResult, lane.did_not_finish, display)}</div>
            {temDuasPontuacoes && (
              <div className="mt-1 border-t border-border/50 pt-1">
                {celulaResultado(hasResult2, lane.did_not_finish_2, display2)}
              </div>
            )}
          </td>
          <td className="px-3 py-2 text-sm font-bold">
            <div>{lane.place ? `${lane.place}º` : '—'}</div>
            {temDuasPontuacoes && (
              <div className="mt-1 border-t border-border/50 pt-1">
                {lane.place_2 ? `${lane.place_2}º` : '—'}
              </div>
            )}
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
          <div className="flex flex-col gap-2">
            {campoDePontuacao(
              'Pontuação 1',
              scoringType,
              rawValue,
              setRawValue,
              didNotFinish,
              setDidNotFinish
            )}

            {temDuasPontuacoes && scoringType2 &&
              campoDePontuacao(
                'Pontuação 2',
                scoringType2,
                rawValue2,
                setRawValue2,
                didNotFinish2,
                setDidNotFinish2
              )}

            {hasTiebreak && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Desempate
                </span>
                <input
                  type="text"
                  placeholder="mm:ss"
                  value={tiebreak}
                  maxLength={6}
                  onChange={(e) => setTiebreak(e.target.value.slice(0, 6))}
                  className="w-32 border border-border px-2 py-1 text-sm"
                />
                <span className="text-xs text-muted-foreground">
                  Só desempata; não aparece no placar.
                </span>
              </div>
            )}

            <div className="flex items-center gap-3">
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
            // Prova de duas pontuações tem duas linhas de resultado; remover
            // uma e deixar a outra produziria uma equipe com metade do
            // resultado lançado.
            if (lane.result_id) await deleteResult.mutateAsync(lane.result_id);
            if (lane.result_id_2) await deleteResult.mutateAsync(lane.result_id_2);
            setIsConfirmingDelete(false);
          }}
        />
      )}

      {isViewingHistory && (
        <ResultHistoryModal
          heatTeamId={lane.heat_team_id}
          teamName={lane.team_name}
          scoringType={scoringType}
          scoringType2={scoringType2}
          onClose={() => setIsViewingHistory(false)}
        />
      )}
    </tr>
  );
}
