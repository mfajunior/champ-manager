import { useState } from 'react';
import { HeatGeneratorForm } from './HeatGeneratorForm';
import { HeatsList } from './HeatsList';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { WarningBanner } from '../ui/WarningBanner';
import { useHeats, useMoveLane, useSwapLanes } from '../../hooks/useHeats';
import { useEligibleTeams } from '../../hooks/useWorkoutCut';
import { getErrorMessage } from '../../lib/errors';
import type { Championship, HeatLane, Workout } from '../../types';

/**
 * Conteúdo da aba "Baterias" do admin (ChampionshipDetailPage). Antes ficava
 * dentro da página de detalhe de cada prova (WorkoutDetailPage), misturado
 * com a descrição do WOD — foi separado pra deixar "Provas" só sobre
 * registrar prova/descrição, e "Baterias" só sobre gerar baterias e lançar
 * resultado.
 *
 * Baterias são de UMA prova por vez (não existe "todas as baterias do
 * campeonato" no backend — ver GET /api/workouts/:workout_id/heats), por
 * isso o seletor de prova no topo, mesmo padrão já usado na versão pública
 * (PublicHeatsPage).
 */
export function AdminHeatsPanel({
  championship,
  workouts,
}: {
  championship: Championship;
  workouts: Workout[];
}) {
  const [workoutId, setWorkoutId] = useState<number | null>(workouts[0]?.id ?? null);
  const [isGeneratingHeats, setIsGeneratingHeats] = useState(false);

  // Remanejamento manual. É um MODO, e não botões sempre visíveis, porque esta
  // tela é operada durante a prova para lançar resultado — botão de mover
  // equipe ao lado do de lançar é convite a clicar errado com o cronômetro
  // correndo.
  const [remanejando, setRemanejando] = useState(false);
  const [selecionada, setSelecionada] = useState<HeatLane | null>(null);
  const [erroRemanejo, setErroRemanejo] = useState<string | null>(null);

  const trocar = useSwapLanes(workoutId ?? NaN);
  const mover = useMoveLane(workoutId ?? NaN);

  const sairDoRemanejo = () => {
    setRemanejando(false);
    setSelecionada(null);
    setErroRemanejo(null);
  };

  const comErro = async (acao: () => Promise<unknown>) => {
    setErroRemanejo(null);
    try {
      await acao();
      setSelecionada(null);
    } catch (err) {
      setErroRemanejo(getErrorMessage(err));
    }
  };

  const heats = useHeats(workoutId ?? NaN);
  // Só para saber se a escalação montada ainda bate com a classificação.
  // Quando a prova não tem corte, o backend devolve todas as equipes e
  // outdated fica falso — o aviso simplesmente não aparece.
  const classificados = useEligibleTeams(workoutId ?? NaN, workoutId !== null);
  const selectedWorkout = workouts.find((w) => w.id === workoutId);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {workouts.map((workout) => (
            <button
              key={workout.id}
              onClick={() => setWorkoutId(workout.id)}
              className={`border px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${
                workoutId === workout.id
                  ? 'border-brand text-brand'
                  : 'border-border text-muted-foreground'
              }`}
            >
              Prova {workout.workout_number}
            </button>
          ))}
        </div>

        {selectedWorkout && (
          <div className="flex items-center gap-4">
            <button
              onClick={() => (remanejando ? sairDoRemanejo() : setRemanejando(true))}
              className="text-xs font-bold uppercase tracking-wider text-secondary hover:opacity-70"
            >
              {remanejando ? 'Sair do remanejamento' : 'Remanejar raias'}
            </button>
            <button
              onClick={() => setIsGeneratingHeats(true)}
              className="text-xs font-bold uppercase tracking-wider text-brand hover:opacity-70"
            >
              Configurar baterias
            </button>
          </div>
        )}
      </div>

      {/* A escalação pode ter sido montada antes de um resultado ser
          corrigido, e aí o corte mudou embaixo dela. O sistema não regera
          sozinho — chamar outra equipe para a raia sem o organizador mandar
          é pior que a divergência — então avisa e deixa a decisão com ele. */}
      {classificados.data?.anyOutdated && (
        <div className="mb-4">
          <WarningBanner message="A escalação destas baterias não bate mais com a classificação atual. Abra 'Configurar baterias' e gere de novo para alinhar." />
        </div>
      )}

      {heats.isLoading && <Spinner label="Carregando baterias..." />}
      {heats.isError && <ErrorBanner message={getErrorMessage(heats.error)} />}
      {remanejando && (
        <div className="mb-4 border border-secondary bg-muted px-4 py-3">
          <p className="text-sm font-semibold text-foreground">
            {selecionada
              ? `"${selecionada.team_name}" selecionada — agora clique no destino.`
              : 'Clique em "Mover esta" na equipe que você quer tirar do lugar.'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Destino ocupado troca as duas de lugar; raia livre move. O resultado já
            lançado vai junto com a equipe, e os horários são recalculados.
          </p>
          {erroRemanejo && (
            <p className="mt-2 text-xs font-semibold text-destructive">{erroRemanejo}</p>
          )}
        </div>
      )}

      {heats.data && selectedWorkout && (
        <HeatsList
          heats={heats.data}
          workoutId={selectedWorkout.id}
          scoringType={selectedWorkout.scoring_type}
          scoringType2={selectedWorkout.scoring_type_2}
          hasTiebreak={selectedWorkout.has_tiebreak}
          breakAfterSeconds={selectedWorkout.break_after_seconds}
          remanejar={
            remanejando
              ? {
                  lanesPerHeat: championship.lanes_per_heat ?? 0,
                  selecionada,
                  onSelecionar: setSelecionada,
                  onTrocar: (destino) =>
                    selecionada &&
                    comErro(() =>
                      trocar.mutateAsync({
                        heat_team_id_a: selecionada.heat_team_id,
                        heat_team_id_b: destino.heat_team_id,
                      })
                    ),
                  onMover: (heatId, laneNumber) =>
                    selecionada &&
                    comErro(() =>
                      mover.mutateAsync({
                        heatTeamId: selecionada.heat_team_id,
                        heat_id: heatId,
                        lane_number: laneNumber,
                      })
                    ),
                }
              : undefined
          }
        />
      )}

      {isGeneratingHeats && selectedWorkout && (
        <Modal title="Gerar baterias" onClose={() => setIsGeneratingHeats(false)}>
          <HeatGeneratorForm
            workoutId={selectedWorkout.id}
            championship={championship}
            onGenerated={() => setIsGeneratingHeats(false)}
          />
        </Modal>
      )}
    </div>
  );
}
