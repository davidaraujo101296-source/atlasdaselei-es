'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const raiz = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(raiz, f), 'utf8');
const ids = html => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

test('vertical: mesmos IDs que o motor da transmissão usa', () => {
  const js = ler('transmissao.js');
  const usados = new Set([...js.matchAll(/\$\('([a-z-]+)'\)/g)].map(m => m[1]));
  const v = ids(ler('transmissao-vertical.html')), h = ids(ler('transmissao.html'));
  for (const id of usados) {
    if (id === 'contagem' || id === 'selo-parcial') continue; // criados dentro do placar
    assert.ok(h.has(id), 'horizontal tem #' + id);
    assert.ok(v.has(id), 'vertical tem #' + id);
  }
  assert.ok(ler('transmissao-vertical.html').includes('class="painel-mapa"'), 'painel dos cards');
  assert.ok(ler('transmissao-vertical.html').includes('<span class="fonte">'), 'rodapé usado pela demonstração');
});

test('vertical: 1080x1920 declarado e os mesmos scripts, na mesma ordem', () => {
  const html = ler('transmissao-vertical.html');
  assert.match(html, /id="tela" class="tela" data-largura="1080" data-altura="1920"/);
  assert.match(html, /<meta name="viewport" content="width=1080,height=1920">/);
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(scripts, ['transmissao-core.js', 'transmissao-cartoes.js', 'transmissao.js']);
  assert.ok(html.includes('href="transmissao-vertical.css"') && !html.includes('href="transmissao.css"'), 'CSS próprio, sem misturar com a horizontal');
  assert.ok(!html.includes('apoio.js'), 'sem pedidos de apoio do site');
});

test('vertical: nenhuma mensagem dos cards duplicada fora de transmissao-cartoes.js', () => {
  const K = require('../transmissao-cartoes.js');
  const textos = [...K.DOACOES, ...K.COMPARTILHAMENTOS].map(m => m.titulo);
  for (const f of ['transmissao-vertical.html', 'transmissao-vertical.css', 'transmissao.html', 'transmissao.js']) {
    const conteudo = ler(f);
    for (const t of textos) assert.ok(!conteudo.includes(t), `${f} repete "${t}"`);
  }
});

test('vertical: domínio legível, guias de teste ocultas por padrão e sem novas APIs', () => {
  const html = ler('transmissao-vertical.html');
  assert.equal((html.match(/www\.atlaseleitoral\.org/g) || []).length, 2, 'domínio no cabeçalho e no rodapé');
  assert.match(html, /id="guias" class="guias" hidden/);
  assert.match(html, /get\('guias'\) === '1'/);
  assert.ok(!/fetch\(|api\//.test(html), 'a vertical não faz consultas próprias');
});

test('horizontal: escala padrão continua 1920x1080 e a página não mudou de estrutura', () => {
  const js = ler('transmissao.js');
  assert.match(js, /Number\(tela\.dataset\.largura\) \|\| 1920, altura = Number\(tela\.dataset\.altura\) \|\| 1080/);
  const html = ler('transmissao.html');
  assert.match(html, /<div id="tela" class="tela">/, 'horizontal sem data-largura: usa o padrão');
  assert.match(html, /href="transmissao\.css"/);
  assert.match(js, /const API = 'https:\/\/atlasdaselei-es\.vercel\.app';/);
});
