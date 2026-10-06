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

  // O modelo vem em cada linha (fetchStandings junta championships), e é o
  // mesmo para o campeonato inteiro — ler da primeira linha basta.
  const usandoPontos = standings[0].scoring_model === 'points_table';

  // No modelo padrão a coluna é a SOMA DAS COLOCAÇÕES, onde menor é melhor.
  // Chamar isso de "Pontos", como estava antes, sugeria o contrário para
  // quem olha o telão: 3 parecia pior que 12.
  const rotuloDaColuna = usandoPontos ? 'Pontos' : 'Soma';

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
            {/* Larguras menores no celular: a coluna de colocação e a de
                pontos tinham medida de desktop (w-14 / w-24) e juntas comiam
                metade da tela de um telefone, sobrando pouco para o nome da
                equipe — que é o dado que a pessoa está procurando. */}
            <colgroup>
              <col className="w-10 sm:w-14" />
              <col />
              <col className="w-16 sm:w-24" />
            </colgroup>
            <thead>
              <tr className="border-b-2 border-secondary text-left text-xs font-bold uppercase tracking-widest text-muted-foreground">
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">Equipe</th>
                <th className="py-2 text-right">{rotuloDaColuna}</th>
              </tr>
            </thead>
            <tbody>
              {categoryStandings.map((standing) => {
                const isExpanded = expandedTeamId === standing.team_id;
                // Equipe fora do corte continua no placar com os pontos que
                // conquistou — ela não sumiu da competição, só não disputa as
                // provas seguintes. Some das baterias, não do histórico.
                const cortada = standing.is_cut;
                const valor = usandoPontos ? standing.total_points : standing.total_score;

                return (
                  <Fragment key={standing.team_id}>
                    <tr
                      onClick={() => toggleTeam(standing.team_id)}
                      className={`cursor-pointer border-b border-border hover:bg-muted ${
                        cortada ? 'opacity-60' : ''
                      }`}
                    >
                      <td className="py-3 pr-3 font-display text-2xl">
                        {standing.place ?? (
                          <span className="text-base text-muted-foreground">—</span>
                        )}
                      </td>
                      {/* Sem truncate: no celular o nome quebra em mais de
                          uma linha em vez de terminar em "...". A linha fica
                          mais alta, o que é aceitável numa lista que se lê de
                          cima para baixo, e nenhum nome fica pela metade. Em
                          tela larga não há o que quebrar. */}
                      <td className="break-words py-3 pr-3 text-base font-semibold sm:text-lg">
                        <span className="mr-1.5 inline-block text-xs text-muted-foreground">
                          {isExpanded ? '▾' : '▸'}
                        </span>
                        {standing.team_name}
                        {cortada && (
                          <span className="ml-2 whitespace-nowrap border border-border px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            fora do corte
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right text-lg font-bold">
                        {valor ?? <span className="text-muted-foreground">—</span>}
                      </td>
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
