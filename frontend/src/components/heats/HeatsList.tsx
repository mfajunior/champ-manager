import { LaneRow } from './LaneRow';
import type { Heat, ScoringType } from '../../types';

export function HeatsList({
  heats,
  workoutId,
  scoringType,
}: {
  heats: Heat[];
  workoutId: number;
  scoringType: ScoringType;
}) {
  if (heats.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma bateria gerada ainda para esta prova.
      </p>
    );
  }

  const byCategory = heats.reduce<Record<string, Heat[]>>((acc, heat) => {
    (acc[heat.category_name] ||= []).push(heat);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-8">
      {Object.entries(byCategory).map(([categoryName, categoryHeats]) => (
        <div key={categoryName}>
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            {categoryName}
          </h3>
          <div className="flex flex-col gap-4">
            {categoryHeats.map((heat) => (
              <div key={heat.id} className="border border-border">
                <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
                  <span className="text-sm font-bold uppercase tracking-wider">
                    Bateria {heat.heat_number}
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {heat.status === 'scheduled' && 'Agendada'}
                    {heat.status === 'in_progress' && 'Em andamento'}
                    {heat.status === 'completed' && 'Concluída'}
                    {heat.scheduled_time &&
                      ` · ${new Date(heat.scheduled_time).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`}
                  </span>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2">Raia</th>
                      <th className="px-3 py-2">Equipe</th>
                      <th className="px-3 py-2">Resultado</th>
                      <th className="px-3 py-2">Colocação</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {heat.teams.map((lane) => (
                      <LaneRow key={lane.heat_team_id} lane={lane} workoutId={workoutId} scoringType={scoringType} />
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
