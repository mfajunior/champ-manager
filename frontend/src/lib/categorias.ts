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

/**
 * Esconde a categoria que não tem nenhuma equipe inscrita.
 *
 * O ALTIORA abriu cinco categorias e Iniciante Masculino não recebeu
 * inscrição. Ela aparecia como botão de filtro no placar e nas provas, e como
 * campo de variante na tela do organizador — sempre levando a uma lista vazia.
 *
 * O critério é o `teams_count` que GET /api/championships/:id já devolve, e a
 * categoria NÃO é apagada do banco: inscreveu-se alguém, ela volta sozinha.
 * Apagar exigiria migration, cuidar da cascata de variantes e não teria como
 * desfazer no dia do evento.
 *
 * `teams_count` é opcional no tipo porque o POST de campeonato devolve as
 * categorias recém-criadas sem a contagem. Daí o teste ser `!== 0` e não
 * `> 0`: contagem ausente mostra a categoria. Esconder por falta de dado seria
 * pior do que mostrar uma categoria vazia.
 *
 * NÃO use isto no cadastro de equipe: lá a lista precisa de todas as
 * categorias, senão a primeira equipe de uma categoria vazia nunca poderia
 * ser cadastrada — a categoria estaria escondida exatamente por ainda não ter
 * equipe.
 */
export function categoriasComEquipe<T extends { teams_count?: number }>(categorias: T[]): T[] {
  return categorias.filter((c) => c.teams_count !== 0);
}
