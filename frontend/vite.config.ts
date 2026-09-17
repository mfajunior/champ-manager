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
  },
})
