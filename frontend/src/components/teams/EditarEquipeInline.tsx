import { useState } from 'react';
import { useUpdateTeam } from '../../hooks/useTeams';
import { getErrorMessage } from '../../lib/errors';
import type { Team } from '../../types';

/**
 * Edição no lugar, dentro da própria linha da lista de equipes.
 *
 * Nome e atletas no mesmo formulário porque é a mesma correção na cabeça de
 * quem usa: "o nome está errado" e "o atleta está errado" acontecem no mesmo
 * momento — na conferência da inscrição — e separar em duas telas obrigaria a
 * percorrer a lista duas vezes.
 *
 * Campo de atleta vazio LIMPA o valor; o backend transforma '' em NULL. É
 * proposital: sem isso não haveria como desfazer um nome digitado por engano.
 */
export function EditarEquipeInline({
  championshipId,
  team,
  onFechar,
}: {
  championshipId: number;
  team: Team;
  onFechar: () => void;
}) {
  const [nome, setNome] = useState(team.name);
  const [atleta1, setAtleta1] = useState(team.athlete_1 ?? '');
  const [atleta2, setAtleta2] = useState(team.athlete_2 ?? '');
  const [erro, setErro] = useState<string | null>(null);

  const updateTeam = useUpdateTeam(championshipId);

  const salvar = async () => {
    setErro(null);
    if (nome.trim().length === 0) {
      setErro('O nome da equipe não pode ficar vazio.');
      return;
    }
    try {
      await updateTeam.mutateAsync({
        id: team.id,
        name: nome.trim(),
        athlete_1: atleta1.trim(),
        athlete_2: atleta2.trim(),
      });
      onFechar();
    } catch (e) {
      setErro(getErrorMessage(e));
    }
  };

  const campo = 'w-full border border-border bg-background px-2 py-1.5 text-sm';
  const rotulo = 'mb-1 block text-xs font-bold uppercase tracking-wider text-muted-foreground';

  return (
    <div className="flex flex-col gap-3 bg-muted/40 px-4 py-3">
      <div>
        <label className={rotulo} htmlFor={`equipe-${team.id}`}>
          Equipe
        </label>
        <input
          id={`equipe-${team.id}`}
          className={campo}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="min-w-0 flex-1">
          <label className={rotulo} htmlFor={`atleta1-${team.id}`}>
            Atleta 1
          </label>
          <input
            id={`atleta1-${team.id}`}
            className={campo}
            value={atleta1}
            placeholder="nome do atleta"
            onChange={(e) => setAtleta1(e.target.value)}
          />
        </div>
        <div className="min-w-0 flex-1">
          <label className={rotulo} htmlFor={`atleta2-${team.id}`}>
            Atleta 2
          </label>
          <input
            id={`atleta2-${team.id}`}
            className={campo}
            value={atleta2}
            placeholder="nome do atleta"
            onChange={(e) => setAtleta2(e.target.value)}
          />
        </div>
      </div>

      {erro && <p className="text-xs font-semibold text-destructive">{erro}</p>}

      <div className="flex gap-4">
        <button
          type="button"
          onClick={salvar}
          disabled={updateTeam.isPending}
          className="text-xs font-bold uppercase tracking-wider text-brand hover:opacity-70 disabled:opacity-40"
        >
          {updateTeam.isPending ? 'Salvando…' : 'Salvar'}
        </button>
        <button
          type="button"
          onClick={onFechar}
          className="text-xs font-bold uppercase tracking-wider text-muted-foreground hover:opacity-70"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
