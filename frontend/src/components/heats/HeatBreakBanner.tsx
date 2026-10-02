import { formatTimeAfter } from '../../lib/format';
import type { Heat } from '../../types';

/**
 * Faixa de intervalo (almoço, premiação) depois da última bateria de uma prova.
 *
 * Aparece só no fim da prova, nunca no meio: dentro de uma prova as baterias
 * misturam categorias de propósito, para não deixar raia vazia, e cortar ali
 * separaria categorias que competem em sequência. Na virada de uma prova para
 * a outra isso não acontece — é por isso que o intervalo é configurado na
 * prova (migration 013) e não como um horário solto no dia.
 *
 * Como o banner de transição, o dado é derivado do que a API já devolve: o
 * intervalo começa quando a última bateria termina (início + duração) e vai
 * até esse instante mais a duração configurada. Nenhum campo novo na resposta
 * para uma informação que já está inteira lá.
 */
export function HeatBreakBanner({
  lastHeat,
  breakSeconds,
}: {
  lastHeat: Heat;
  breakSeconds: number;
}) {
  if (!lastHeat.scheduled_time || lastHeat.duration_seconds === null) {
    return null;
  }

  const inicio = formatTimeAfter(lastHeat.scheduled_time, lastHeat.duration_seconds);
  const fim = formatTimeAfter(lastHeat.scheduled_time, lastHeat.duration_seconds + breakSeconds);
  const minutos = Math.round(breakSeconds / 60);

  return (
    <div className="flex items-center gap-3 border border-secondary bg-muted px-4 py-3">
      <span className="text-sm font-bold uppercase tracking-wider text-secondary">
        Intervalo
      </span>
      <span className="text-sm font-semibold text-foreground">
        {inicio} – {fim}
      </span>
      <span className="text-xs text-muted-foreground">
        {minutos} min
      </span>
    </div>
  );
}
