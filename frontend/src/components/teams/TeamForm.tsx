import { useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useCreateTeam } from '../../hooks/useTeams';
import { getErrorMessage } from '../../lib/errors';
import type { Category } from '../../types';

interface TeamFormProps {
  championshipId: number;
  categories: Category[];
  onCreated: () => void;
}

export function TeamForm({ championshipId, categories, onCreated }: TeamFormProps) {
  const [name, setName] = useState('');
  const [atleta1, setAtleta1] = useState('');
  const [atleta2, setAtleta2] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? 0);
  const [error, setError] = useState<string | null>(null);
  const createTeam = useCreateTeam(championshipId);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await createTeam.mutateAsync({
        championship_id: championshipId,
        category_id: categoryId,
        name,
        athlete_1: atleta1,
        athlete_2: atleta2,
      });
      setName('');
      setAtleta1('');
      setAtleta2('');
      onCreated();
    } catch (err) {
      setError(getErrorMessage(err));
    }
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
      <Input label="Nome da equipe" name="name" required value={name} onChange={(e) => setName(e.target.value)} />
      {/* Atletas opcionais: a inscrição às vezes chega só com o nome da dupla,
          e travar o cadastro por isso atrasaria o organizador à toa. Dá para
          preencher depois, em Editar. */}
      <Input label="Atleta 1 (opcional)" name="athlete_1" value={atleta1} onChange={(e) => setAtleta1(e.target.value)} />
      <Input label="Atleta 2 (opcional)" name="athlete_2" value={atleta2} onChange={(e) => setAtleta2(e.target.value)} />
      <Button type="submit" disabled={createTeam.isPending} className="mt-2">
        {createTeam.isPending ? 'Registrando...' : 'Registrar equipe'}
      </Button>
    </form>
  );
}
