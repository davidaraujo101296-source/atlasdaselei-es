'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../pix.js');
const C = require('../apoio-core.js');
const raiz = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(raiz, f), 'utf8');

test('CRC16 do BR Code confere com o exemplo oficial do Banco Central', () => {
  const exemplo = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';
  assert.equal(P.crc16(exemplo.slice(0, -4)), '1D3D');
  assert.equal(P.ler(exemplo).ok, true);
  assert.equal(P.ler(exemplo.slice(0, -1) + 'E').ok, false, 'CRC alterado é rejeitado');
});

test('Pix Copia e Cola do Atlas: estático, sem valor, chave e recebedor aprovados', () => {
  const r = P.ler(P.CODIGO);
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.campos['00'], '01');
  assert.deepEqual(r.campos['26'], { '00': 'br.gov.bcb.pix', '01': 'atlaseleitoral.david@gmail.com' });
  assert.equal(r.campos['52'], '0000');
  assert.equal(r.campos['53'], '986');
  assert.equal(r.campos['54'], undefined, 'sem valor fixo');
  assert.equal(r.campos['58'], 'BR');
  assert.equal(r.campos['59'], 'DAVID DE ARAUJO LIMA');
  assert.equal(r.campos['60'], 'SAO PAULO');
  assert.deepEqual(r.campos['62'], { '05': '***' });
  assert.equal(P.CHAVE, 'atlaseleitoral.david@gmail.com');
  assert.notEqual(P.CODIGO, P.CHAVE, 'a chave (e-mail) não é o código Copia e Cola');
  assert.throws(() => P.brCode({ nome: 'NOME COM ACENTUAÇÃO' }));
  assert.throws(() => P.brCode({ cidade: 'UMA CIDADE COM NOME LONGO' }));
});

test('QR Codes gerados existem e a página mostra a chave e o QR de pagamento', () => {
  assert.match(ler('assets/pix-qr.svg'), /^<svg[\s\S]*<\/svg>\s*$/);
  const html = ler('apoiar.html');
  assert.ok(html.includes('src="assets/pix-qr.svg"'));
  assert.ok(html.includes('atlaseleitoral.david@gmail.com'));
  assert.ok(html.includes('data-aa-acao="copiar-codigo"') && html.includes('data-aa-acao="copiar-chave"'));
  assert.ok(html.includes('Contribuição voluntária, sem valor mínimo.'));
  assert.ok(!/foto|<img[^>]+david/i.test(html), 'sem foto pessoal');
});

test('pedidos de apoio: 3 min e 30 min de navegação ativa, um de cada vez', () => {
  let e = C.novo(0);
  const avancar = (de, ate) => { for (let t = de; t <= ate; t += 1000) e = C.registrar(e, t); };
  avancar(0, 179000);
  assert.equal(C.pedidoDevido(e), 0, 'antes de 3 min');
  avancar(180000, 181000);
  assert.equal(C.pedidoDevido(e), 1);
  e = C.marcarExibido(e, 1, 181000);
  avancar(182000, 1799000);
  assert.equal(C.pedidoDevido(e), 0, 'antes de 30 min');
  avancar(1800000, 1802000);
  assert.equal(C.pedidoDevido(e), 2);
  e = C.marcarExibido(e, 2, 1802000);
  avancar(1803000, 5000000);
  assert.equal(C.pedidoDevido(e), 0, 'cada pedido no máximo uma vez por ciclo');
});

test('pedido 2 nunca aparece antes do 1 nem junto com ele', () => {
  const e = { ...C.novo(0), ativoMs: 40 * 60e3 };
  assert.equal(C.pedidoDevido(e), 1);
  assert.equal(C.pedidoDevido(C.marcarExibido(e, 1, 1)), 2);
});

test('aba oculta ou site fechado não contam tempo', () => {
  const t0 = Date.parse('2026-10-25T18:00:00-03:00');
  let e = C.registrar(C.novo(t0), t0);
  assert.equal(e.ativoMs, 0, 'o primeiro registro não conta tempo anterior');
  e = C.registrar(e, t0 + 1000);
  e = C.registrar(e, t0 + 1000 + 10 * 60e3); // 10 min sem registro: não conta
  assert.equal(e.ativoMs, 1000);
});

