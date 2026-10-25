// Verificação de ponta a ponta dos cards da transmissão (1920x1080, relógio simulado).
// Fora do `npm test`. As APIs públicas da Vercel são respondidas por arquivos fixos
// (nenhuma consulta real) e nenhum outro domínio é acessado.
//   npm i --no-save playwright-core            (opcional p/ ler os QR: pngjs jsqr)
//   PORT=3109 node scripts/dev-server.cjs &
//   node tests/e2e/cartoes.e2e.cjs http://127.0.0.1:3109 ./capturas
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const K = require('../../transmissao-cartoes.js');
const P = require('../../pix.js');
let PNG = null, jsQR = null;
try { PNG = require(process.env.PNGJS || 'pngjs').PNG; jsQR = require(process.env.JSQR || 'jsqr'); } catch (e) { /* leitura dos QR opcional */ }

const BASE = process.argv[2] || 'http://127.0.0.1:3109';
const SAIDA = path.resolve(process.argv[3] || 'capturas');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const T0 = new Date('2026-10-25T15:00:00-03:00');
const MIN = 60e3;
fs.mkdirSync(SAIDA, { recursive: true });
const NACIONAL = { ok: true, source: 'TSE', election: '2026-2', office: 'presidente', uf: 'BR', publishedAt: '2026-10-24T19:19:13-03:00', fetchedAt: T0.toISOString(), stage: 'waiting', sections: { counted: 0, total: 499248, percentage: 0 }, votes: { total: 0, valid: 0, blank: 0, null: 0, validPercentage: 0, blankPercentage: 0, nullPercentage: 0 }, candidates: [{ number: '13', name: 'CANDIDATO 13', party: 'P13', votes: 0, percentage: 0, elected: false, status: '' }, { number: '22', name: 'CANDIDATO 22', party: 'P22', votes: 0, percentage: 0, elected: false, status: '' }] };
const MAPA = { ok: true, source: 'TSE', stage: 'scheduled', states: [], fetchedAt: T0.toISOString(), errors: 0 };

