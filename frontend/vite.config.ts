import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
  },
})
