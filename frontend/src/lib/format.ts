/**
 * O backend guarda `date` como DATE (sem hora) no Postgres, mas o driver
 * `pg` serializa isso como um datetime UTC completo (ex.: "2026-12-20T00:00:00.000Z").
 * Duas armadilhas nisso, não uma só:
 *
 * 1. `new Date(`${date}T00:00:00`)` — o bug que isso corrige — gera uma string
 *    tipo "2026-12-20T00:00:00.000ZT00:00:00", que é uma data inválida.
 * 2. Mesmo corrigindo para `new Date(date)` puro, formatar esse UTC-midnight
 *    com `toLocaleDateString()` num fuso horário atrás de UTC (o Brasil
 *    inteiro está) devolve o dia ANTERIOR — 20 de dezembro vira 19.
 *
 * Como é uma data de calendário pura, sem hora relevante, a forma correta é
 * nunca converter para fuso local: extrair ano/mês/dia direto da string.
 */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

/**
 * HORÁRIO DE BATERIA É HORÁRIO DE PAREDE, NÃO INSTANTE
 *
 * "A bateria começa às 08:00" não é um ponto na linha do tempo universal — é o
 * que o relógio da parede do box vai mostrar. Por isso heats.scheduled_time é
 * TIMESTAMP sem fuso no banco (a migration 009 deixou essa coluna de fora de
 * propósito) e o backend passou a devolvê-la como texto puro via to_char:
 * "2026-12-12T08:00:00", sem Z e sem offset.
 *
 * POR QUE A VERSÃO ANTERIOR PARECIA CERTA E NÃO ERA
 *
 * O código aqui usava `new Date(iso)` + `getUTCHours()`, com o raciocínio de
 * que "o driver pg devolve um Date tratando os dígitos crus como se fossem
 * UTC". Isso não é verdade: o pg interpreta um TIMESTAMP sem fuso no fuso do
 * PROCESSO Node. Só parece UTC quando o processo roda em UTC.
 *
 * Medido, com 08:00 gravado no banco:
 *   backend em container UTC   -> chega "08:00Z" -> getUTCHours mostra 08:00 ✓
 *   backend no Windows (UTC-3) -> chega "11:00Z" -> getUTCHours mostra 11:00 ✗
 *
 * Ou seja: o horário exibido dependia de ONDE o backend rodava. Rodando por
 * `npm run dev` fora do container, o dia inteiro aparecia três horas adiantado.
 * É a mesma classe de bug que a migration 009 corrigiu no histórico de
 * lançamentos, reaparecendo pelo outro lado — e o comentário antigo deste
 * arquivo registrava o sintoma certo com a causa errada, que foi o que
 * permitiu ele voltar.
 *
 * A CORREÇÃO: NÃO CONSTRUIR Date
 *
 * Sem Date, não há fuso para converter errado. As duas funções abaixo mexem na
 * string e em minutos — o resultado é o mesmo no seu PC, no container e na
 * Render.
 */

const HHMM = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/;

/** "2026-12-12T08:00:00" -> "08:00" */
export function formatTime(wallClock: string): string {
  const match = HHMM.exec(wallClock);
  if (match) {
    return `${match[1]}:${match[2]}`;
  }

  // Tolerância para um valor que ainda venha com fuso (endpoint que não passou
  // pelo to_char, ou resposta antiga em cache): melhor mostrar algo coerente
  // com o relógio de quem está olhando do que quebrar a tela.
  const date = new Date(wallClock);
  if (Number.isNaN(date.getTime())) return '--:--';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * O horário N segundos depois — é assim que se chega ao FIM de uma bateria
 * (início + duração) e, daí, à janela de transição até a próxima.
 *
 * Aritmética de minutos, sem Date. O módulo de 1440 evita devolver "25:30" se
 * um campeonato virar o dia — não é cenário de CrossFit, mas custa uma linha.
 */
export function formatTimeAfter(wallClock: string, seconds: number): string {
  const match = HHMM.exec(wallClock);
  if (!match) return formatTime(wallClock);

  const totalMinutos =
    Number(match[1]) * 60 + Number(match[2]) + Math.floor(seconds / 60);
  const doDia = ((totalMinutos % 1440) + 1440) % 1440;

  return `${String(Math.floor(doDia / 60)).padStart(2, '0')}:${String(doDia % 60).padStart(2, '0')}`;
}
