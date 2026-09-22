import { formatTime, formatTimeAfter } from '../../lib/format';
import type { Heat } from '../../types';

/**
 * Faixa entre duas baterias mostrando a janela de transição — o intervalo
 * entre o fim de uma e o começo da seguinte.
 *
 * O dado não vem pronto do backend: a agenda guarda quando cada bateria
 * COMEÇA (scheduled_time) e quanto ela dura (duration_seconds, o maior time
 * cap entre as categorias presentes). A janela é o que sobra entre uma coisa
 * e outra — fim = início + duração, e o fim da janela é o início da próxima.
 * Calcular aqui evita inventar um campo novo na API para uma informação que
 * já está inteiramente contida no que ela devolve.
 *
 * Não aparece quando falta horário (campeonato sem hora de início, ou
 * bateria cuja categoria não tem time cap definido — aí a agenda inteira a
 * partir dali fica nula) nem quando a janela é de zero minuto, caso de
 * campeonato configurado sem tempo de transição.
 */
export function HeatTransitionBanner({ from, to }: { from: Heat; to: Heat }) {
  if (!from.scheduled_time || from.duration_seconds === null || !to.scheduled_time) {
    return null;
  }

  const inicio = formatTimeAfter(from.scheduled_time, from.duration_seconds);
  const fim = formatTime(to.scheduled_time);

  if (inicio === fim) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
      <span>
        Transição · {inicio} – {fim}
      </span>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}
