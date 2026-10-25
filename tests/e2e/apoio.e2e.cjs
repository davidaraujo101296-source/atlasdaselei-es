// Verificação de ponta a ponta do apoio e do compartilhamento (Playwright + Chrome, relógio
// simulado). Fora do `npm test`. As APIs de apuração são respondidas por um arquivo fixo
// (nenhuma consulta ao TSE) e pedidos a outros domínios são bloqueados.
//   npm i --no-save playwright-core
//   PORT=3108 node scripts/dev-server.cjs &
//   node tests/e2e/apoio.e2e.cjs http://127.0.0.1:3108 ./capturas
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const P = require('../../pix.js');

const BASE = process.argv[2] || 'http://127.0.0.1:3108';
const SAIDA = path.resolve(process.argv[3] || 'capturas');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SITE = 'https://www.atlaseleitoral.org';
const T0 = new Date('2026-10-25T14:00:00-03:00');
const MENSAGEM = 'Estou acompanhando as eleições pelo Atlas Eleitoral! Tem mapas interativos, resultados históricos, comparador e apuração ao vivo.\n\nÉ um projeto independente e gratuito.\n\nConfira:\n' + SITE;
fs.mkdirSync(SAIDA, { recursive: true });

const APURACAO = { ok: true, source: 'TSE', election: '2026-2', office: 'presidente', uf: 'BR', publishedAt: '2026-10-24T19:19:13-03:00', fetchedAt: T0.toISOString(), stage: 'waiting', sections: { counted: 0, total: 499248, percentage: 0 }, votes: { total: 0, valid: 0, blank: 0, null: 0, validPercentage: 0, blankPercentage: 0, nullPercentage: 0 }, candidates: [{ number: '13', name: 'CANDIDATO 13', party: 'P13', votes: 0, percentage: 0, elected: false, status: '' }, { number: '22', name: 'CANDIDATO 22', party: 'P22', votes: 0, percentage: 0, elected: false, status: '' }] };
const MAPA = { ok: true, source: 'TSE', stage: 'scheduled', states: [], fetchedAt: T0.toISOString(), errors: 0 };

