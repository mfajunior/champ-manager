import { useState } from 'react';
import { HeatGeneratorForm } from './HeatGeneratorForm';
import { HeatsList } from './HeatsList';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { WarningBanner } from '../ui/WarningBanner';
import { useHeats } from '../../hooks/useHeats';
import { useEligibleTeams } from '../../hooks/useWorkoutCut';
import { getErrorMessage } from '../../lib/errors';
import type { Championship, Workout } from '../../types';

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
          <button
            onClick={() => setIsGeneratingHeats(true)}
            className="text-xs font-bold uppercase tracking-wider text-brand hover:opacity-70"
          >
            Configurar baterias
          </button>
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
      {heats.data && selectedWorkout && (
        <HeatsList
          heats={heats.data}
          workoutId={selectedWorkout.id}
          scoringType={selectedWorkout.scoring_type}
          breakAfterSeconds={selectedWorkout.break_after_seconds}
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
