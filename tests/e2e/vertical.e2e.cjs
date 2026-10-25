// Verificação de ponta a ponta da transmissão vertical (1080x1920, relógio simulado).
// Fora do `npm test`. As APIs públicas são respondidas por dados simulados no formato das
// APIs do Atlas (nenhuma consulta ao TSE nem à produção).
//   npm i --no-save playwright-core            (opcional p/ ler os QR: pngjs jsqr)
//   PORT=3110 node scripts/dev-server.cjs &
//   node tests/e2e/vertical.e2e.cjs http://127.0.0.1:3110 ./capturas
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const C = require('../../transmissao-core.js');
const P = require('../../pix.js');
let PNG = null, jsQR = null;
try { PNG = require(process.env.PNGJS || 'pngjs').PNG; jsQR = require(process.env.JSQR || 'jsqr'); } catch (e) { /* leitura dos QR opcional */ }

const BASE = process.argv[2] || 'http://127.0.0.1:3110';
const SAIDA = path.resolve(process.argv[3] || 'capturas');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const API_NACIONAL = 'https://atlasdaselei-es.vercel.app/api/apuracao?cargo=presidente&uf=BR';
const API_MAPA = 'https://atlasdaselei-es.vercel.app/api/mapa';
const MIN = 60e3;
fs.mkdirSync(SAIDA, { recursive: true });

// ---------- respostas simuladas no formato das APIs do Atlas ----------
const CANDS = [{ number: '13', name: 'LULA', party: 'PT' }, { number: '22', name: 'FLAVIO BOLSONARO', party: 'PL' }];
function cands(a, b) {
  const v = a + b;
  return [{ ...CANDS[0], votes: a }, { ...CANDS[1], votes: b }]
    .map(c => ({ ...c, percentage: v ? Math.round((c.votes / v) * 10000) / 100 : 0, elected: false, status: '' }))
    .sort((x, y) => y.votes - x.votes);
}
function nacional({ stage = 'counting', counted = 0, a = 0, b = 0, publishedAt = '2026-10-25T18:00:00-03:00', stale = false } = {}) {
  const valid = a + b, total = Math.round(valid / 0.95), blank = Math.round(total * 0.018), nul = total - valid - blank;
  const pct = n => (total ? Math.round((n / total) * 10000) / 100 : 0);
  return {
    ok: true, source: 'TSE', election: '2026-2', office: 'presidente', uf: 'BR', stage, publishedAt, fetchedAt: new Date().toISOString(),
    sections: { counted, total: 499248, percentage: Math.round((counted / 499248) * 10000) / 100 },
    votes: { total, valid, blank, null: nul, validPercentage: pct(valid), blankPercentage: pct(blank), nullPercentage: pct(nul) },
    candidates: cands(a, b), ...(stale ? { stale: true } : {}),
  };
}
const estadoUF = (uf, counted, a, b, publishedAt = '2026-10-25T18:00:00-03:00') => ({ uf, stage: 'counting', sections: { counted, total: 20000, percentage: Math.round((counted / 20000) * 10000) / 100 }, candidates: cands(a, b), publishedAt });
function mapa(mod = {}) {
  const states = C.UFS.map((uf, i) => mod[uf] || estadoUF(uf, 4000 + i * 100, 100000 + i * 3000, 120000 - i * 2500));
  return { ok: true, source: 'TSE', stage: 'counting', states, fetchedAt: new Date().toISOString(), errors: 0 };
}

