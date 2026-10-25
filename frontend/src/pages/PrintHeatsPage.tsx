import { Link, useParams } from 'react-router-dom';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { Spinner } from '../components/ui/Spinner';
import { useChampionship } from '../hooks/useChampionships';
import { useHeats } from '../hooks/useHeats';
import { useWorkout } from '../hooks/useWorkouts';
import { abreviarCategoria } from '../lib/categorias';
import { formatDate, formatTime, formatTimeAfter } from '../lib/format';
import { getErrorMessage } from '../lib/errors';

/**
 * Folha de bateria para imprimir — a escala que vai pregada na parede do box e
 * na mão de quem chama as equipes para a raia.
 *
 * SÓ PARA O ORGANIZADOR
 *
 * A rota vive dentro do ProtectedLayout (ver App.tsx), e é isso que a torna
 * exclusiva: sem sessão o layout redireciona, então não há como chegar aqui
 * adivinhando a URL. Não é escondida por não estar linkada — é fechada pela
 * mesma porta que o resto do admin.
 *
 * POR QUE UMA PÁGINA PRÓPRIA E NÃO @media print NA TELA DE BATERIAS
 *
 * A tela do organizador tem seis colunas, botões de lançar e corrigir, modo de
 * remanejamento e banners de aviso. Esconder tudo isso com CSS daria uma folha
 * feita de exceções, e cada coisa nova naquela tela seria uma exceção a mais
 * para lembrar. Aqui a página já nasce com o conteúdo que vai ao papel.
 *
 * A CATEGORIA VAI NA LINHA, NÃO NO CABEÇALHO
 *
 * Uma bateria pode misturar categorias desde a migration 005 — com a geração
 * padrão, a bateria 2 de um campeonato de 29 duplas junta duas categorias. Se
 * a categoria estivesse no cabeçalho da bateria, a folha mentiria em todas as
 * baterias mistas. Na linha ela está sempre certa, e em bateria de uma
 * categoria só a coluna fica repetida — repetição é melhor que imprecisão numa
 * folha que vai ser usada sob pressão.
 *
 * O FIM DA BATERIA É DERIVADO
 *
 * duration_seconds é o maior time cap entre as categorias presentes; o fim é o
 * início mais isso. Prova sem time cap configurado não tem duração conhecida, e
 * aí a folha mostra só o início em vez de inventar um fim — é o mesmo critério
 * que a agenda usa para deixar o horário nulo em vez de chutar.
 */
