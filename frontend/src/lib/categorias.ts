/**
 * Abreviação das categorias, só para a tela de baterias.
 *
 * POR QUE SÓ ALI
 *
 * A tela de baterias tem três colunas competindo pela largura do celular —
 * raia, equipe e categoria — e é a única em que a categoria aparece em TODA
 * linha. "Iniciante Masculino" ocupava mais espaço que o nome da equipe e
 * quebrava em duas linhas, empurrando o nome para um truncate agressivo. A
 * abreviação devolve essa largura para o nome da equipe, que é o dado que a
 * pessoa está procurando quando abre essa tela.
 *
 * No placar a categoria é um título de seção, não coluna: lá cabe inteira e
 * o nome completo ajuda quem chega pelo link direto. Nas Equipes e nas Provas
 * o mesmo. Por isso isto não é um formatador global — é uma decisão de uma
 * tela só, e está num arquivo separado justamente para não ser importado por
 * reflexo em outro lugar.
 *
 * POR QUE CASAR PELO NOME E NÃO POR level/gender
 *
 * Seria mais robusto derivar de `level` + `gender`, que é o que o banco
 * guarda. Mas a consulta de baterias devolve só `category_name` por raia, e
 * acrescentar duas colunas à query mais pesada do sistema para economizar um
 * mapa de cinco linhas não se paga. As categorias nascem de DEFAULT_CATEGORIES
 * (championshipController) e a API não tem rota que renomeie categoria, então
 * esses cinco nomes são o conjunto fechado do que existe hoje.
 *
 * O fallback devolve o nome original. Se um dia aparecer categoria fora da
 * lista, ela aparece inteira — ocupando mais espaço, nunca errada ou vazia.
 */
const ABREVIACOES: Record<string, string> = {
  'iniciante masculino': 'INIC MASC',
  'iniciante feminino': 'INIC FEM',
  'scale masculino': 'SC MASC',
  'scale feminino': 'SC FEM',
  'rx misto': 'RX MISTO',
};

export function abreviarCategoria(nome: string): string {
  return ABREVIACOES[nome.trim().toLowerCase()] ?? nome;
}