test('várias abas visíveis não contam o tempo em dobro', () => {
  // Duas abas registrando a cada 1 s, defasadas em 400 ms, no mesmo armazenamento.
  let e = C.novo(0);
  for (let t = 1000; t <= 120000; t += 1000) { e = C.registrar(e, t); e = C.registrar(e, t + 400); }
  assert.ok(Math.abs(e.ativoMs - 119400) <= 1000, 'tempo ativo ≈ tempo real: ' + e.ativoMs);
});

test('ciclo de 24 h: depois dele os pedidos podem voltar; relógio do futuro recomeça', () => {
  let e = C.marcarExibido(C.marcarExibido({ ...C.novo(0), ativoMs: 31 * 60e3 }, 1, 1), 2, 2);
  assert.equal(C.normalizar(e, C.CICLO_MS - 1).pedido2, 2, 'ainda no ciclo');
  const novo = C.normalizar(e, C.CICLO_MS);
  assert.equal(novo.pedido1, 0); assert.equal(novo.ativoMs, 0); assert.equal(novo.inicio, C.CICLO_MS);
  assert.equal(C.normalizar({ ...e, inicio: 5000 }, 1000).inicio, 1000, 'início no futuro é descartado');
  assert.equal(C.normalizar(null, 7).inicio, 7);
  assert.equal(C.normalizar({ v: 2 }, 7).ativoMs, 0);
});

test('dispensar ou clicar em apoiar encerra os pedidos do ciclo', () => {
  const e = { ...C.novo(0), ativoMs: 5 * 60e3 };
  assert.equal(C.pedidoDevido(C.dispensar(e, 1)), 0);
  assert.equal(C.pedidoDevido(C.apoiar({ ...e, ativoMs: 40 * 60e3, pedido1: 1 }, 1)), 0);
});

test('mensagem do WhatsApp é a aprovada e aponta para o domínio oficial', () => {
  const esperado = 'Estou acompanhando as eleições pelo Atlas Eleitoral! Tem mapas interativos, resultados históricos, comparador e apuração ao vivo.\n\nÉ um projeto independente e gratuito.\n\nConfira:\nhttps://www.atlaseleitoral.org';
  const href = ler('apoiar.html').match(/href="https:\/\/wa\.me\/\?text=([^"]+)"/)[1];
  assert.equal(decodeURIComponent(href), esperado);
  const js = ler('apoio.js');
  assert.ok(js.includes("const SITE = 'https://www.atlaseleitoral.org'"));
  assert.ok(js.includes('Estou acompanhando as eleições pelo Atlas Eleitoral! Tem mapas interativos, resultados históricos, comparador e apuração ao vivo.\\n\\nÉ um projeto independente e gratuito.\\n\\nConfira:\\n'));
});

test('páginas do site: metadados de compartilhamento, link de apoio e scripts', () => {
  for (const f of ['index.html', 'atlas.html', 'ao-vivo.html', 'comparar.html', 'apoiar.html']) {
    const html = ler(f);
    for (const m of ['og:title', 'og:description', 'og:url', 'og:image', 'twitter:card', 'rel="canonical"']) assert.ok(html.includes(m), `${f}: ${m}`);
    assert.ok(html.includes('https://www.atlaseleitoral.org/assets/og-atlas.jpg'), f);
    assert.ok(html.includes('href="/apoiar.html"'), `${f}: link Apoie o Atlas`);
    assert.ok(html.includes('src="apoio.js"'), `${f}: apoio.js`);
    assert.ok(html.indexOf('apoio-core.js') < html.indexOf('src="apoio.js"'), `${f}: ordem dos scripts`);
  }
  assert.ok(fs.statSync(path.join(raiz, 'assets/og-atlas.jpg')).size < 300 * 1024, 'prévia leve para o WhatsApp');
});

test('a transmissão do OBS não carrega pedidos de apoio nem o compartilhamento do site', () => {
  const html = ler('transmissao.html');
  assert.ok(!html.includes('apoio.js') && !html.includes('apoio-core.js') && !html.includes('apoio.css'));
});
