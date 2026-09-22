import { Fragment } from 'react';
import { HeatTransitionBanner } from './HeatTransitionBanner';
import { formatTime } from '../../lib/format';
import type { Heat } from '../../types';

// Versão só-leitura de HeatsList/LaneRow (components/heats), usada na tela
// pública de baterias. A diferença importante não é só visual: LaneRow tem
// botões de Lançar/Corrigir/Remover que chamam useCreateResult/useUpdateResult
// /useDeleteResult — mutações que o backend já rejeita sem token
// (authMiddleware em POST/PUT/DELETE /api/results), mas mostrar esses botões
// pra quem não pode usá-los é confuso e mostra intenção de escrita numa tela
// que deveria ser puramente informativa.
//
// Por isso esta lista também não mostra "Resultado" nem "Colocação": quem
// quer acompanhar pontuação em tempo real usa o placar (/evento/:id), que já
// é feito pra isso. Esta tela é só a escala — quem compete em qual raia, de
// qual categoria, e a que horas — então a tabela fica em Raia / Equipe /
// Categoria, e o horário aparece uma vez só, no cabeçalho da bateria (não
// repetido em cada raia, já que é o mesmo horário pra todo mundo daquela
// bateria).
//
// Baterias aparecem em ordem sequencial (heat_number), não agrupadas por
// categoria: desde a migration 005 uma bateria pode misturar categorias
// diferentes, então a categoria é mostrada por raia, não por bateria.
export function PublicHeatsList({ heats }: { heats: Heat[] }) {
  if (heats.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma bateria gerada ainda para esta prova.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {heats.map((heat, index) => (
        <Fragment key={heat.id}>
          <div className="border border-border">
            <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
              <span className="text-sm font-bold uppercase tracking-wider">
                Bateria {heat.heat_number}
              </span>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {heat.status === 'scheduled' &&
                  (heat.scheduled_time
                    ? `Horário: ${formatTime(heat.scheduled_time)}`
                    : 'Horário: a definir')}
                {heat.status === 'in_progress' &&
                  `Em andamento${
                    heat.scheduled_time ? ` · ${formatTime(heat.scheduled_time)}` : ' · sem horário calculado'
                  }`}
                {heat.status === 'completed' &&
                  `Concluída${
                    heat.scheduled_time ? ` · ${formatTime(heat.scheduled_time)}` : ' · sem horário calculado'
                  }`}
              </span>
            </div>
            <table className="w-full table-fixed">
              {/* Cada bateria é uma <table> separada (heats.map), então sem
                  larguras fixas o navegador recalcula a coluna "Equipe" com
                  base só no conteúdo daquela tabela — nomes de equipe mais
                  compridos numa bateria empurram "Categoria" mais pra direita
                  só ali, e a coluna fica desalinhada entre as baterias.
                  table-fixed + colgroup trava a mesma largura em todas. */}
              <colgroup>
                <col className="w-16" />
                <col className="w-2/5" />
                <col />
              </colgroup>
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Raia</th>
                  <th className="px-3 py-2">Equipe</th>
                  <th className="px-3 py-2">Categoria</th>
                </tr>
              </thead>
              <tbody>
                {heat.teams.map((lane) => (
                  <tr key={lane.heat_team_id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-sm font-semibold">{lane.lane_number}</td>
                    <td className="truncate px-3 py-2 text-sm">{lane.team_name}</td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">{lane.category_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {heats[index + 1] && <HeatTransitionBanner from={heat} to={heats[index + 1]} />}
        </Fragment>
      ))}
    </div>
  );
}
