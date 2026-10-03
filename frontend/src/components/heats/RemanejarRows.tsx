import type { HeatLane } from '../../types';

/**
 * Linhas usadas SÓ no modo de remanejamento.
 *
 * POR QUE UM MODO, E NÃO BOTÕES SEMPRE VISÍVEIS
 * A tela de baterias é operada durante a prova, com pressa, para lançar
 * resultado. Botão de mover equipe ao lado do botão de lançar é convite a
 * clicar errado com o cronômetro correndo. O modo separa as duas intenções: ou
 * você está lançando resultado, ou está arrumando as baterias.
 *
 * POR QUE DOIS CLIQUES, E NÃO ARRASTAR
 * Arrastar é ruim em tablet, difícil de acertar com a mão trêmula e caro de
 * construir direito. Clicar na equipe e depois no destino funciona em qualquer
 * dispositivo, mostra o que está selecionado e dá para cancelar.
 *
 * E o organizador nunca escolhe entre "trocar" e "mover": quem decide é o
 * destino. Ocupado, troca; livre, move. São duas chamadas diferentes no
 * backend e uma decisão só para quem usa.
 */

export function LaneRemanejarRow({
  lane,
  selecionada,
  onSelecionar,
  onTrocarCom,
  ocupada,
}: {
  lane: HeatLane;
  selecionada: boolean;
  onSelecionar: () => void;
  onTrocarCom: () => void;
  ocupada: boolean;
}) {
  return (
    <tr
      className={`border-b border-border last:border-0 ${
        selecionada ? 'bg-brand/10' : ''
      }`}
    >
      <td className="px-3 py-2 text-sm font-semibold">{lane.lane_number}</td>
      <td className="truncate px-3 py-2 text-sm">{lane.team_name}</td>
      <td className="truncate px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {lane.category_name}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground" colSpan={2}>
        {selecionada && 'selecionada'}
      </td>
      <td className="px-3 py-2 text-right">
        {selecionada ? (
          <button
            onClick={onSelecionar}
            className="text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            Cancelar
          </button>
        ) : ocupada ? (
          <button
            onClick={onTrocarCom}
            className="border border-secondary px-2 py-1 text-xs font-bold uppercase tracking-wider text-secondary hover:bg-secondary hover:text-white"
          >
            Trocar aqui
          </button>
        ) : (
          <button
            onClick={onSelecionar}
            className="text-xs font-bold uppercase tracking-wider text-secondary hover:opacity-70"
          >
            Mover esta
          </button>
        )}
      </td>
    </tr>
  );
}

/**
 * Uma raia vazia da bateria. Só existe no modo de remanejamento: fora dele,
 * mostrar linha vazia só faria a lista crescer sem dizer nada. Aqui ela é o
 * alvo do movimento — é onde a equipe da bateria cheia vai caber.
 */
export function RaiaLivreRow({
  laneNumber,
  habilitada,
  onMoverPara,
}: {
  laneNumber: number;
  habilitada: boolean;
  onMoverPara: () => void;
}) {
  return (
    <tr className="border-b border-dashed border-border last:border-0">
      <td className="px-3 py-2 text-sm font-semibold text-muted-foreground">{laneNumber}</td>
      <td className="px-3 py-2 text-sm italic text-muted-foreground" colSpan={4}>
        raia livre
      </td>
      <td className="px-3 py-2 text-right">
        {habilitada && (
          <button
            onClick={onMoverPara}
            className="border border-brand px-2 py-1 text-xs font-bold uppercase tracking-wider text-brand hover:bg-brand hover:text-brand-foreground"
          >
            Mover aqui
          </button>
        )}
      </td>
    </tr>
  );
}
