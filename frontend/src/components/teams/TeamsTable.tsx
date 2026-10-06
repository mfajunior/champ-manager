import { useState } from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useDeleteTeam } from '../../hooks/useTeams';
import { EditarEquipeInline } from './EditarEquipeInline';
import type { Team } from '../../types';

export function TeamsTable({ championshipId, teams }: { championshipId: number; teams: Team[] }) {
  const [teamToDelete, setTeamToDelete] = useState<Team | null>(null);
  const [emEdicao, setEmEdicao] = useState<number | null>(null);
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
              <li key={team.id}>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <span className="block truncate text-sm">{team.name}</span>
                    {(team.athlete_1 || team.athlete_2) && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {[team.athlete_1, team.athlete_2].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-4">
                    <button
                      onClick={() => setEmEdicao((atual) => (atual === team.id ? null : team.id))}
                      className="text-xs font-bold uppercase tracking-wider text-brand hover:opacity-70"
                    >
                      {emEdicao === team.id ? 'Fechar' : 'Editar'}
                    </button>
                    <button
                      onClick={() => setTeamToDelete(team)}
                      className="text-xs font-bold uppercase tracking-wider text-destructive hover:opacity-70"
                    >
                      Remover
                    </button>
                  </div>
                </div>
                {emEdicao === team.id && (
                  <EditarEquipeInline
                    championshipId={championshipId}
                    team={team}
                    onFechar={() => setEmEdicao(null)}
                  />
                )}
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