async function main() {
  const navegador = await chromium.launch({ executablePath: CHROME, headless: true });
  const erros = [], bloqueadas = new Set();
  const passo = (nome, fn) => fn().then(() => console.log('✔', nome)).catch(e => { console.log('✖', nome, '\n  ', e.message); process.exitCode = 1; });
  async function contexto(viewport, { relogio = true, share = 'stub', ...extra } = {}) {
    const ctx = await navegador.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'], ...extra });
    if (relogio) await ctx.clock.install({ time: T0 });
    await ctx.route('**/*', rota => {
      const u = new URL(rota.request().url());
      if (u.origin !== new URL(BASE).origin) { bloqueadas.add(u.origin); return rota.abort(); }
      if (u.pathname === '/api/apuracao') return rota.fulfill({ json: APURACAO });
      if (u.pathname === '/api/mapa') return rota.fulfill({ json: MAPA });
      return rota.continue();
    });
    if (share === 'stub') await ctx.addInitScript(() => { window.__compartilhado = []; navigator.share = async d => { window.__compartilhado.push(d); }; });
    if (share === 'sem') await ctx.addInitScript(() => { delete Navigator.prototype.share; delete Navigator.prototype.canShare; });
    ctx.on('page', p => {
      p.on('pageerror', e => erros.push(e.message));
      p.on('response', r => { if (r.status() >= 400) erros.push('HTTP ' + r.status() + ' ' + r.url()); });
      // Recursos bloqueados (outros domínios) e 404 já aparecem pela resposta acima.
      p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::|Failed to load resource/.test(m.text())) erros.push(m.text()); });
    });
    return ctx;
  }
  const estado = p => p.evaluate(() => window.__atlasApoio.lerEstado());
  const semRolagemHorizontal = p => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const cruza = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  // ---------- página de apoio ----------
  await passo('página /apoiar.html: texto aprovado, chave, QR Pix e botões de cópia', async () => {
    const ctx = await contexto({ width: 1366, height: 900 });
    const p = await ctx.newPage();
    await p.goto(BASE + '/apoiar.html');
    assert.equal(await p.textContent('h1'), 'Oi, eu sou o David de Araújo!');
    for (const t of ['Tudo começou com uma ideia...', 'Uma ideia que não parou de crescer', 'Ainda tenho muitos planos para o Atlas!', 'Contribuição voluntária, sem valor mínimo.', 'Criador do Atlas Eleitoral', 'sem vínculo institucional com o TSE'])
      assert.ok((await p.textContent('body')).includes(t), t);
    assert.equal(await p.textContent('.apoio-chave code'), P.CHAVE);
    assert.ok(await p.$eval('.apoio-qr img', i => i.complete && i.naturalWidth > 0), 'QR carregado');
    await p.click('[data-aa-acao="copiar-codigo"]');
    await p.waitForFunction(() => document.querySelector('.apoio-pix .aa-status').textContent.includes('copiado'));
    assert.equal(await p.evaluate(() => navigator.clipboard.readText()), P.CODIGO, 'Copia e Cola = BR Code validado');
    await p.click('[data-aa-acao="copiar-chave"]');
    await p.waitForFunction(() => document.querySelector('.apoio-pix .aa-status').textContent.includes('Chave Pix copiada'));
    assert.equal(await p.evaluate(() => navigator.clipboard.readText()), P.CHAVE);
    await p.click('.apoio-partilha [data-aa-acao="compartilhar"]');
    assert.equal((await p.evaluate(() => window.__compartilhado))[0].url, SITE);
    const wa = await p.getAttribute('.apoio-partilha a[href^="https://wa.me/"]', 'href');
    assert.equal(decodeURIComponent(wa.split('text=')[1]), MENSAGEM);
    await p.clock.runFor(31 * 60e3);
    assert.equal(await p.locator('.aa-pedido').count(), 0, 'sem pedidos na própria página de apoio');
    await p.evaluate(() => { document.querySelector('.aa-status').textContent = ''; document.querySelectorAll('.aa-status').forEach(s => { s.textContent = ''; }); });
    await p.screenshot({ path: path.join(SAIDA, 'apoiar-desktop.png'), fullPage: true });
    await p.locator('#contribuir').screenshot({ path: path.join(SAIDA, 'apoiar-pix.png') });
    await ctx.close();
  });
  await passo('página /apoiar.html no celular: legível, QR visível, sem rolagem horizontal', async () => {
    const ctx = await contexto({ width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.goto(BASE + '/apoiar.html');
    assert.ok(await semRolagemHorizontal(p));
    const qr = await p.locator('.apoio-qr img').boundingBox();
    assert.ok(qr.width >= 220, 'QR com tamanho adequado: ' + qr.width);
    assert.ok(await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.apoio p')).fontSize) >= 16));
    await p.screenshot({ path: path.join(SAIDA, 'apoiar-celular.png'), fullPage: true });
    await ctx.close();
  });

  // ---------- pedidos de apoio ----------
  await passo('pedido 1 só aos 3 min; não bloqueia a página; fecha com Esc', async () => {
    const ctx = await contexto({ width: 1366, height: 900 });
    const p = await ctx.newPage();
    await p.goto(BASE + '/');
    await p.clock.runFor(178000);
    assert.equal(await p.locator('.aa-pedido').count(), 0, 'antes de 3 min');
    await p.clock.runFor(4000);
    await p.locator('.aa-pedido[data-pedido="1"].aberto').waitFor();
    assert.equal(await p.textContent('.aa-pedido h2'), 'O Atlas nasceu de uma vontade simples.');
    for (const b of ['Quero apoiar o Atlas', 'Compartilhar com alguém', 'Continuar acompanhando']) assert.ok(await p.getByText(b, { exact: true }).isVisible(), b);
    assert.equal(await p.locator('.aa-pedido img, .aa-pedido svg').count(), 0, 'sem QR no pedido');
    const mapa = await p.locator('.map-panel').boundingBox();
    const naFrente = await p.evaluate(({ x, y }) => !!document.elementFromPoint(x, y).closest('.aa-painel'), { x: mapa.x + mapa.width / 2, y: mapa.y + mapa.height / 2 });
    assert.equal(naFrente, false, 'o mapa continua acessível');
    await p.waitForTimeout(450); // fim da animação de entrada (tempo real)
    await p.screenshot({ path: path.join(SAIDA, 'pedido-1-desktop.png') });
    await p.keyboard.press('Escape');
    await p.clock.runFor(1000);
    assert.equal(await p.locator('.aa-pedido').count(), 0);
    // Persistência entre páginas: o tempo continua contando no comparador.
    await p.goto(BASE + '/comparar.html');
    const e1 = await estado(p);
    assert.ok(e1.ativoMs >= 180000 && e1.pedido1 > 0, 'estado preservado entre páginas');
    await p.clock.runFor(30 * 60e3 - e1.ativoMs - 3000);
    assert.equal(await p.locator('.aa-pedido').count(), 0, 'antes de 30 min');
    await p.clock.runFor(6000);
    await p.locator('.aa-pedido[data-pedido="2"].aberto').waitFor();
    assert.equal(await p.textContent('.aa-pedido h2'), 'Que bom ter você por aqui!');
    assert.equal(await p.locator('.aa-painel').count(), 1, 'nunca dois ao mesmo tempo');
    await p.waitForTimeout(450); // fim da animação de entrada (tempo real)
    await p.screenshot({ path: path.join(SAIDA, 'pedido-2-desktop.png') });
    await p.click('.aa-pedido [data-aa-acao="fechar"].aa-texto');
    await p.clock.runFor(2 * 3600e3);
    assert.equal(await p.locator('.aa-pedido').count(), 0, 'cada pedido uma vez no ciclo');
    // Aba oculta não conta tempo.
    const antes = (await estado(p)).ativoMs;
    await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.clock.runFor(5 * 60e3);
    assert.ok((await estado(p)).ativoMs - antes <= 1500, 'oculta: pausado');
    await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); });
    // Depois de 24 h, o ciclo recomeça e o pedido 1 pode voltar.
    await p.clock.fastForward(24 * 3600e3);
    await p.clock.runFor(185000);
    await p.locator('.aa-pedido[data-pedido="1"]').waitFor();
    await ctx.close();
  });
  await passo('várias abas abertas não contam o tempo em dobro', async () => {
    const ctx = await contexto({ width: 1200, height: 800 });
    const a = await ctx.newPage(); await a.goto(BASE + '/');
    const b = await ctx.newPage(); await b.goto(BASE + '/comparar.html');
    await a.clock.runFor(120000);
    const e = await estado(a);
    // O localStorage entre abas sincroniza com pequeno atraso: pode contar um pouco menos, nunca em dobro.
    assert.ok(e.ativoMs >= 100000 && e.ativoMs <= 125000, 'tempo ativo ≈ 2 min com duas abas (nunca 4): ' + e.ativoMs);
    await ctx.close();
  });
  await passo('"Não mostrar hoje" e "Quero apoiar" encerram os pedidos do ciclo', async () => {
    const ctx = await contexto({ width: 1366, height: 900 });
    const p = await ctx.newPage(); await p.goto(BASE + '/');
    await p.clock.runFor(182000);
    await p.click('[data-aa-acao="dispensar"]');
    await p.clock.runFor(40 * 60e3);
    assert.equal(await p.locator('.aa-pedido').count(), 0);
    assert.ok((await estado(p)).dispensado > 0);
    await ctx.close();
    const ctx2 = await contexto({ width: 1366, height: 900 });
    const q = await ctx2.newPage(); await q.goto(BASE + '/ao-vivo.html');
    await q.clock.runFor(182000);
    await Promise.all([q.waitForURL('**/apoiar.html'), q.click('.aa-pedido [data-aa-acao="apoiar"]')]);
    assert.ok((await estado(q)).apoiou > 0);
    await q.goto(BASE + '/');
    await q.clock.runFor(40 * 60e3);
    assert.equal(await q.locator('.aa-pedido').count(), 0, 'sem novo pedido ao voltar');
    await ctx2.close();
  });
  await passo('pedido no celular: painel inferior, fácil de fechar', async () => {
    const ctx = await contexto({ width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage(); await p.goto(BASE + '/');
    await p.clock.runFor(182000);
    await p.locator('.aa-pedido.aberto').waitFor();
    const caixa = await p.locator('.aa-pedido').boundingBox();
    assert.ok(caixa.x >= 10 && caixa.x + caixa.width <= 380, 'dentro da tela');
    const fechar = await p.locator('.aa-pedido .aa-fechar').boundingBox();
    assert.ok(fechar.width >= 40 && fechar.height >= 40, 'botão de fechar com área de toque');
    await p.waitForTimeout(450); // fim da animação de entrada (tempo real)
    await p.screenshot({ path: path.join(SAIDA, 'pedido-1-celular.png') });
    await p.tap('.aa-pedido .aa-fechar');
    await p.clock.runFor(1000);
    assert.equal(await p.locator('.aa-pedido').count(), 0);
    await ctx.close();
  });

  // ---------- compartilhamento ----------
  await passo('card de compartilhamento perto dos resultados, sem sobrepor mapa nem placar', async () => {
    const ctx = await contexto({ width: 1440, height: 1000 });
    const p = await ctx.newPage();
    for (const [pagina, painel] of [['/', '.map-panel'], ['/atlas.html', '.map-panel'], ['/ao-vivo.html', '.map-box'], ['/comparar.html', '.cmp-mapas']]) {
      await p.goto(BASE + pagina);
      await p.waitForSelector('.aa-compartilhar');
      const card = await p.locator('.aa-compartilhar').boundingBox();
      for (const sel of [painel, '.detail', '.score']) if (await p.locator(sel).count()) assert.ok(!cruza(card, await p.locator(sel).first().boundingBox()), `${pagina}: não cobre ${sel}`);
      assert.ok(await p.getByText('Ajude essa ideia a chegar mais longe!').isVisible());
      assert.equal(decodeURIComponent((await p.getAttribute('.aa-compartilhar a[href^="https://wa.me/"]', 'href')).split('text=')[1]), MENSAGEM);
      assert.equal(await p.locator('.aa-flutuante').isVisible(), false, 'sem botão flutuante no desktop');
    }
    await p.goto(BASE + '/');
    await p.locator('.aa-compartilhar').scrollIntoViewIfNeeded();
    await p.locator('.aa-compartilhar').screenshot({ path: path.join(SAIDA, 'compartilhar-card.png') });
    await p.screenshot({ path: path.join(SAIDA, 'compartilhar-contexto-desktop.png') });
    await ctx.close();
  });
  await passo('Web Share API, alternativa sem suporte e cópia do link', async () => {
    const ctx = await contexto({ width: 1366, height: 900 });
    const p = await ctx.newPage(); await p.goto(BASE + '/');
    await p.click('.aa-compartilhar [data-aa-acao="compartilhar"]');
    const d = (await p.evaluate(() => window.__compartilhado))[0];
    assert.equal(d.url, SITE); assert.ok(d.text.startsWith('Estou acompanhando as eleições pelo Atlas Eleitoral!'));
    await ctx.close();
    const ctx2 = await contexto({ width: 1366, height: 900 }, { share: 'sem' });
    const q = await ctx2.newPage(); await q.goto(BASE + '/');
    await q.click('.aa-compartilhar [data-aa-acao="compartilhar"]');
    await q.locator('.aa-folha.aberto').waitFor();
    assert.equal(decodeURIComponent((await q.getAttribute('.aa-folha a', 'href')).split('text=')[1]), MENSAGEM);
    await q.click('.aa-folha [data-aa-acao="copiar-url"]');
    await q.waitForFunction(() => document.querySelector('.aa-folha .aa-status').textContent === 'Link copiado!');
    assert.equal(await q.evaluate(() => navigator.clipboard.readText()), SITE);
    await q.waitForTimeout(450);
    await q.screenshot({ path: path.join(SAIDA, 'compartilhar-alternativa.png') });
    await ctx2.close();
  });
  await passo('comparador: compartilhar o recorte escolhido (parâmetros existentes a, b, uf)', async () => {
    const ctx = await contexto({ width: 1366, height: 900 });
    const p = await ctx.newPage(); await p.goto(BASE + '/comparar.html?a=2018-2&b=2022-2&uf=SP');
    await p.waitForSelector('[data-aa-acao="compartilhar-recorte"]');
    await p.click('[data-aa-acao="compartilhar-recorte"]');
    const d = (await p.evaluate(() => window.__compartilhado))[0];
    assert.equal(d.url, SITE + '/comparar.html?a=2018-2&b=2022-2&uf=SP');
    await ctx.close();
  });
  await passo('celular: botão compacto visível na navegação e nunca sobre o mapa ou o placar', async () => {
    const ctx = await contexto({ width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    for (const pagina of ['/', '/ao-vivo.html', '/comparar.html']) {
      await p.goto(BASE + pagina);
      await p.waitForSelector('.aa-flutuante');
      assert.ok(await semRolagemHorizontal(p), pagina + ': sem rolagem horizontal');
      const altura = await p.evaluate(() => document.documentElement.scrollHeight);
      let visivel = 0;
      for (let y = 0; y < altura; y += 260) {
        await p.evaluate(v => scrollTo(0, v), y);
        await p.waitForTimeout(80);
        await p.clock.runFor(50);
        if (await p.$eval('.aa-flutuante', b => b.classList.contains('oculto'))) continue;
        visivel++;
        const btn = await p.locator('.aa-flutuante').boundingBox();
        for (const sel of ['.map-panel', '.map-box', '.detail', '.score', '.cmp-mapas']) for (const el of await p.locator(sel).all()) assert.ok(!cruza(btn, await el.boundingBox()), `${pagina} y=${y}: cobre ${sel}`);
      }
      assert.ok(visivel > 0, pagina + ': botão aparece em algum momento');
      if (pagina === '/') {
        await p.evaluate(() => scrollTo(0, 0));
        await p.waitForTimeout(80); await p.clock.runFor(50);
        await p.screenshot({ path: path.join(SAIDA, 'celular-inicio.png') });
        await p.locator('.aa-compartilhar').scrollIntoViewIfNeeded();
        await p.waitForTimeout(80); await p.clock.runFor(50);
        await p.screenshot({ path: path.join(SAIDA, 'celular-compartilhar.png') });
      }
    }
    await ctx.close();
  });
  await passo('metadados de compartilhamento e imagem de prévia', async () => {
    const ctx = await contexto({ width: 1200, height: 800 });
    const p = await ctx.newPage();
    for (const pagina of ['/', '/atlas.html', '/ao-vivo.html', '/comparar.html', '/apoiar.html']) {
      await p.goto(BASE + pagina);
      const m = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]')].map(x => [x.getAttribute('property') || x.getAttribute('name'), x.content])));
      assert.equal(m['og:image'], SITE + '/assets/og-atlas.jpg'); assert.equal(m['twitter:card'], 'summary_large_image');
      assert.ok(m['og:url'].startsWith(SITE)); assert.ok(m['og:title'] && m['og:description']);
    }
    const r = await p.request.get(BASE + '/assets/og-atlas.jpg');
    assert.equal(r.status(), 200);
    await ctx.close();
  });
  await passo('nenhum erro de JavaScript', async () => { assert.deepEqual(erros, []); });
  console.log('Domínios externos bloqueados durante o teste:', [...bloqueadas].join(', ') || 'nenhum');
  await navegador.close();
}
main().catch(e => { console.error(e); process.exitCode = 1; });
