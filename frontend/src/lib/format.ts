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
 * heats.scheduled_time é TIMESTAMP sem fuso no Postgres (mesma armadilha do
 * formatDate acima). O horário aí dentro é sempre o horário LOCAL do
 * campeonato (07:00 que você digitou em "Hora de início" continua sendo
 * literalmente 07:00 no banco — nunca teve conversão de fuso nenhuma).
 *
 * O problema é só na hora de exibir: o driver `pg` devolve esse valor como
 * um objeto Date tratando os dígitos crus como se fossem UTC (ex.: 07:00 no
 * banco vira um Date cujo instante UTC é 07:00Z). Formatar isso com
 * toLocaleTimeString() converte esse "07:00 rotulado como UTC" pro fuso do
 * navegador (Brasília, UTC-3) — e 07:00 UTC menos 3h exibe 04:00. É
 * exatamente o bug que você viu: campeonato configurado pra 07h, baterias
 * calculadas mostrando 04h.
 *
 * A correção é a mesma ideia do formatDate: nunca deixar o navegador
 * converter fuso nesse valor. Os componentes UTC do Date (getUTCHours/
 * getUTCMinutes) são exatamente os dígitos originais gravados no banco —
 * extraindo direto deles, sem toLocaleTimeString(), o horário exibido volta
 * a bater com o que foi digitado.
 */
export function formatTime(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * O mesmo tratamento de formatTime, para um instante deslocado N segundos a
 * partir do horário da bateria — é assim que se chega ao FIM dela (início +
 * duração calculada). A soma acontece em milissegundos e o resultado volta
 * a ser lido pelos componentes UTC, então nenhum fuso entra na conta em
 * nenhum momento (ver a explicação em formatTime acima).
 */
export function formatTimeAfter(isoDateTime: string, seconds: number): string {
  const base = new Date(isoDateTime);
  return formatTime(new Date(base.getTime() + seconds * 1000).toISOString());
}
