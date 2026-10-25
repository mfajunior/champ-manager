/**
 * As raias de uma bateria que tem horário e ainda não tem escalação
 * (`schedule_only` — ver heatController.generate).
 *
 * Desenha `planned_lanes` linhas numeradas com traço no lugar da equipe e da
 * categoria. O número de raias vem da coluna `planned_lanes` e não de
 * `championships.lanes_per_heat`, porque a distribuição equilibrada raramente
 * enche todas: 30 equipes em 12 raias dão 10, 10 e 10, nunca 12, 12 e 6.
 * Desenhar 12 raias numa bateria que terá 10 prometeria duas vagas que não
 * existem.
 *
 * `colunas` existe porque as três tabelas que usam isto têm larguras
 * diferentes: a pública tem 3 colunas, a do organizador 6, a folha impressa 5.
 */
export function RaiasEmBranco({
  plannedLanes,
  colunasDepoisDaRaia,
}: {
  plannedLanes: number;
  colunasDepoisDaRaia: number;
}) {
  return (
    <>
      {Array.from({ length: plannedLanes }, (_, i) => (
        <tr key={`branco-${i}`} className="border-b border-border last:border-0">
          <td className="px-3 py-2 text-sm font-semibold text-muted-foreground">{i + 1}</td>
          {Array.from({ length: colunasDepoisDaRaia }, (_, c) => (
            <td key={c} className="px-3 py-2 text-sm text-muted-foreground">
              —
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
