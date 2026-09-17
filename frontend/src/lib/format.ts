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
