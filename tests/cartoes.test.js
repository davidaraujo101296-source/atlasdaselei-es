'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../transmissao-cartoes.js');
const P = require('../pix.js');
const raiz = path.join(__dirname, '..');
const ler = f => fs.readFileSync(path.join(raiz, f), 'utf8');
const ms = (min, s = 0) => (min * 60 + s) * 1000;

test('ciclo de 11 min: fases exatas nos pontos de virada', () => {
  const casos = [
    [ms(0), null], [ms(7, 59), null], [ms(8), 'doacao'], [ms(9, 59), 'doacao'],
    [ms(10), null], [ms(10, 29), null], [ms(10, 30), 'compartilhar'], [ms(10, 59), 'compartilhar'], [ms(11), null],
  ];
  for (const [t, tipo] of casos) assert.equal(K.situacao(t).tipo, tipo, `${t / 1000}s`);
  assert.equal(K.situacao(ms(7, 59) + 999).tipo, null, '07:59.999 ainda sem card');
  assert.equal(K.situacao(ms(10, 59) + 999).tipo, 'compartilhar');
  assert.equal(K.situacao(ms(11)).ciclo, 1, '11:00 começa o ciclo 2');
  assert.equal(K.CICLO_MS, 660000);
});

test('primeiro ciclo: Doação 01 e Compartilhamento 01; segundo ciclo: 02 e 02', () => {
  assert.equal(K.situacao(ms(8)).mensagem.id, 'doacao-01');
  assert.equal(K.situacao(ms(10, 30)).mensagem.id, 'compartilhar-01');
  assert.equal(K.situacao(ms(19)).mensagem.id, 'doacao-02', '19:00');
  assert.equal(K.situacao(ms(21, 30)).mensagem.id, 'compartilhar-02', '21:30');
});

test('duração dos cards: doação 120 s, intervalo 30 s, compartilhamento 30 s', () => {
  const tipos = [];
  for (let t = 0; t < 660000; t += 1000) tipos.push(K.situacao(t).tipo);
  assert.equal(tipos.filter(x => x === 'doacao').length, 120);
  assert.equal(tipos.filter(x => x === 'compartilhar').length, 30);
  assert.equal(tipos.filter(x => x === null).length, 510);
  assert.equal(tipos.slice(600, 630).every(x => x === null), true, '30 s sem card entre os dois');
});

test('20 ciclos (220 min) mostram as 20 mensagens de cada tipo e depois recomeçam', () => {
  const doacoes = [], comps = [];
  for (let c = 0; c < 40; c++) { doacoes.push(K.situacao(c * 660000 + ms(9)).mensagem.id); comps.push(K.situacao(c * 660000 + ms(10, 45)).mensagem.id); }
  for (const seq of [doacoes, comps]) {
    assert.equal(new Set(seq.slice(0, 20)).size, 20, 'as 20 antes de repetir');
    assert.deepEqual(seq.slice(20), seq.slice(0, 20), 'recomeça na mesma ordem');
  }
  assert.equal(doacoes[20], 'doacao-01'); assert.equal(20 * 11, 220);
});

test('relógio irregular (atrasos de renderização) não sobrepõe nem pula cards', () => {
  // Amostras em instantes irregulares durante 8 h: nunca dois tipos ao mesmo tempo, e a
  // mensagem de cada card depende só do ciclo.
  let t = 0, anterior = null, trocas = 0;
  while (t < 8 * 3600e3) {
    const s = K.situacao(t);
    if (s.tipo) assert.equal(s.mensagem.id.startsWith(s.tipo === 'doacao' ? 'doacao' : 'compartilhar'), true);
    if (s.tipo === 'doacao') assert.equal(s.mensagem.id, 'doacao-' + String((Math.floor(t / 660000) % 20) + 1).padStart(2, '0'));
    if (anterior && s.chave !== anterior.chave) trocas++;
    anterior = s;
    t += 137 + ((t * 7919) % 2400); // passos de 0,1 s a 2,5 s
  }
  const ciclos = Math.floor(8 * 3600e3 / 660000);
  assert.ok(trocas >= ciclos * 4 - 1 && trocas <= ciclos * 4 + 4, 'quatro trocas por ciclo: ' + trocas);
});

test('as 40 mensagens aprovadas, sem repetição, com título e texto', () => {
  assert.equal(K.DOACOES.length, 20); assert.equal(K.COMPARTILHAMENTOS.length, 20);
  assert.equal(K.DOACOES[0].titulo, 'Esse mapa tem história. E muitas horas de trabalho.');
  assert.equal(K.DOACOES[14].titulo, 'Esse QR Code não elege ninguém!');
  assert.equal(K.DOACOES[19].texto, 'E se puder ajudar esse projeto a continuar, obrigado de coração.');
  assert.equal(K.COMPARTILHAMENTOS[0].titulo, 'Informação boa merece circular!');
  assert.equal(K.COMPARTILHAMENTOS[19].texto, 'Convide mais alguém a conhecer o Atlas Eleitoral!');
  for (const lista of [K.DOACOES, K.COMPARTILHAMENTOS]) {
    assert.equal(new Set(lista.map(m => m.titulo)).size, 20);
    for (const m of lista) assert.ok(m.titulo.length > 10 && m.texto.length > 20, m.id);
  }
});

test('card de doação usa o QR Pix validado; card de compartilhamento usa o QR do site', () => {
  const d = K.html(K.situacao(ms(8)));
  assert.ok(d.includes('assets/pix-qr.svg') && !d.includes('site-qr.svg'));
  assert.ok(d.includes('Contribuição voluntária') && d.includes(P.CHAVE));
  const c = K.html(K.situacao(ms(10, 30)));
  assert.ok(c.includes('assets/site-qr.svg') && !c.includes('pix-qr.svg'));
  assert.ok(c.includes('www.atlaseleitoral.org'));
  assert.equal(P.ler(P.CODIGO).ok, true);
  assert.match(ler('assets/pix-qr.svg'), /^<svg/);
  assert.match(ler('assets/site-qr.svg'), /^<svg/);
});

test('domínio exibido na transmissão é www.atlaseleitoral.org; a API técnica não muda', () => {
  const html = ler('transmissao.html');
  assert.ok(html.includes('<strong class="endereco">www.atlaseleitoral.org</strong>'));
  assert.ok(!html.includes('atlasdaselei-es.vercel.app'), 'nenhum endereço antigo visível');
  assert.ok(html.indexOf('transmissao-cartoes.js') < html.indexOf('transmissao.js"'), 'cards carregam antes da página');
  assert.match(ler('transmissao.js'), /const API = 'https:\/\/atlasdaselei-es\.vercel\.app';/);
  assert.ok(!html.includes('apoio.js'), 'sem pedidos de apoio do site na transmissão');
});