export function PrintHeatsPage() {
  const { id, workoutId: workoutIdParam } = useParams<{ id: string; workoutId: string }>();
  const championshipId = Number(id);
  const workoutId = Number(workoutIdParam);

  const championship = useChampionship(championshipId);
  const workout = useWorkout(workoutId);
  const heats = useHeats(workoutId);

  const carregando = championship.isLoading || workout.isLoading || heats.isLoading;
  const erro = championship.error || workout.error || heats.error;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 print:max-w-none print:px-0 print:py-0">
      {/* Barra de ações: não vai ao papel (print:hidden). */}
      <div className="mb-6 flex items-center justify-between gap-4 print:hidden">
        <Link
          to={`/admin/campeonatos/${championshipId}`}
          className="text-xs font-bold uppercase tracking-wider text-muted-foreground hover:opacity-70"
        >
          ← Voltar ao campeonato
        </Link>
        <button
          onClick={() => window.print()}
          className="border border-brand px-4 py-2 text-xs font-bold uppercase tracking-wider text-brand hover:opacity-70"
        >
          Imprimir
        </button>
      </div>

      {carregando && <Spinner label="Carregando baterias..." />}
      {erro && <ErrorBanner message={getErrorMessage(erro)} />}

      {championship.data && workout.data && heats.data && (
        <div className="folha">
          <header className="mb-6 border-b-2 border-foreground pb-3">
            <h1 className="font-display text-3xl leading-none">
              {championship.data.name}
            </h1>
            <p className="mt-1 text-sm font-semibold uppercase tracking-wider">
              Prova {workout.data.workout_number} · {workout.data.name}
              {championship.data.date && ` · ${formatDate(championship.data.date)}`}
            </p>
          </header>

          {heats.data.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Esta prova não tem baterias geradas.
            </p>
          )}

          {heats.data.map((heat) => (
            <section key={heat.id} className="bateria mb-6">
              <div className="flex items-baseline justify-between gap-4 border-b border-foreground pb-1">
                <h2 className="font-display text-2xl leading-none">
                  Bateria {heat.heat_number}
                </h2>
                <span className="text-sm font-bold tabular-nums">
                  {heat.scheduled_time ? (
                    heat.duration_seconds !== null ? (
                      <>
                        {formatTime(heat.scheduled_time)} – {formatTimeAfter(heat.scheduled_time, heat.duration_seconds)}
                      </>
                    ) : (
                      formatTime(heat.scheduled_time)
                    )
                  ) : (
                    <span className="font-normal">horário a definir</span>
                  )}
                </span>
              </div>

              {/* table-fixed, e não só o colgroup. Cada bateria é uma <table>
                  separada (heats.data.map), então no algoritmo automático o
                  navegador dimensiona as colunas pelo conteúdo DAQUELA tabela
                  — e "Atleta 2" cai num lugar diferente em cada bateria, que
                  é o que a folha mostrava. Com table-fixed as larguras saem do
                  colgroup e valem igual em todas. Mesma razão já registrada em
                  PublicHeatsList e StandingsTable.

                  Todas em porcentagem, somando exatamente 100%: misturar px
                  com % deixaria uma sobra para o navegador distribuir, e a
                  folha impressa tem largura diferente da tela. Em A4 com 12mm
                  de margem isso dá, por coluna: 11mm para a raia, 45mm para a
                  equipe, 22mm para a categoria abreviada e 54mm para cada
                  atleta. */}
              <table className="w-full table-fixed border-collapse">
                <colgroup>
                  <col className="w-[6%]" />
                  <col className="w-[24%]" />
                  <col className="w-[12%]" />
                  <col className="w-[29%]" />
                  <col className="w-[29%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-border text-left text-[10px] font-bold uppercase tracking-widest">
                    <th className="py-1 pr-2">Raia</th>
                    <th className="py-1 pr-2">Equipe</th>
                    <th className="py-1 pr-2">Cat.</th>
                    <th className="py-1 pr-2">Atleta 1</th>
                    <th className="py-1">Atleta 2</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Bateria de cronograma: a folha sai com o horário e as
                      raias em branco, para o organizador preencher à mão se a
                      escalação for decidida no box. */}
                  {heat.teams.length === 0 &&
                    heat.planned_lanes !== null &&
                    Array.from({ length: heat.planned_lanes }, (_, i) => (
                      <tr key={`branco-${i}`} className="border-b border-border last:border-0">
                        <td className="py-1.5 pr-2 text-sm font-bold tabular-nums">{i + 1}</td>
                        <td className="py-1.5 pr-2 text-sm">—</td>
                        <td className="py-1.5 pr-2 text-[10px]">—</td>
                        <td className="py-1.5 pr-2 text-sm">—</td>
                        <td className="py-1.5 text-sm">—</td>
                      </tr>
                    ))}
                  {heat.teams.map((lane) => (
                    <tr key={lane.heat_team_id} className="border-b border-border last:border-0">
                      <td className="py-1.5 pr-2 text-sm font-bold tabular-nums">
                        {lane.lane_number}
                      </td>
                      <td className="break-words py-1.5 pr-2 text-sm font-semibold">{lane.team_name}</td>
                      <td className="py-1.5 pr-2 text-[10px] font-bold uppercase tracking-wider">
                        {abreviarCategoria(lane.category_name)}
                      </td>
                      <td className="break-words py-1.5 pr-2 text-sm">{lane.athlete_1 ?? ''}</td>
                      <td className="break-words py-1.5 text-sm">{lane.athlete_2 ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
