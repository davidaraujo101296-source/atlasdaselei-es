// Servidor exclusivamente local: reutiliza os handlers existentes, sem deploy.
'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const handlers = {
  '/api/apuracao': require('../api/apuracao'),
  '/api/mapa': require('../api/mapa'),
};
const pages = new Map([
  ['/', 'index.html'], ['/index.html', 'index.html'],
  ['/atlas.html', 'atlas.html'], ['/ao-vivo.html', 'ao-vivo.html'],
  ['/styles.css', 'styles.css'], ['/live-status.js', 'live-status.js'], ['/robots.txt', 'robots.txt'],
  ['/election-cards.js', 'election-cards.js'],
  ['/brasil-editorial.css', 'brasil-editorial.css'],
  ...['brasil-aquarela.webp', 'brasilia-aquarela.webp', 'rio-aquarela.webp', 'cidades-aquarela.webp']
    .map(file => ['/assets/' + file, 'assets/' + file]),
  ...['brasil-panorama.webp', 'brasilia-editorial.webp', 'rio-editorial.webp', 'cidades-editorial.webp']
    .map(file => ['/assets/' + file, 'assets/' + file]),
  ...['hero-paisagem-brasileira.svg', 'card-eleicao-2018.svg', 'card-eleicao-2022.svg',
    'card-eleicao-2024.svg', 'card-eleicao-2026.svg', 'ondas-rodape-brasil.svg', 'brasil-silhueta.svg']
    .map(file => ['/assets/' + file, 'assets/' + file]),
]);
const port = Number(process.env.PORT || 3000);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const handler = handlers[url.pathname];
    if (Object.hasOwn(handlers, url.pathname)) {
      req.query = Object.fromEntries(url.searchParams);
      await handler(req, res);
      return;
    }
    // Resultados históricos estáticos: somente arquivos .json de dados/historico/.
    const historico = /^\/dados\/historico\/[a-z0-9-]+\.json$/.test(url.pathname) ? url.pathname.slice(1) : null;
    const file = historico || pages.get(url.pathname);
    if (!file) { res.writeHead(404); res.end('Não encontrado'); return; }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
    }
    const body = await fs.readFile(path.join(root, file));
    const type = file.endsWith('.webp') ? 'image/webp' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : 'text/plain';
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    console.error(error.message);
    if (!res.headersSent) res.writeHead(500);
    res.end('Erro no servidor local');
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  console.log(`Atlas Eleitoral local: http://127.0.0.1:${port}`);
  console.log('Demonstração visual: /ao-vivo.html?demo=1 (votos fictícios identificados)');
});