async function main() {
  const navegador = await chromium.launch({ executablePath: CHROME, headless: true });
  const erros = [];
  const passo = (nome, fn) => fn().then(() => console.log('✔', nome)).catch(e => { console.log('✖', nome, '\n  ', e.message); process.exitCode = 1; });
  async function abrir(url, { contexto = null } = {}) {
    const ctx = contexto || await navegador.newContext({ viewport: { width: 1920, height: 1080 } });
    if (!contexto) {
      await ctx.clock.install({ time: T0 });
      await ctx.route('**/*', rota => {
        const u = new URL(rota.request().url());
        if (u.pathname === '/api/apuracao') return rota.fulfill({ json: NACIONAL });
        if (u.pathname === '/api/mapa') return rota.fulfill({ json: MAPA });
        if (u.origin !== new URL(BASE).origin) return rota.abort();
        return rota.continue();
      });
    }
    const p = await ctx.newPage();
    p.on('pageerror', e => erros.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::/.test(m.text())) erros.push(m.text()); });
    p.on('response', r => { if (r.status() >= 400) erros.push('HTTP ' + r.status() + ' ' + r.url()); });
    await p.goto(BASE + url);
    await p.waitForFunction(() => window.__transmissao && document.querySelector('#camera path'));
    return { ctx, p };
  }
  const situacao = p => p.evaluate(() => window.__transmissao.cartoes);
  const caixa = (p, sel) => p.evaluate(s => { const el = document.querySelector(s); if (!el || el.hidden) return null; const r = el.getBoundingClientRect(); return r.width && r.height ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; }, sel);
  const cruza = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const assentar = async p => { await p.clock.runFor(600); await p.waitForTimeout(2000); }; // transições CSS usam tempo real
  async function semSobreposicao(p, rotulo) {
    const card = await caixa(p, '.cartao.visivel');
    assert.ok(card, rotulo + ': card visível');
    const painel = await caixa(p, '.painel-mapa');
    assert.ok(card.x >= painel.x - 1 && card.x + card.w <= painel.x + painel.w + 1 && card.y >= painel.y + 100 && card.y + card.h <= painel.y + painel.h, rotulo + ': dentro da faixa segura');
    for (const sel of ['#mapa', '#placar', '#legenda', '.rodape', '.topo', '#aviso', '#mapa-nota', '#demo-faixa']) assert.ok(!cruza(card, await caixa(p, sel)), `${rotulo}: não cobre ${sel}`);
    assert.ok(await p.$eval('.cartao', el => el.scrollHeight <= el.clientHeight + 1 && [...el.children].every(c => c.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1)), rotulo + ': texto cabe no card');
  }
  async function lerQR(p, rotulo, esperado) {
    if (!PNG || !jsQR) return;
    const png = PNG.sync.read(await p.locator('.cartao-qr img').screenshot());
    const r = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    assert.equal(r && r.data, esperado, rotulo + ': QR lido na tela');
  }

  await passo('modo real: fases 00:00 → 11:00 e mensagens 01, sem dados fictícios', async () => {
    const { ctx, p } = await abrir('/transmissao.html');
    assert.equal((await situacao(p)).tipo, null, '00:00 sem card');
    const larguraMapa = (await caixa(p, '#mapa')).w;
    // O relógio simulado também anda durante esperas reais: avança sempre até horários
    // absolutos, contados do início do ciclo gravado pela página.
    const inicio = await p.evaluate(() => Number(localStorage.getItem('atlas-transmissao-cartoes-inicio')));
    const ir = async (min, seg) => { const alvo = inicio + (min * 60 + seg) * 1000 + 100; const agora = await p.evaluate(() => Date.now()); if (alvo > agora) await p.clock.fastForward(alvo - agora); await p.clock.runFor(500); return situacao(p); };
    assert.equal((await ir(7, 59)).tipo, null, '07:59 sem card');
    let s = await ir(8, 0);
    assert.equal(s.tipo, 'doacao', '08:00 doação'); assert.equal(s.mensagem.id, 'doacao-01');
    await assentar(p);
    assert.ok((await caixa(p, '#mapa')).w <= larguraMapa - 400, 'o mapa abre espaço para o card');
    await p.evaluate(() => { const n = document.getElementById('mapa-nota'); n.hidden = false; n.textContent = '3 UF(s) sem atualização na última consulta: AC, AM, AP. Exibindo os últimos dados recebidos. Texto longo para ocupar três linhas.'; });
    await semSobreposicao(p, 'doação 01');
    await lerQR(p, 'doação', P.CODIGO);
    const texto = await p.innerText('body'); // só o que aparece na tela
    assert.ok(texto.includes('Aguardando divulgação oficial') && !/DEMONSTRAÇÃO|fictício|simulação/i.test(texto), 'modo real sem dados fictícios');
    assert.equal(await p.$eval('#demo-faixa', el => el.hidden), true);
    await p.screenshot({ path: path.join(SAIDA, 'card-doacao-real.png') });
    assert.equal((await ir(9, 59)).tipo, 'doacao', '09:59 doação');
    assert.equal((await ir(10, 0)).tipo, null, '10:00 sem card');
    await assentar(p);
    assert.ok(Math.abs((await caixa(p, '#mapa')).w - larguraMapa) < 2, 'mapa volta ao tamanho original');
    assert.equal(await p.$eval('.cartao', el => getComputedStyle(el).opacity), '0');
    assert.equal((await ir(10, 29)).tipo, null, '10:29 sem card');
    s = await ir(10, 30);
    assert.equal(s.tipo, 'compartilhar', '10:30 compartilhamento'); assert.equal(s.mensagem.id, 'compartilhar-01');
    await assentar(p);
    await semSobreposicao(p, 'compartilhamento 01');
    await lerQR(p, 'compartilhamento', 'https://www.atlaseleitoral.org');
    await p.screenshot({ path: path.join(SAIDA, 'card-compartilhar-real.png') });
    assert.equal((await ir(10, 59)).tipo, 'compartilhar', '10:59 compartilhamento');
    s = await ir(11, 0);
    assert.equal(s.tipo, null, '11:00 sem card'); assert.equal(s.ciclo, 1, 'novo ciclo');
    assert.equal((await ir(19, 0)).mensagem.id, 'doacao-02', '19:00 Doação 02');
    assert.equal((await ir(21, 30)).mensagem.id, 'compartilhar-02', '21:30 Compartilhamento 02');
    // Recarga no meio do ciclo: a sequência continua (não volta à mensagem 01).
    await p.reload();
    await p.waitForFunction(() => window.__transmissao && window.__transmissao.cartoes);
    assert.equal((await situacao(p)).ciclo, 1, 'ciclo preservado após recarga');
    await ctx.close();
  });

  await passo('as 40 mensagens cabem na faixa segura, sem cobrir nada', async () => {
    const { ctx, p } = await abrir('/transmissao.html');
    for (let c = 0; c < 20; c++) {
      for (const [quando, tipo] of [[8 * MIN + 1000, 'doacao'], [10.5 * MIN + 1000, 'compartilhar']]) {
        const alvo = T0.getTime() + c * 11 * MIN + quando;
        await p.clock.fastForward(alvo - await p.evaluate(() => Date.now()));
        await p.clock.runFor(600);
        const s = await situacao(p);
        assert.equal(s.tipo, tipo); assert.equal(s.ciclo, c);
        await p.waitForTimeout(1700);
        await semSobreposicao(p, s.mensagem.id);
        if (c === 14 && tipo === 'doacao') await p.screenshot({ path: path.join(SAIDA, 'card-doacao-15.png') });
        if (c === 1 && tipo === 'compartilhar') await p.screenshot({ path: path.join(SAIDA, 'card-compartilhar-02.png') });
      }
    }
    await ctx.close();
  });

  await passo('?cartoes=desligado desativa os cards; demonstração não grava o ciclo do modo real', async () => {
    const { ctx, p } = await abrir('/transmissao.html?cartoes=desligado');
    assert.equal(await p.locator('.cartao').count(), 0);
    await ctx.close();
    const d = await abrir('/transmissao.html?demo=1&ritmo=10&cartoesInicio=478');
    assert.equal(await d.p.evaluate(() => localStorage.getItem('atlas-transmissao-cartoes-inicio')), null);
    await d.p.clock.runFor(3000);
    assert.equal((await situacao(d.p)).tipo, 'doacao');
    await d.ctx.close();
  });

  await passo('demonstração 4 h aceleradas: cards no ciclo, mapa e parciais seguem, memória estável', async () => {
    const { ctx, p } = await abrir('/transmissao.html?demo=1&ritmo=10&nacional=8&estado=7&parcial=8');
    const cdp = await ctx.newCDPSession(p);
    const medir = async () => { await cdp.send('HeapProfiler.collectGarbage'); const { usedSize } = await cdp.send('Runtime.getHeapUsage'); return { heap: usedSize, nos: await p.evaluate(() => document.getElementsByTagName('*').length) }; };
    const cenas = new Set(), tipos = new Set(), cardsVistos = [];
    let zoomComCard = 0, ultimaCena = null;
    await p.clock.runFor(30e3);
    const inicio = await medir();
    const amostras = [];
    for (let bloco = 0; bloco < 22; bloco++) { // 22 × 11 min = 242 min
      for (let t = 0; t < 11 * MIN; t += 10e3) {
        await p.clock.runFor(10e3);
        const e = await p.evaluate(() => ({ cena: window.__transmissao.cena, card: window.__transmissao.cartoes }));
        cenas.add(e.cena.id); tipos.add(e.cena.tipo);
        if (e.card && e.card.tipo && cardsVistos[cardsVistos.length - 1] !== e.card.mensagem.id) cardsVistos.push(e.card.mensagem.id);
        if (e.card && e.card.tipo && ultimaCena !== null && e.cena.id !== ultimaCena && (e.cena.tipo === 'estado' || e.cena.tipo === 'parcial')) zoomComCard++;
        ultimaCena = e.cena.id;
      }
      amostras.push(await medir());
    }
    const fim = amostras[amostras.length - 1];
    console.log('   heap', Math.round(inicio.heap / 1024), '→', Math.round(fim.heap / 1024), 'KB; nós', inicio.nos, '→', fim.nos, '; cenas', cenas.size, '; cards', cardsVistos.length);
    assert.ok(tipos.has('nacional') && (tipos.has('parcial') || tipos.has('estado')), 'cenas: ' + [...tipos]);
    assert.ok(cenas.size > 1000, 'o diretor continua trocando de cena: ' + cenas.size);
    assert.ok(zoomComCard > 10, 'o mapa continua aproximando estados com card na tela');
    assert.equal(cardsVistos.length, 44, '22 ciclos × 2 cards');
    assert.deepEqual(cardsVistos.slice(0, 4), ['doacao-01', 'compartilhar-01', 'doacao-02', 'compartilhar-02']);
    assert.equal(cardsVistos[40], 'doacao-01', 'recomeça após 20 ciclos');
    assert.ok(Math.abs(fim.nos - amostras[2].nos) <= 40, 'número de nós estável');
    assert.ok(fim.heap < amostras[2].heap * 1.5 + 2e6, 'memória sem crescimento contínuo');
    await p.clock.fastForward(8 * MIN); await p.clock.runFor(600); await p.waitForTimeout(1800);
    await p.screenshot({ path: path.join(SAIDA, 'card-demo-apos-4h.png') });
    await ctx.close();
  });

  await passo('nenhum erro de JavaScript', async () => { assert.deepEqual(erros, []); });
  await navegador.close();
}
main().catch(e => { console.error(e); process.exitCode = 1; });
