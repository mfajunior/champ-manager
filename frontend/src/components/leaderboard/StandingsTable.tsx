import type { Standing } from '../../types';

export function StandingsTable({ standings }: { standings: Standing[] }) {
  if (standings.length === 0) {
    return (
      <p className="text-center text-lg text-muted-foreground">
        Nenhum resultado lançado ainda neste campeonato.
      </p>
    );
  }

  const byCategory = standings.reduce<Record<string, Standing[]>>((acc, standing) => {
    (acc[standing.category_name] ||= []).push(standing);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-10">
      {Object.entries(byCategory).map(([categoryName, categoryStandings]) => (
        <div key={categoryName}>
          <h2 className="mb-4 font-display text-2xl uppercase tracking-wide text-brand">
            {categoryName}
          </h2>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-secondary text-left text-xs font-bold uppercase tracking-widest text-muted-foreground">
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">Equipe</th>
                <th className="py-2 pr-3">Provas</th>
                <th className="py-2 text-right">Pontos</th>
              </tr>
            </thead>
            <tbody>
              {categoryStandings.map((standing) => (
                <tr key={standing.id} className="border-b border-border">
                  <td className="py-3 pr-3 font-display text-2xl">{standing.place}</td>
                  <td className="py-3 pr-3 text-lg font-semibold">{standing.team_name}</td>
                  <td className="py-3 pr-3 text-sm text-muted-foreground">
                    {standing.workouts_completed}
                  </td>
                  <td className="py-3 text-right text-lg font-bold">{standing.total_score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
