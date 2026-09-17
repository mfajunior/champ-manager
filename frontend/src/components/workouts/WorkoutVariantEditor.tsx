import { useState } from 'react';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { useUpsertVariant } from '../../hooks/useWorkouts';
import { getErrorMessage } from '../../lib/errors';
import type { Category, WorkoutVariant } from '../../types';

/**
 * Uma linha por categoria do campeonato — não só das que já têm variante
 * cadastrada. Isso porque workoutController.getById só devolve as variantes
 * que já existem (JOIN, não LEFT JOIN nas categorias todas), então uma
 * categoria sem variante não apareceria em lugar nenhum se a UI só listasse
 * `workout.variants`.
 */
export function WorkoutVariantEditor({
  workoutId,
  category,
  variant,
}: {
  workoutId: number;
  category: Category;
  variant: WorkoutVariant | undefined;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [description, setDescription] = useState(variant?.description ?? '');
  const [timeCap, setTimeCap] = useState(variant?.time_cap_seconds ?? '');
  const [error, setError] = useState<string | null>(null);
  const upsertVariant = useUpsertVariant();

  const handleSave = async () => {
    setError(null);
    try {
      await upsertVariant.mutateAsync({
        workoutId,
        categoryId: category.id,
        description,
        time_cap_seconds: timeCap === '' ? null : Number(timeCap),
      });
      setIsEditing(false);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  if (!isEditing) {
    return (
      <div className="flex items-start justify-between border border-border px-4 py-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            {category.name}
          </p>
          <p className="mt-1 text-sm">{variant?.description || 'Sem descrição cadastrada ainda.'}</p>
          {variant?.time_cap_seconds && (
            <p className="mt-1 text-xs text-muted-foreground">
              Time cap: {Math.floor(variant.time_cap_seconds / 60)}min
            </p>
          )}
        </div>
        <button
          onClick={() => setIsEditing(true)}
          className="text-xs font-bold uppercase tracking-wider text-secondary hover:opacity-70"
        >
          {variant ? 'Editar' : 'Adicionar'}
        </button>
      </div>
    );
  }

  return (
    <div className="border border-secondary px-4 py-3">
      <p className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">{category.name}</p>
      {error && (
        <div className="mb-2">
          <ErrorBanner message={error} />
        </div>
      )}
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Cargas e movimentos desta categoria para esta prova"
        rows={3}
        className="mb-2 w-full border border-border px-3 py-2 text-sm outline-none focus:border-secondary"
      />
      <div className="flex items-center gap-3">
        <input
          type="number"
          min={0}
          placeholder="Time cap (segundos)"
          value={timeCap}
          onChange={(e) => setTimeCap(e.target.value === '' ? '' : Number(e.target.value))}
          className="w-48 border border-border px-3 py-2 text-sm"
        />
        <Button onClick={handleSave} disabled={upsertVariant.isPending}>
          {upsertVariant.isPending ? 'Salvando...' : 'Salvar'}
        </Button>
        <button
          onClick={() => setIsEditing(false)}
          className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
