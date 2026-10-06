/**
 * CACHE DE LEITURA EM MEMÓRIA, PARA AS ROTAS PÚBLICAS QUE A PLATEIA ABRE JUNTO
 *
 * O problema que ele resolve não é o cliente pedir a mesma coisa duas vezes —
 * disso o cache HTTP do navegador já dá conta, e é por isso que quase toda
 * resposta do ScoreUp volta 304. O problema é CEM CLIENTES DIFERENTES pedindo
 * a mesma coisa no mesmo segundo: cada um tem o próprio cache, e todos batem
 * no backend.
 *
 * Medido em produção, no endpoint do placar:
 *   concorrência  5 ->  28,3 req/s   p95 390 ms
 *   concorrência 10 ->  57,0 req/s   p95 200 ms   <- escala linear, sem fila
 *   concorrência 20 ->  53,8 req/s   p95 796 ms   <- vazão CAI, fila se forma
 *
 * O joelho fica entre 10 e 20, e depois dele o sistema não estabiliza: piora.
 * Então o objetivo não é aguentar o pico, é nunca chegar perto do joelho.
 *
 * POR QUE SÓ EM ROTAS ESCOLHIDAS A DEDO
 *
 * A chave é a URL. Se duas pessoas pedem a mesma URL e a resposta depende de
 * QUEM pediu, a segunda recebe os dados da primeira. Hoje nenhuma rota do
 * ScoreUp devolve conteúdo por usuário, então não há vazamento — mas montar
 * isso no /api inteiro deixaria a armadilha armada para o dia em que alguém
 * adicionar papéis ou uma rota "meus campeonatos". Cachear três rotas nomeadas
 * torna isso impossível por construção.
 */

const armazem = new Map();

// Guarda contra um query string inesperado inflar o Map. Com as rotas atuais
// são menos de 20 chaves; o teto é higiene, não dimensionamento.
const TETO_DE_ENTRADAS = 200;

// Escape para a suíte dedicada de cache. Existe porque o cache é estado dentro
// do processo e a suíte roda o app em processo: ligado por padrão em teste, ele
// faria uma suíte poluir a outra. Nenhum outro arquivo deve usar isto.
let ligadoEmTeste = false;
const _ligarParaTeste = (valor) => {
  ligadoEmTeste = valor;
  armazem.clear();
};

const desligado = () =>
  process.env.CACHE_DISABLED === 'true' ||
  (process.env.NODE_ENV === 'test' && !ligadoEmTeste);

/**
 * Monta o cache numa rota GET específica, com o TTL em segundos.
 *
 * O TTL é só rede de segurança: quem mantém a correção é a invalidação por
 * escrita, abaixo. Ele cobre o caso de alguém escrever direto no banco, sem
 * passar pela API.
 */
const cacheDeLeitura = (segundos) => (req, res, next) => {
  if (desligado() || req.method !== 'GET') return next();

  const chave = req.originalUrl;
  const guardado = armazem.get(chave);

  if (guardado && guardado.expiraEm > Date.now()) {
    res.set('X-Cache', 'HIT');
    // send() com a mesma string regera o mesmo ETag, então o 304 condicional
    // do navegador continua funcionando por cima deste cache.
    return res.type('application/json').status(200).send(guardado.corpo);
  }

  res.set('X-Cache', 'MISS');

  const enviarOriginal = res.send.bind(res);
  res.send = (corpo) => {
    // Só 200. Cachear um 401 faria o organizador continuar vendo "sessão
    // expirada" depois de entrar de novo; cachear um 500 transformaria uma
    // falha de um segundo em falha garantida pelo resto do TTL.
    if (res.statusCode === 200 && typeof corpo === 'string') {
      if (armazem.size >= TETO_DE_ENTRADAS) armazem.clear();
      armazem.set(chave, { corpo, expiraEm: Date.now() + segundos * 1000 });
    }
    return enviarOriginal(corpo);
  };

  return next();
};

/**
 * Limpa o cache depois de QUALQUER escrita bem-sucedida.
 *
 * A alternativa seria chamar invalidar() em cada controller que altera dado:
 * lançar resultado, remanejar raia, regerar baterias, renomear prova, editar
 * variante. São cinco pontos hoje e mais a cada funcionalidade — e esquecer um
 * é o bug clássico de cache: a tela que não atualiza, descoberta em produção.
 *
 * Invalidar tudo de uma vez custa uma consulta a mais ao banco na próxima
 * leitura de cada rota cacheada. Invalidar de menos mostra dado velho no telão
 * do evento. O preço do erro é assimétrico, então erramos para o lado barato.
 */
const invalidarAposEscrita = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) armazem.clear();
  });

  return next();
};

module.exports = { cacheDeLeitura, invalidarAposEscrita, _ligarParaTeste };
