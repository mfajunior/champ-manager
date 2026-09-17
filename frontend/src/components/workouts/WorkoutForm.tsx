import { useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useCreateWorkout } from '../../hooks/useWorkouts';
import { getErrorMessage } from '../../lib/errors';
import { SCORING_TYPE_LABELS } from '../../lib/scoring';
import type { ScoringType } from '../../types';

export function WorkoutForm({
  championshipId,
  nextWorkoutNumber,
  onCreated,
}: {
  championshipId: number;
  nextWorkoutNumber: number;
  onCreated: () => void;
}) {
  const [workoutNumber, setWorkoutNumber] = useState(nextWorkoutNumber);
  const [name, setName] = useState('');
  const [scoringType, setScoringType] = useState<ScoringType>('time');
  const [error, setError] = useState<string | null>(null);
  const createWorkout = useCreateWorkout(championshipId);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await createWorkout.mutateAsync({
        championship_id: championshipId,
        workout_number: workoutNumber,
        name,
        scoring_type: scoringType,
      });
      setName('');
      onCreated();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && <ErrorBanner message={error} />}
      <Input
        label="Número da prova"
        type="number"
        name="workout_number"
        min={1}
        required
        value={workoutNumber}
        onChange={(e) => setWorkoutNumber(Number(e.target.value))}
      />
      <Input label="Nome da prova" name="name" required value={name} onChange={(e) => setName(e.target.value)} />
      <Select
        label="Tipo de pontuação"
        name="scoring_type"
        value={scoringType}
        onChange={(e) => setScoringType(e.target.value as ScoringType)}
      >
        {Object.entries(SCORING_TYPE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <Button type="submit" disabled={createWorkout.isPending} className="mt-2">
        {createWorkout.isPending ? 'Criando...' : 'Criar prova'}
      </Button>
    </form>
  );
}
