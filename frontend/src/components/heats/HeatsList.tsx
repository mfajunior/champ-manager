import { LaneRow } from './LaneRow';
import { formatTime } from '../../lib/format';
import type { Heat, ScoringType } from '../../types';

/**
 * Uma bateria não pertence mais a uma categoria só (migration 005) — pode
 * misturar categorias diferentes, preenchendo raia por raia numa sequência
 * fixa. Por isso as baterias aparecem em ordem sequencial (heat_number), não
 * mais agrupadas por categoria: quem quer saber a categoria de uma equipe
 * olha a raia dela (LaneRow já mostra isso).
 */
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

  return (
    <div className="flex flex-col gap-4">
      {heats.map((heat) => (
        <div key={heat.id} className="border border-border">
          <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
            <span className="text-sm font-bold uppercase tracking-wider">
              Bateria {heat.heat_number}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {heat.status === 'scheduled' && 'Agendada'}
              {heat.status === 'in_progress' && 'Em andamento'}
              {heat.status === 'completed' && 'Concluída'}
              {heat.scheduled_time
                ? ` · ${formatTime(heat.scheduled_time)}`
                : ' · sem horário calculado'}
            </span>
          </div>
          <table className="w-full table-fixed">
            {/* Cada bateria é uma <table> separada (heats.map), então sem
                largura fixa cada uma recalcula a coluna "Equipe" com base só
                no próprio conteúdo — nomes diferentes em cada bateria
                desalinhavam as colunas seguintes entre elas. table-fixed +
                colgroup trava a mesma largura em todas (mesma ideia já usada
                em PublicHeatsList/StandingsTable). Categoria é coluna própria
                (não mais colada no nome da equipe) pelo mesmo motivo: nome
                variando de tamanho empurrava a categoria pra uma posição
                diferente em cada linha. */}
            <colgroup>
              <col className="w-14" />
              <col />
              <col className="w-44" />
              <col className="w-32" />
              <col className="w-24" />
              <col className="w-48" />
            </colgroup>
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">Raia</th>
                <th className="px-3 py-2">Equipe</th>
                <th className="px-3 py-2">Categoria</th>
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
  );
}
