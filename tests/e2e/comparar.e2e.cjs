// Verificação de ponta a ponta do comparador (Playwright + Chrome). Fora do `npm test`.
//   npm i --no-save playwright-core
//   PORT=3107 node scripts/dev-server.cjs &
//   node tests/e2e/comparar.e2e.cjs http://127.0.0.1:3107 ./capturas
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const C = require('../../comparar-core.js');

const BASE = process.argv[2] || 'http://127.0.0.1:3107';
const SAIDA = path.resolve(process.argv[3] || 'capturas');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dados = id => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'dados', 'historico', `presidente-${id}.json`), 'utf8'));
fs.mkdirSync(SAIDA, { recursive: true });

async function main() {
  const navegador = await chromium.launch({ executablePath: CHROME, headless: true });
  const erros = [], externas = [];
  const passo = (nome, fn) => fn().then(() => console.log('✔', nome)).catch(e => { console.log('✖', nome, '\n  ', e.message); process.exitCode = 1; });
  const nova = async (viewport, extra = {}) => {
    const p = await (await navegador.newContext({ viewport, ...extra })).newPage();
    p.on('response', r => { if (r.status() >= 400) erros.push('HTTP ' + r.status() + ' ' + r.url()); });
    p.on('pageerror', e => erros.push(e.message));
    p.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });
    p.on('request', r => { const u = new URL(r.url()); if (u.origin !== new URL(BASE).origin) externas.push(r.url()); });
    return p;
  };
  const p = await nova({ width: 1440, height: 1000 });
  await p.goto(BASE + '/comparar.html');
  await p.waitForSelector('#mapa-a path.cmp-uf');
  await p.waitForTimeout(600);

  await passo('padrão: 2022 · 1º turno × 2026 · 1º turno, Brasil, valores iguais aos arquivos oficiais', async () => {
    const tela = await p.evaluate(() => ({ titA: document.getElementById('tit-a').textContent, titB: document.getElementById('tit-b').textContent, tabela: document.getElementById('tabela').innerText, comuns: document.getElementById('comuns').innerText, ufs: document.querySelectorAll('#mapa-a path.cmp-uf').length }));
    assert.equal(tela.titA, '2022 · 1º turno'); assert.equal(tela.titB, '2026 · 1º turno'); assert.equal(tela.ufs, 27);
    const ra = C.resumir(dados('2022-1'), 'BR'), rb = C.resumir(dados('2026-1'), 'BR'), cmp = C.comparar(ra, rb);
    assert.ok(tela.tabela.includes(C.fmtPct(ra.participacao.comparecimento.pct)));
    assert.ok(tela.tabela.includes(C.fmtPct(rb.participacao.brancos.pct)));
    assert.ok(tela.tabela.includes(C.fmtPp(cmp.participacao[0].deltaPp)));
    assert.match(tela.comuns, /LULA/); assert.ok(tela.comuns.includes(C.fmtInt(rb.candidatos.find(c => c.nome === 'LULA').votos)));
    await p.screenshot({ path: path.join(SAIDA, 'comparar-desktop.png'), fullPage: true });
  });

  await passo('clique no estado sincroniza os dois mapas e o recorte', async () => {
    await p.click('#mapa-a path[data-uf="BA"]');
    await p.waitForTimeout(300);
    const s = await p.evaluate(() => ({ selA: document.querySelector('#mapa-a .sel')?.dataset.uf, selB: document.querySelector('#mapa-b .sel')?.dataset.uf, recorte: document.getElementById('recorte').value, sub: document.getElementById('sub-b').textContent, url: location.search, tabela: document.getElementById('tabela').innerText }));
    assert.equal(s.selA, 'BA'); assert.equal(s.selB, 'BA'); assert.equal(s.recorte, 'BA');
    assert.match(s.sub, /Bahia/); assert.match(s.url, /uf=BA/);
    assert.ok(s.tabela.includes(C.fmtInt(C.resumir(dados('2026-1'), 'BA').participacao.aptos)));
    await p.screenshot({ path: path.join(SAIDA, 'comparar-bahia.png') });
    await p.click('#voltar-br');
    assert.equal(await p.$eval('#recorte', e => e.value), 'BR');
  });

  await passo('turnos diferentes: lado a lado, sem diferenças calculadas', async () => {
    await p.click('#cen-b [data-id="2022-2"]');
    await p.waitForTimeout(300);
    const s = await p.evaluate(() => ({ aviso: document.getElementById('aviso-turno').hidden ? '' : document.getElementById('aviso-turno').textContent, deltas: [...document.querySelectorAll('#tabela .cmp-delta, #comuns .cmp-delta')].map(e => e.textContent.trim()) }));
    assert.match(s.aviso, /turnos diferentes/);
    assert.ok(s.deltas.every(d => d.startsWith('—')), 'nenhuma diferença entre turnos diferentes: ' + s.deltas.join('|'));
  });

  await passo('todos os cenários e os 28 recortes renderizam sem erro', async () => {
    for (const a of C.CENARIOS) for (const b of C.CENARIOS) {
      await p.goto(`${BASE}/comparar.html?a=${a.id}&b=${b.id}&uf=SP`);
      await p.waitForFunction(() => document.getElementById('tabela').innerText.length > 50);
    }
    await p.goto(`${BASE}/comparar.html?a=2018-1&b=2022-1&uf=BR`);
    await p.waitForSelector('#mapa-a path.cmp-uf');
    for (const uf of ['BR', ...C.UFS]) {
      await p.selectOption('#recorte', uf);
      await p.waitForFunction(u => document.getElementById('sub-a').textContent.startsWith(u), C.NOMES[uf]);
      const comp = await p.$eval('#tabela', e => e.innerText);
      assert.ok(comp.includes(C.fmtPct(C.resumir(dados('2022-1'), uf).participacao.abstencao.pct)), uf);
    }
  });

  await passo('mesma pessoa com número e partido diferentes (Bolsonaro 2018 → 2022)', async () => {
    await p.goto(`${BASE}/comparar.html?a=2018-2&b=2022-2&uf=BR`);
    await p.waitForFunction(() => document.getElementById('comuns').innerText.includes('BOLSONARO'));
    const t = await p.$eval('#comuns', e => e.innerText);
    assert.match(t, /PSL 17 → PL 22/); assert.doesNotMatch(t, /HADDAD|LULA/, 'pessoas diferentes não são pareadas');
  });

  await passo('celular: layout empilhado, sem rolagem horizontal, toque no mapa', async () => {
    const m = await nova({ width: 390, height: 844 }, { isMobile: true, hasTouch: true });
    await m.goto(BASE + '/comparar.html');
    await m.waitForSelector('#mapa-b path.cmp-uf');
    await m.tap('#mapa-b path[data-uf="RS"]');
    await m.waitForTimeout(300);
    const s = await m.evaluate(() => ({ largura: document.documentElement.scrollWidth, recorte: document.getElementById('recorte').value }));
    assert.equal(s.largura, 390); assert.equal(s.recorte, 'RS');
    await m.screenshot({ path: path.join(SAIDA, 'comparar-celular.png'), fullPage: true });
  });

  await passo('nenhuma consulta ao TSE nem a outros domínios', async () => { assert.deepEqual(externas, []); });
  await passo('nenhum erro de JavaScript', async () => { assert.deepEqual(erros, []); });
  await navegador.close();
}
main().catch(e => { console.error(e); process.exit(1); });
