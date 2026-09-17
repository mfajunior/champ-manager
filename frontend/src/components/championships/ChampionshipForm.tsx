import { useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Input } from '../ui/Input';
import { useCreateChampionship } from '../../hooks/useChampionships';
import { getErrorMessage } from '../../lib/errors';

export function ChampionshipForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [location, setLocation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createChampionship = useCreateChampionship();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      // O backend cria as 5 categorias padrão sozinho (Iniciante/Scale/RX ×
      // masculino/feminino/misto) — não existe campo de categoria aqui.
      await createChampionship.mutateAsync({ name, date, location });
      setName('');
      setDate('');
      setLocation('');
      onCreated();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && <ErrorBanner message={error} />}
      <Input label="Nome do campeonato" name="name" required value={name} onChange={(e) => setName(e.target.value)} />
      <Input
        label="Data"
        type="date"
        name="date"
        required
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <Input
        label="Local"
        name="location"
        required
        value={location}
        onChange={(e) => setLocation(e.target.value)}
      />
      <Button type="submit" disabled={createChampionship.isPending} className="mt-2">
        {createChampionship.isPending ? 'Criando...' : 'Criar campeonato'}
      </Button>
    </form>
  );
}
