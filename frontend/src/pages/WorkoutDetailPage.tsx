import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { Select } from '../components/ui/Select';
import { Spinner } from '../components/ui/Spinner';
import { WarningBanner } from '../components/ui/WarningBanner';
import { WorkoutBreakForm } from '../components/workouts/WorkoutBreakForm';
import { WorkoutScoringForm } from '../components/workouts/WorkoutScoringForm';
import { WorkoutCutForm } from '../components/workouts/WorkoutCutForm';
import { WorkoutVariantEditor } from '../components/workouts/WorkoutVariantEditor';
import { useChampionship } from '../hooks/useChampionships';
import { useUpdateWorkout, useWorkout } from '../hooks/useWorkouts';
import { getErrorMessage } from '../lib/errors';
import { SCORING_TYPE_LABELS } from '../lib/scoring';
import type { ScoringType } from '../types';

// Detalhe de uma prova, no admin: só registro (tipo de pontuação) e
// descrição por categoria. Gerar baterias e lançar resultado viraram a aba
// "Baterias" em ChampionshipDetailPage (ver AdminHeatsPanel) — essa página
// ficou exclusiva do que é "a prova em si", não de como ela é disputada.
export function WorkoutDetailPage() {
  const { id: championshipIdParam, workoutId: workoutIdParam } = useParams<{
    id: string;
    workoutId: string;
  }>();
  const championshipId = Number(championshipIdParam);
  const workoutId = Number(workoutIdParam);

  const [scoringWarning, setScoringWarning] = useState<string | null>(null);
  const [editandoNome, setEditandoNome] = useState(false);
  const [nomeRascunho, setNomeRascunho] = useState('');
  const [erroNome, setErroNome] = useState<string | null>(null);

  const championship = useChampionship(championshipId);
  const workout = useWorkout(workoutId);
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
        to={`/admin/campeonatos/${championshipId}`}
        className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
      >
        ← {championship.data.name}
      </Link>

      {/* O nome da prova é editável no lugar onde ele é lido, e não num
          formulário separado: o organizador costuma decidir o nome depois de
          escrever as variantes ("Prova 2" vira "Escolha a ordem"), e um campo
          escondido numa tela de edição seria procurado e não achado.
          O número continua fixo — ele define a ORDEM do cronograma, e trocar
          isso por engano reagenda o dia inteiro. */}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {editandoNome ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const novo = nomeRascunho.trim();
              if (!novo || novo === workout.data?.name) {
                setEditandoNome(false);
                return;
              }
              setErroNome(null);
              try {
                await updateWorkout.mutateAsync({ name: novo });
                setEditandoNome(false);
              } catch (err) {
                setErroNome(getErrorMessage(err));
              }
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="text-3xl">Prova {workout.data.workout_number} —</span>
            <input
              autoFocus
              value={nomeRascunho}
              onChange={(e) => setNomeRascunho(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setEditandoNome(false)}
              className="border border-border px-2 py-1 text-2xl"
            />
            <button
              type="submit"
              disabled={updateWorkout.isPending}
              className="bg-brand px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-brand-foreground"
            >
              {updateWorkout.isPending ? 'Salvando...' : 'Salvar'}
            </button>
            <button
              type="button"
              onClick={() => setEditandoNome(false)}
              className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
            >
              Cancelar
            </button>
          </form>
        ) : (
          <>
            <h1 className="text-3xl">
              Prova {workout.data.workout_number} — {workout.data.name}
            </h1>
            <button
              onClick={() => {
                setNomeRascunho(workout.data?.name ?? '');
                setErroNome(null);
                setEditandoNome(true);
              }}
              className="text-xs font-bold uppercase tracking-wider text-secondary hover:opacity-70"
            >
              Renomear
            </button>
          </>
        )}
      </div>
      {erroNome && <p className="mt-1 text-xs font-semibold text-destructive">{erroNome}</p>}

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
        <h2 className="mb-3 text-xl">Pontuação da prova</h2>
        <div className="mb-8">
          <WorkoutScoringForm championshipId={championshipId} workout={workout.data} />
        </div>

        <h2 className="mb-3 text-xl">Intervalo depois desta prova</h2>
        <div className="mb-8">
          <WorkoutBreakForm championshipId={championshipId} workout={workout.data} />
        </div>

        <h2 className="mb-3 text-xl">Corte da prova</h2>
        <div className="mb-8">
          <WorkoutCutForm workoutId={workoutId} />
        </div>

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
    </div>
  );
}
