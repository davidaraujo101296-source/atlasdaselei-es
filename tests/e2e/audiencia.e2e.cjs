// Verificação do contador de audiência no navegador (Playwright + Chrome). Fora do `npm test`.
// /api/audiencia é interceptada com respostas simuladas; nenhum serviço real é usado.
//   node tests/e2e/audiencia.e2e.cjs http://127.0.0.1:3107 ./capturas
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:3107';
const SAIDA = path.resolve(process.argv[3] || 'capturas');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync(SAIDA, { recursive: true });

const METRICAS = { ok: true, disponivel: true, coleta: true, passo: 0, amostra: 1, intervaloS: 180, janelaS: 420, estimativa: false, online: 1234, unicosHoje: 5678, visualizacoesHoje: 9876, picoHoje: 2345, tempoHorasHoje: 321.5 };

async function main() {
  const navegador = await chromium.launch({ executablePath: CHROME, headless: true });
  const erros = [];
  const passo = (nome, fn) => fn().then(() => console.log('✔', nome)).catch(e => { console.log('✖', nome, '\n  ', e.message); process.exitCode = 1; });
  async function contexto(resposta, viewport = { width: 1440, height: 900 }) {
    const ctx = await navegador.newContext({ viewport });
    const sinais = [];
    await ctx.route('**/api/audiencia', rota => {
      const req = rota.request();
      if (req.method() === 'POST') { sinais.push(JSON.parse(req.postData())); return rota.fulfill({ status: 204 }); }
      if (resposta === 'falha') return rota.abort('failed');
      return rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resposta) });
    });
    // Apuração e mapa não são o foco aqui: respostas pré-apuração simuladas.
    await ctx.route('**/api/apuracao**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, source: 'TSE', stage: 'waiting', candidates: [], sections: { counted: 0, total: 0, percentage: 0 }, votes: {} }) }));
    await ctx.route('**/api/mapa', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, source: 'TSE', stage: 'scheduled', states: [] }) }));
    return { ctx, sinais };
  }
  const abrir = async (ctx, url) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => erros.push(url + ': ' + e.message));
    await p.clock.install({ time: new Date('2026-10-25T20:00:00-03:00') });
    await p.goto(BASE + url);
    await p.waitForSelector('.audiencia span');
    return p;
  };

  await passo('serviço não configurado: "Estatísticas indisponíveis", sem números', async () => {
    const { ctx, sinais } = await contexto({ ok: true, disponivel: false, motivo: 'desativado' });
    const p = await abrir(ctx, '/');
    const t = await p.$eval('.audiencia', e => e.innerText);
    assert.equal(t.trim(), 'Estatísticas indisponíveis'); assert.doesNotMatch(t, /\d/); assert.equal(sinais.length, 0);
    await ctx.close();
  });

  await passo('falha de rede na leitura: indisponível, nunca zero', async () => {
    const { ctx } = await contexto('falha');
    const p = await abrir(ctx, '/ao-vivo.html');
    assert.equal((await p.$eval('.audiencia', e => e.innerText)).trim(), 'Estatísticas indisponíveis');
    await ctx.close();
  });

  await passo('métricas reais: painel discreto com definições; uma visualização por página', async () => {
    const { ctx, sinais } = await contexto(METRICAS);
    const p = await abrir(ctx, '/');
    await p.waitForTimeout(400);
    const s = await p.$eval('.audiencia', e => ({ texto: e.innerText, titulo: e.title }));
    assert.match(s.texto, /1\.234\s+online agora/); assert.match(s.texto, /5\.678\s+visitantes hoje/); assert.match(s.texto, /9\.876\s+visualizações/);
    assert.match(s.texto, /pico\s+2\.345/); assert.doesNotMatch(s.texto, /≈/);
    assert.match(s.titulo, /Online: navegadores com página aberta e visível nos últimos 7 minutos/);
    assert.deepEqual(sinais.map(x => x.tipo), ['pv']);
    await p.screenshot({ path: path.join(SAIDA, 'audiencia-desktop.png'), clip: { x: 0, y: 0, width: 1440, height: 160 } });
    await ctx.close();
  });

  await passo('estimativa por amostragem aparece com "≈"', async () => {
    const { ctx } = await contexto({ ...METRICAS, estimativa: true, passo: 1, amostra: 0.25 });
    const p = await abrir(ctx, '/');
    assert.match(await p.$eval('.audiencia', e => e.innerText), /≈ 1\.234/);
    await ctx.close();
  });

  await passo('várias abas do mesmo navegador: só uma envia presença', async () => {
    const { ctx, sinais } = await contexto(METRICAS);
    const a = await abrir(ctx, '/'), b = await abrir(ctx, '/atlas.html');
    // O relógio simulado é do contexto (compartilhado pelas abas): 4 × 180 s = 720 s.
    for (let i = 0; i < 4; i++) { await a.clock.runFor(180000); await a.waitForTimeout(80); }
    const hb = sinais.filter(x => x.tipo === 'hb'), pv = sinais.filter(x => x.tipo === 'pv');
    assert.equal(pv.length, 2, 'cada página carregada é uma visualização');
    // Uma aba: ~1 sinal a cada 180 s (≈4). Duas abas enviando dariam ≈8.
    assert.ok(hb.length >= 3 && hb.length <= 5, 'presença enviada por uma aba só: ' + hb.length);
    assert.equal(new Set(sinais.map(x => x.vid)).size, 1, 'mesmo identificador anônimo nas duas abas');
    await ctx.close();
  });

  await passo('coleta desligada pelo servidor: nenhuma escrita, números continuam visíveis', async () => {
    const { ctx, sinais } = await contexto({ ...METRICAS, coleta: false });
    const p = await abrir(ctx, '/');
    await p.clock.runFor(600000);
    assert.equal(sinais.length, 0); assert.match(await p.$eval('.audiencia', e => e.innerText), /online agora/);
    await ctx.close();
  });

  await passo('celular: painel compacto, sem rolagem horizontal, apuração intacta', async () => {
    const { ctx } = await contexto(METRICAS, { width: 390, height: 844 });
    const p = await abrir(ctx, '/ao-vivo.html');
    const s = await p.evaluate(() => ({ largura: document.documentElement.scrollWidth, visiveis: [...document.querySelectorAll('.audiencia > span')].filter(e => getComputedStyle(e).display !== 'none').length, placar: !!document.getElementById('candidates') }));
    assert.equal(s.largura, 390); assert.equal(s.visiveis, 2); assert.ok(s.placar);
    await p.screenshot({ path: path.join(SAIDA, 'audiencia-celular.png'), clip: { x: 0, y: 0, width: 390, height: 220 } });
    await ctx.close();
  });

  await passo('nenhum erro de JavaScript', async () => { assert.deepEqual(erros, []); });
  await navegador.close();
}
main().catch(e => { console.error(e); process.exit(1); });
