import { useState } from 'react';
import { HeatGeneratorForm } from './HeatGeneratorForm';
import { HeatsList } from './HeatsList';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { WarningBanner } from '../ui/WarningBanner';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ApiError } from '../../lib/api';
import { useClearHeats, useHeats, useMoveLane, useSwapLanes } from '../../hooks/useHeats';
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
  // Limpar baterias: confirmação em dois passos quando há resultado lançado,
  // porque apagar bateria apaga o resultado dela em cascata.
  const [confirmarLimpeza, setConfirmarLimpeza] = useState<string | null>(null);
  const [erroLimpeza, setErroLimpeza] = useState<string | null>(null);

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
  const limpar = useClearHeats(workoutId ?? NaN);

  const limparBaterias = async (force: boolean) => {
    setErroLimpeza(null);
    try {
      await limpar.mutateAsync({ force });
      setConfirmarLimpeza(null);
    } catch (err) {
      // Mesmo padrão do gerador: RESULTS_EXIST é o único erro que vira
      // pergunta em vez de mensagem. A mensagem do backend já traz quantos
      // resultados estão em risco.
      if (err instanceof ApiError && err.code === 'RESULTS_EXIST') {
        setConfirmarLimpeza(err.message);
      } else {
        setErroLimpeza(getErrorMessage(err));
      }
    }
  };
  // Só para saber se a escalação montada ainda bate com a classificação.
  // Quando a prova não tem corte, o backend devolve todas as equipes e
  // outdated fica falso — o aviso simplesmente não aparece.
  const classificados = useEligibleTeams(workoutId ?? NaN, workoutId !== null);
  const selectedWorkout = workouts.find((w) => w.id === workoutId);
  // Imprimir e limpar só fazem sentido com bateria gerada.
  const temBaterias = (heats.data?.length ?? 0) > 0;

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
            {temBaterias && (
              <>
                <Link
                  to={`/admin/campeonatos/${championship.id}/provas/${selectedWorkout.id}/baterias/impressao`}
                  className="text-xs font-bold uppercase tracking-wider text-muted-foreground hover:opacity-70"
                >
                  Imprimir
                </Link>
                <button
                  onClick={() => limparBaterias(false)}
                  disabled={limpar.isPending}
                  className="text-xs font-bold uppercase tracking-wider text-destructive hover:opacity-70 disabled:opacity-40"
                >
                  {limpar.isPending ? 'Limpando...' : 'Limpar baterias'}
                </button>
              </>
            )}
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

      {erroLimpeza && (
        <div className="mb-4">
          <ErrorBanner message={erroLimpeza} />
        </div>
      )}

      {confirmarLimpeza && (
        <ConfirmDialog
          title="Apagar as baterias desta prova?"
          message={confirmarLimpeza}
          confirmLabel="Apagar mesmo assim"
          isLoading={limpar.isPending}
          onCancel={() => setConfirmarLimpeza(null)}
          onConfirm={() => limparBaterias(true)}
        />
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
