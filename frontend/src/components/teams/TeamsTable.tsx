import { useState } from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useDeleteTeam } from '../../hooks/useTeams';
import type { Team } from '../../types';

export function TeamsTable({ championshipId, teams }: { championshipId: number; teams: Team[] }) {
  const [teamToDelete, setTeamToDelete] = useState<Team | null>(null);
  const deleteTeam = useDeleteTeam(championshipId);

  if (teams.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma equipe registrada ainda.</p>;
  }

  // Agrupado por categoria — é assim que o organizador pensa (times daquela
  // categoria são quem vai competir junto na mesma bateria).
  const byCategory = teams.reduce<Record<string, Team[]>>((acc, team) => {
    (acc[team.category_name] ||= []).push(team);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      {Object.entries(byCategory).map(([categoryName, categoryTeams]) => (
        <div key={categoryName}>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            {categoryName}
          </h3>
          <ul className="divide-y divide-border border border-border">
            {categoryTeams.map((team) => (
              <li key={team.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">{team.name}</span>
                <button
                  onClick={() => setTeamToDelete(team)}
                  className="text-xs font-bold uppercase tracking-wider text-destructive hover:opacity-70"
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {teamToDelete && (
        <ConfirmDialog
          title="Remover equipe"
          message={`Remover "${teamToDelete.name}"? Isso também apaga as baterias e resultados já lançados para ela.`}
          confirmLabel="Remover"
          isLoading={deleteTeam.isPending}
          onCancel={() => setTeamToDelete(null)}
          onConfirm={async () => {
            await deleteTeam.mutateAsync(teamToDelete.id);
            setTeamToDelete(null);
          }}
        />
      )}
    </div>
  );
}
