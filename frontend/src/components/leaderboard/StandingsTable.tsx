import { Fragment, useState } from 'react';
import { TeamWorkoutResults } from './TeamWorkoutResults';
import type { Standing } from '../../types';

export function StandingsTable({ standings }: { standings: Standing[] }) {
  // Um id só (não um Set): abrir uma equipe fecha a anterior, igual a um
  // accordion — evita a tabela crescer sem controle com várias seções
  // abertas ao mesmo tempo numa tela de celular.
  const [expandedTeamId, setExpandedTeamId] = useState<number | null>(null);

  if (standings.length === 0) {
    return (
      <p className="text-center text-lg text-muted-foreground">
        Nenhuma equipe cadastrada ainda neste campeonato.
      </p>
    );
  }

  const byCategory = standings.reduce<Record<string, Standing[]>>((acc, standing) => {
    (acc[standing.category_name] ||= []).push(standing);
    return acc;
  }, {});

  const toggleTeam = (teamId: number) => {
    setExpandedTeamId((current) => (current === teamId ? null : teamId));
  };

  return (
    <div className="flex flex-col gap-10">
      {Object.entries(byCategory).map(([categoryName, categoryStandings]) => (
        <div key={categoryName}>
          <h2 className="mb-4 font-display text-2xl uppercase tracking-wide text-brand">
            {categoryName}
          </h2>
          <table className="w-full table-fixed border-collapse">
            {/* Cada categoria é uma <table> separada (Object.entries(byCategory)
                acima), então sem largura fixa o navegador recalcula a coluna
                "Equipe" com base só nos nomes daquela categoria — uma
                categoria com nomes compridos desalinha a coluna em relação
                às outras. table-fixed + colgroup trava a mesma largura em
                todas (mesma ideia já usada em PublicHeatsList). */}
            <colgroup>
              <col className="w-14" />
              <col />
              <col className="w-24" />
            </colgroup>
            <thead>
              <tr className="border-b-2 border-secondary text-left text-xs font-bold uppercase tracking-widest text-muted-foreground">
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">Equipe</th>
                <th className="py-2 text-right">Pontos</th>
              </tr>
            </thead>
            <tbody>
              {categoryStandings.map((standing) => {
                const isExpanded = expandedTeamId === standing.team_id;
                return (
                  <Fragment key={standing.team_id}>
                    <tr
                      onClick={() => toggleTeam(standing.team_id)}
                      className="cursor-pointer border-b border-border hover:bg-muted"
                    >
                      <td className="py-3 pr-3 font-display text-2xl">
                        {standing.place ?? (
                          <span className="text-base text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="truncate py-3 pr-3 text-lg font-semibold">
                        <span className="mr-1.5 inline-block text-xs text-muted-foreground">
                          {isExpanded ? '▾' : '▸'}
                        </span>
                        {standing.team_name}
                      </td>
                      <td className="py-3 text-right text-lg font-bold">{standing.total_score}</td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-border bg-muted/40">
                        <td colSpan={3} className="px-3 py-4">
                          <TeamWorkoutResults teamId={standing.team_id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
