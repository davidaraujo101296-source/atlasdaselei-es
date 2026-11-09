FROM node:22-alpine
ENV NODE_ENV=production TZ=America/Sao_Paulo FUSO=America/Sao_Paulo PORT=3000 BANCO=/dados/restaurante.db
RUN mkdir -p /dados && chown node:node /dados
WORKDIR /app
COPY package.json server.js agente-impressao.js ./
COPY src ./src
COPY public ./public
VOLUME /dados
EXPOSE 3000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
