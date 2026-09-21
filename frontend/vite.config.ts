import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'


// changeOrigin (abaixo) reescreve só o cabeçalho Host da requisição
// encaminhada — o Origin do navegador segue intacto até o backend. Acessando
// por um túnel, o corsOriginChecker (backend/src/config/cors.js) recebe
// "https://algo.trycloudflare.com", que não está em CORS_ORIGIN, e recusa a
// requisição: "Origem não permitida pelo CORS". Só aparecia no login porque
// navegador não manda Origin em GET de mesma origem — só em POST/PUT/DELETE.
//
// A requisição Vite -> backend é servidor-a-servidor: não há navegador nem
// origem a declarar nela, e o próprio corsOriginChecker já libera requisição
// sem Origin (curl, app nativo). Remover o cabeçalho descreve essa verdade e
// vale pra qualquer host; acrescentar a URL do túnel em CORS_ORIGIN
// resolveria só até o próximo reinício do cloudflared, que sorteia outra.
//
// proxyReq cobre as chamadas HTTP (/api e o handshake em polling do
// socket.io); proxyReqWs cobre o upgrade para WebSocket.
const stripBrowserOrigin: ProxyOptions['configure'] = (proxy) => {
  proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin'));
  proxy.on('proxyReqWs', (proxyReq) => proxyReq.removeHeader('origin'));
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // O backend (src/app.js) usa CORS_ORIGIN || 'http://localhost:3000' como
    // padrão. Rodar o Vite na mesma porta evita ter que mexer no .env do
    // backend só para o frontend em desenvolvimento funcionar.
    port: 3000,
    // Por padrão o Vite só aceita conexão vinda da própria máquina
    // (bind em 127.0.0.1). host: true faz ele escutar em 0.0.0.0 — qualquer
    // aparelho na mesma rede Wi-Fi (celular, tablet) consegue abrir
    // http://<IP-do-PC>:3000. Sem isso, "acessar pelo celular" nem chega a
    // tentar: a conexão cai antes de existir resposta.
    host: true,
    // Proteção contra DNS rebinding: por padrão o Vite só aceita requests
    // cujo cabeçalho Host seja localhost/127.0.0.1/o IP da própria máquina —
    // qualquer outro Host (como o domínio gerado pelo túnel) é recusado com
    // "Blocked request... not allowed". O sufixo com ponto libera qualquer
    // subdomínio de trycloudflare.com (a URL do quick tunnel muda a cada
    // reinício, então não dá pra travar num host fixo) sem abrir pra
    // qualquer host da internet — ver server.allowedHosts na doc do Vite.
    allowedHosts: ['.trycloudflare.com'],
    // Encaminha /api e /socket.io para o backend em localhost:5000, do lado
    // do SERVIDOR do Vite (Node), não do navegador. Antes disso, o front
    // chamava a API por uma URL absoluta gravada em VITE_API_URL
    // (http://localhost:5000 ou o IP da rede, dependendo de quem acessava) —
    // então acessar de outro lugar (celular na wifi, ou de fora de casa por
    // um túnel/ngrok) exigia trocar essa URL toda vez, e ela precisava ser
    // alcançável PELO NAVEGADOR de quem está acessando, não só pelo PC.
    // Com o proxy, o front chama só "/api/..." (caminho relativo — ver
    // src/lib/api.ts e socket.ts): o navegador de quem acessa nem sabe que
    // existe uma porta 5000, e o Vite decide pra onde mandar cada request.
    // Isso só vale em desenvolvimento (`npm run dev`) — um build de produção
    // (`vite build`) não tem esse servidor rodando, então em produção
    // continua sendo necessário configurar VITE_API_URL de verdade (ver
    // README.md, seção de deploy).
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        configure: stripBrowserOrigin,
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
        changeOrigin: true,
        configure: stripBrowserOrigin,
      },
    },
  },
})
