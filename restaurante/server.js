#!/usr/bin/env node
'use strict';

const http = require('node:http');
const path = require('node:path');
const { abrirBanco } = require('./src/db');
const { criarApp } = require('./src/app');

const PORTA = Number(process.env.PORT || 3000);
const BANCO = process.env.BANCO || path.join(__dirname, 'dados', 'restaurante.db');

const repo = abrirBanco(BANCO);
const cookieSeguro = process.env.COOKIE_SEGURO === '1' ? true : null;
const servidor = http.createServer(criarApp({ repo, cookieSeguro }));

servidor.listen(PORTA, () => {
  console.log(`Comanda Fácil rodando em http://localhost:${PORTA}`);
  console.log(`Banco de dados: ${BANCO}`);
});

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    servidor.close();
    repo.db.close();
    process.exit(0);
  });
}