async function main() {
  const navegador = await chromium.launch({ executablePath: CHROME, headless: true });
  const erros = [], requisicoes = [];
  const passo = (nome, fn) => fn().then(() => console.log('✔', nome)).catch(e => { console.log('✖', nome, '\n  ', e.message); process.exitCode = 1; });
  async function abrir(url, { inicio = '2026-10-25T16:58:00-03:00', api = null } = {}) {
    const ctx = await navegador.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    await ctx.clock.install({ time: new Date(inicio) });
    await ctx.route('**/*', rota => {
      const u = rota.request().url();
      if (u.includes('/api/')) {
        requisicoes.push(u);
        if (!api || api.falhar) return rota.abort('internetdisconnected');
        const corpo = u === API_NACIONAL ? api.nacional : u === API_MAPA ? api.mapa : null;
        if (!corpo) return rota.fulfill({ status: 404, body: 'URL não canônica: ' + u });
        return rota.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(corpo) });
      }
      if (new URL(u).origin !== new URL(BASE).origin) return rota.abort();
      return rota.continue();
    });
    const p = await ctx.newPage();
    p.on('pageerror', e => erros.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::|ERR_INTERNET_DISCONNECTED/.test(m.text())) erros.push(m.text()); });
    await p.goto(BASE + url);
    await p.waitForFunction(() => window.__transmissao && document.querySelector('#camera path'));
    return { ctx, p };
  }
  const avancar = async (p, ms) => { for (let t = 0; t < ms; t += 1000) { await p.clock.runFor(Math.min(1000, ms - t)); await p.waitForTimeout(12); } };
  const caixa = (p, sel) => p.evaluate(s => { const el = document.querySelector(s); if (!el || el.hidden) return null; const r = el.getBoundingClientRect(); return r.width && r.height ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; }, sel);
  const cruza = (a, b) => a && b && a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
  const ler = p => p.evaluate(() => ({ cena: { ...window.__transmissao.cena }, card: window.__transmissao.cartoes, h1: (document.querySelector('#placar h1') || {}).textContent || '', placar: document.getElementById('placar').innerText, aviso: document.getElementById('aviso').hidden ? '' : document.getElementById('aviso').textContent }));
  // Dados essenciais dentro da área segura das plataformas (topo 190 px, base a partir de 1500 px, laterais 64 px).
  async function areaSegura(p, rotulo) {
    for (const sel of ['#placar h1', '.cands', '#mapa', '.secoes', '.topo', '.cartao.visivel']) {
      const b = await caixa(p, sel);
      if (!b) continue;
      assert.ok(b.y >= 190 && b.y + b.h <= 1500 && b.x >= 63 && b.x + b.w <= 1017, `${rotulo}: ${sel} fora da área segura ${JSON.stringify(b)}`);
    }
  }
  async function semSobreposicao(p, rotulo) {
    // Pior caso: nota de UFs sem atualização visível junto com o card.
    await p.evaluate(() => { const n = document.getElementById('mapa-nota'); n.hidden = false; n.textContent = '3 UF(s) sem atualização na última consulta: AC, AM, AP. Exibindo os últimos dados recebidos.'; });
    const card = await caixa(p, '.cartao.visivel');
    assert.ok(card, rotulo + ': card visível');
    for (const sel of ['#mapa', '.cands', '.secoes', '.outros', '#placar h1', '.topo', '.rodape', '#aviso', '#mapa-nota', '#demo-faixa', '#legenda']) assert.ok(!cruza(card, await caixa(p, sel)), `${rotulo}: card cobre ${sel}`);
    assert.ok(await p.$eval('.cartao', el => el.scrollHeight <= el.clientHeight + 1), rotulo + ': texto cabe no card');
  }
  async function lerQR(p, esperado) {
    if (!PNG || !jsQR) return;
    const png = PNG.sync.read(await p.locator('.cartao-qr img').screenshot());
    const r = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    assert.equal(r && r.data, esperado, 'QR lido na tela');
  }
  const assentar = async p => { await p.clock.runFor(600); await p.waitForTimeout(2000); };

  await passo('1–2. 1080x1920, espera antes das 17h sem números e área segura', async () => {
    const api = { nacional: nacional({ stage: 'waiting' }), mapa: { ok: true, source: 'TSE', stage: 'scheduled', states: [], errors: 0 } };
    const { ctx, p } = await abrir('/transmissao-vertical.html', { api });
    await avancar(p, 3000);
    const tela = await caixa(p, '#tela');
    assert.deepEqual([tela.w, tela.h], [1080, 1920]);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= 1080 && document.documentElement.scrollHeight <= 1920), 'sem rolagem');
    const e = await ler(p);
    assert.equal(e.cena.tipo, 'pre');
    assert.ok(e.placar.includes('Aguardando divulgação oficial') && /Divulgação a partir das 17h/.test(e.placar));
    assert.ok(!/\d+,\d+%/.test(e.placar), 'nenhum percentual antes da divulgação');
    assert.equal(await p.$eval('#status-texto', el => el.textContent), 'Aguardando divulgação oficial');
    assert.equal(await p.$eval('#guias', el => el.hidden), true, 'guias de teste ocultas por padrão');
    await areaSegura(p, 'espera');
    await p.screenshot({ path: path.join(SAIDA, 'vertical-1-espera.png') });
    await ctx.close();
  });

  await passo('3–8. resultados simulados: Brasil → estado com zoom → Brasil, parcial e rotação; placar sempre do recorte do mapa', async () => {
    const api = { nacional: nacional({ stage: 'waiting' }), mapa: { ok: true, source: 'TSE', stage: 'scheduled', states: [], errors: 0 } };
    const { ctx, p } = await abrir('/transmissao-vertical.html', { api, inicio: '2026-10-25T17:59:30-03:00' });
    await avancar(p, 2000);
    api.nacional = nacional({ counted: 120000, a: 30000000, b: 28000000 });
    api.mapa = mapa();
    await avancar(p, 35000);
    let e = await ler(p);
    const vistos = new Set();
    let zoomOk = 0, nacionais = 0;
    for (let i = 0; i < 120; i++) {
      e = await ler(p);
      if (e.cena.tipo === 'nacional') { nacionais++; assert.ok(e.h1.startsWith('Brasil'), 'placar nacional com Brasil'); assert.equal((await p.$eval('#camera', el => el.style.transform)).replace(/\s/g, ''), 'translate(0px,0px)scale(1)'); }
      if (e.cena.tipo === 'estado' || e.cena.tipo === 'parcial') {
        vistos.add(e.cena.uf);
        assert.ok(e.h1.startsWith(C.NOMES[e.cena.uf]), `placar do estado ${e.cena.uf}: ${e.h1}`);
        if (/scale\((?!1\))/.test(await p.$eval('#camera', el => el.style.transform))) zoomOk++;
      }
      await avancar(p, 1000);
    }
    assert.ok(nacionais > 0 && zoomOk > 0, 'cenas nacional e de estado com zoom');
    assert.ok(vistos.size >= 3, 'rotação entre vários estados: ' + [...vistos]);
    await p.screenshot({ path: path.join(SAIDA, 'vertical-3-apuracao.png') });
    // Nova parcial de verdade: avanço de seções em uma UF.
    api.mapa = mapa({ BA: estadoUF('BA', 15000, 2500000, 2000000, '2026-10-25T18:10:00-03:00') });
    let parcial = null;
    for (let i = 0; i < 150 && !parcial; i++) { await avancar(p, 1000); e = await ler(p); if (e.cena.tipo === 'parcial' && e.cena.uf === 'BA') parcial = e; }
    assert.ok(parcial, 'nova parcial da BA exibida');
    assert.ok(parcial.h1.startsWith('Bahia') && /Nova parcial/i.test(parcial.placar), 'selo de nova parcial com o estado');
    await p.waitForTimeout(1500);
    await areaSegura(p, 'parcial');
    await p.screenshot({ path: path.join(SAIDA, 'vertical-7-parcial.png') });
    await ctx.close();
  });

  await passo('9–10. falha de rede e dados desatualizados: aviso visível sem cobrir o recorte', async () => {
    const api = { nacional: nacional({ counted: 200000, a: 40000000, b: 39000000 }), mapa: mapa() };
    const { ctx, p } = await abrir('/transmissao-vertical.html', { api, inicio: '2026-10-25T18:30:00-03:00' });
    await avancar(p, 8000);
    api.falhar = true;
    await avancar(p, 40000);
    let e = await ler(p);
    assert.ok(/Dados desatualizados/.test(e.aviso), 'aviso de conexão instável');
    await p.waitForTimeout(900);
    assert.ok(!cruza(await caixa(p, '#aviso'), await caixa(p, '#placar h1')), 'aviso não cobre o nome do recorte');
    assert.ok(!cruza(await caixa(p, '#aviso'), await caixa(p, '.cands')), 'aviso não cobre os percentuais');
    assert.ok(/\d+,\d+%/.test(e.placar), 'últimos resultados válidos mantidos');
    await p.screenshot({ path: path.join(SAIDA, 'vertical-9-falha.png') });
    api.falhar = false;
    api.nacional = nacional({ counted: 200000, a: 40000000, b: 39000000, stale: true });
    await avancar(p, 70000);
    e = await ler(p);
    assert.ok(/fonte oficial temporariamente indisponível/.test(e.aviso), 'aviso de dados antigos da fonte: ' + e.aviso);
    await ctx.close();
  });

  await passo('11–15. cards: ciclo de 11 min, doação, compartilhamento, 20 ciclos, QR e sem sobreposição', async () => {
    const api = { nacional: nacional({ counted: 250000, a: 50000000, b: 48000000 }), mapa: mapa() };
    const { ctx, p } = await abrir('/transmissao-vertical.html', { api, inicio: '2026-10-25T19:00:00-03:00' });
    const inicio = await p.evaluate(() => Number(localStorage.getItem('atlas-transmissao-cartoes-inicio')));
    const ir = async (min, seg) => { const alvo = inicio + (min * 60 + seg) * 1000 + 100; const agora = await p.evaluate(() => Date.now()); if (alvo > agora) await p.clock.fastForward(alvo - agora); await p.clock.runFor(500); return (await ler(p)).card; };
    for (const [m, s, tipo, id] of [[0, 1, null], [7, 59, null], [8, 0, 'doacao', 'doacao-01'], [9, 59, 'doacao'], [10, 0, null], [10, 29, null], [10, 30, 'compartilhar', 'compartilhar-01'], [10, 59, 'compartilhar'], [11, 0, null], [19, 0, 'doacao', 'doacao-02'], [21, 30, 'compartilhar', 'compartilhar-02']]) {
      const c = await ir(m, s);
      assert.equal(c.tipo, tipo, `${m}:${s}`);
      if (id) assert.equal(c.mensagem.id, id, `${m}:${s} mensagem`);
    }
    for (let c = 2; c < 22; c++) {
      for (const [m, s, tipo] of [[8, 1, 'doacao'], [10, 31, 'compartilhar']]) {
        const card = await ir(c * 11 + m, s);
        assert.equal(card.tipo, tipo);
        assert.equal(card.mensagem.id, `${tipo}-${String((c % 20) + 1).padStart(2, '0')}`);
        await p.waitForTimeout(1700);
        await semSobreposicao(p, card.mensagem.id);
        await areaSegura(p, card.mensagem.id);
        if (c === 20 && tipo === 'doacao') { await lerQR(p, P.CODIGO); await p.screenshot({ path: path.join(SAIDA, 'vertical-11-doacao.png') }); }
        if (c === 20 && tipo === 'compartilhar') { await lerQR(p, 'https://www.atlaseleitoral.org'); await p.screenshot({ path: path.join(SAIDA, 'vertical-12-compartilhar.png') }); }
      }
    }
    await ctx.close();
  });

  await passo('modo demo isolado, guias só com ?guias=1 e mesmas URLs de API da horizontal', async () => {
    const { ctx, p } = await abrir('/transmissao-vertical.html?demo=1&ritmo=10&guias=1');
    assert.equal(await p.$eval('#demo-faixa', el => el.hidden), false);
    assert.equal(await p.$eval('#guias', el => el.hidden), false);
    assert.ok((await p.textContent('.rodape')).includes('dados fictícios'));
    await ctx.close();
    const usadas = [...new Set(requisicoes.map(u => u.split('?')[0]))].sort();
    assert.deepEqual(usadas, ['https://atlasdaselei-es.vercel.app/api/apuracao', 'https://atlasdaselei-es.vercel.app/api/mapa'], 'somente as APIs canônicas');
    assert.ok(requisicoes.every(u => !/[?&](t|ts|_|nocache|v)=/.test(u)), 'sem parâmetros que quebrem o cache');
  });

  await passo('ensaio de 4 h aceleradas: cenas, parciais e cards seguem; memória estável', async () => {
    const { ctx, p } = await abrir('/transmissao-vertical.html?demo=1&ritmo=10&nacional=8&estado=7&parcial=8');
    const cdp = await ctx.newCDPSession(p);
    const medir = async () => { await cdp.send('HeapProfiler.collectGarbage'); const { usedSize } = await cdp.send('Runtime.getHeapUsage'); return { heap: usedSize, nos: await p.evaluate(() => document.getElementsByTagName('*').length) }; };
    const cenas = new Set(), tipos = new Set(), cards = [];
    await p.clock.runFor(30e3);
    const amostras = [];
    for (let bloco = 0; bloco < 22; bloco++) {
      for (let t = 0; t < 11 * MIN; t += 10e3) {
        await p.clock.runFor(10e3);
        const e = await p.evaluate(() => ({ cena: window.__transmissao.cena, card: window.__transmissao.cartoes }));
        cenas.add(e.cena.id); tipos.add(e.cena.tipo);
        if (e.card && e.card.tipo && cards[cards.length - 1] !== e.card.mensagem.id) cards.push(e.card.mensagem.id);
      }
      amostras.push(await medir());
    }
    const fim = amostras[amostras.length - 1];
    console.log('   heap', Math.round(amostras[0].heap / 1024), '→', Math.round(fim.heap / 1024), 'KB; nós', amostras[0].nos, '→', fim.nos, '; cenas', cenas.size, '; cards', cards.length);
    assert.ok(tipos.has('nacional') && (tipos.has('parcial') || tipos.has('estado')) && cenas.size > 1000);
    assert.equal(cards.length, 44); assert.equal(cards[40], 'doacao-01');
    assert.ok(Math.abs(fim.nos - amostras[2].nos) <= 40, 'nós estáveis');
    assert.ok(fim.heap < amostras[2].heap * 1.5 + 2e6, 'memória sem crescimento contínuo');
    await ctx.close();
  });

  await passo('16. nenhum erro de JavaScript', async () => { assert.deepEqual(erros, []); });
  await navegador.close();
}
main().catch(e => { console.error(e); process.exitCode = 1; });
