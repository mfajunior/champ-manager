import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { HeatGeneratorForm } from '../components/heats/HeatGeneratorForm';
import { HeatsList } from '../components/heats/HeatsList';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { Modal } from '../components/ui/Modal';
import { Select } from '../components/ui/Select';
import { Spinner } from '../components/ui/Spinner';
import { WarningBanner } from '../components/ui/WarningBanner';
import { WorkoutVariantEditor } from '../components/workouts/WorkoutVariantEditor';
import { useChampionship } from '../hooks/useChampionships';
import { useHeats } from '../hooks/useHeats';
import { useUpdateWorkout, useWorkout } from '../hooks/useWorkouts';
import { getErrorMessage } from '../lib/errors';
import { SCORING_TYPE_LABELS } from '../lib/scoring';
import type { ScoringType } from '../types';

export function WorkoutDetailPage() {
  const { id: championshipIdParam, workoutId: workoutIdParam } = useParams<{
    id: string;
    workoutId: string;
  }>();
  const championshipId = Number(championshipIdParam);
  const workoutId = Number(workoutIdParam);

  const [isGeneratingHeats, setIsGeneratingHeats] = useState(false);
  const [scoringWarning, setScoringWarning] = useState<string | null>(null);

  const championship = useChampionship(championshipId);
  const workout = useWorkout(workoutId);
  const heats = useHeats(workoutId);
  const updateWorkout = useUpdateWorkout(championshipId, workoutId);

  if (workout.isLoading || championship.isLoading) {
    return <Spinner label="Carregando prova..." />;
  }

  if (workout.isError || !workout.data || !championship.data) {
    return <ErrorBanner message={getErrorMessage(workout.error) || 'Prova não encontrada.'} />;
  }

  const categories = championship.data.categories ?? [];
  const variantsByCategory = new Map(workout.data.variants?.map((v) => [v.category_id, v]) ?? []);

  const handleScoringTypeChange = async (scoringType: ScoringType) => {
    setScoringWarning(null);
    const result = await updateWorkout.mutateAsync({ scoring_type: scoringType });
    if (result.warning) {
      setScoringWarning(result.warning);
    }
  };

  return (
    <div>
      <Link
        to={`/campeonatos/${championshipId}`}
        className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
      >
        ← {championship.data.name}
      </Link>

      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-3xl">
          Prova {workout.data.workout_number} — {workout.data.name}
        </h1>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Tipo de pontuação:
        </span>
        <Select
          label=""
          name="scoring_type"
          value={workout.data.scoring_type}
          onChange={(e) => handleScoringTypeChange(e.target.value as ScoringType)}
          className="w-auto"
        >
          {Object.entries(SCORING_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      {scoringWarning && (
        <div className="mt-3">
          <WarningBanner message={scoringWarning} />
        </div>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-xl">Variantes por categoria</h2>
        <div className="flex flex-col gap-3">
          {categories.map((category) => (
            <WorkoutVariantEditor
              key={category.id}
              workoutId={workoutId}
              category={category}
              variant={variantsByCategory.get(category.id)}
            />
          ))}
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl">Baterias e resultados</h2>
          <button
            onClick={() => setIsGeneratingHeats(true)}
            className="text-xs font-bold uppercase tracking-wider text-brand hover:opacity-70"
          >
            Configurar baterias
          </button>
        </div>

        {heats.isLoading && <Spinner label="Carregando baterias..." />}
        {heats.isError && <ErrorBanner message={getErrorMessage(heats.error)} />}
        {heats.data && (
          <HeatsList heats={heats.data} workoutId={workoutId} scoringType={workout.data.scoring_type} />
        )}
      </section>

      {isGeneratingHeats && (
        <Modal title="Gerar baterias" onClose={() => setIsGeneratingHeats(false)}>
          <HeatGeneratorForm
            workoutId={workoutId}
            categories={categories}
            onGenerated={() => setIsGeneratingHeats(false)}
          />
        </Modal>
      )}
    </div>
  );
}
