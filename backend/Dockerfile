FROM node:18-alpine

WORKDIR /app

# Copia package.json e instala dependências
COPY package*.json ./
RUN npm install --omit=dev

# Copia código fonte
COPY . .

# Expõe porta
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Inicia aplicação
CMD ["npm", "start"]
