import { useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useGenerateHeats } from '../../hooks/useHeats';
import { ApiError } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import type { Category } from '../../types';

export function HeatGeneratorForm({
  workoutId,
  categories,
  onGenerated,
}: {
  workoutId: number;
  categories: Category[];
  onGenerated: () => void;
}) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? 0);
  const [lanesPerHeat, setLanesPerHeat] = useState(4);
  const [error, setError] = useState<string | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const generateHeats = useGenerateHeats(workoutId);

  const runGenerate = async (force: boolean) => {
    setError(null);
    try {
      await generateHeats.mutateAsync({ category_id: categoryId, lanes_per_heat: lanesPerHeat, force });
      setConfirmMessage(null);
      onGenerated();
    } catch (err) {
      // RESULTS_EXIST é o único código de erro que vira uma pergunta em vez
      // de uma mensagem de erro — o backend (heatController.generate) devolve
      // 409 exatamente para dar essa chance de confirmar antes de apagar
      // resultados já lançados.
      if (err instanceof ApiError && err.code === 'RESULTS_EXIST') {
        setConfirmMessage(err.message);
      } else {
        setError(getErrorMessage(err));
      }
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await runGenerate(false);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && <ErrorBanner message={error} />}
      <Select
        label="Categoria"
        name="category_id"
        value={categoryId}
        onChange={(e) => setCategoryId(Number(e.target.value))}
      >
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </Select>
      <Input
        label="Raias disponíveis no box"
        type="number"
        name="lanes_per_heat"
        min={1}
        required
        value={lanesPerHeat}
        onChange={(e) => setLanesPerHeat(Number(e.target.value))}
      />
      <p className="text-xs text-muted-foreground">
        As baterias são distribuídas de forma equilibrada entre as raias — não é
        "encher até o limite". Gerar de novo substitui as baterias atuais dessa categoria.
      </p>
      <Button type="submit" disabled={generateHeats.isPending} className="mt-2">
        {generateHeats.isPending ? 'Gerando...' : 'Gerar baterias'}
      </Button>

      {confirmMessage && (
        <ConfirmDialog
          title="Já existem resultados lançados"
          message={confirmMessage}
          confirmLabel="Gerar mesmo assim"
          isLoading={generateHeats.isPending}
          onCancel={() => setConfirmMessage(null)}
          onConfirm={() => runGenerate(true)}
        />
      )}
    </form>
  );
}
