// Verificação de ponta a ponta da página de transmissão em 1920x1080 (Playwright).
// Não faz parte do `npm test`: precisa do Chrome instalado e do playwright-core.
//   npm i --no-save playwright-core
//   PORT=3107 node scripts/dev-server.cjs &
//   node tests/e2e/transmissao.e2e.cjs http://127.0.0.1:3107 ./capturas
// As APIs da Vercel são interceptadas com respostas simuladas: nenhuma consulta chega
// à produção ou ao TSE. O relógio da página é controlado para simular horas em segundos.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const BASE = process.argv[2] || 'http://127.0.0.1:3107';
const SAIDA = path.resolve(process.argv[3] || 'capturas');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const API_NACIONAL = 'https://atlasdaselei-es.vercel.app/api/apuracao?cargo=presidente&uf=BR';
const API_MAPA = 'https://atlasdaselei-es.vercel.app/api/mapa';
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
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
    candidates: cands(a, b), sourceUrl: 'https://resultados.tse.jus.br/oficial/ele2026/6258/dados/br/br-c0001-e006258-u.json', idg: '1', ...(stale ? { stale: true } : {}),
  };
}
function estadoUF(uf, counted, a, b, publishedAt = '2026-10-25T18:00:00-03:00') {
  return { uf, stage: 'counting', sections: { counted, total: 20000, percentage: Math.round((counted / 20000) * 10000) / 100 }, candidates: cands(a, b), publishedAt };
}
function mapa(mod = {}, omitir = []) {
  const states = UFS.filter(uf => !omitir.includes(uf)).map((uf, i) => mod[uf] || estadoUF(uf, 4000 + i * 100, 100000 + i * 3000, 120000 - i * 2500));
  return { ok: true, source: 'TSE', stage: 'counting', states, fetchedAt: new Date().toISOString(), errors: omitir.length, partial: omitir.length > 0, missing: omitir };
}

async function main() {
  const navegador = await chromium.launch({ executablePath: CHROME, headless: true });
  const contexto = await navegador.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const pagina = await contexto.newPage();
  const erros = [], requisicoes = [];
  pagina.on('pageerror', e => erros.push('pageerror: ' + e.message));
  // Quedas de rede simuladas pelo próprio teste geram avisos de recurso, não erros de script.
  const simulado = t => /ERR_INTERNET_DISCONNECTED/.test(t);
  pagina.on('console', m => { if (m.type() === 'error' && !simulado(m.text())) erros.push('console: ' + m.text() + ' ' + JSON.stringify(m.location())); });
  pagina.on('request', r => { if (/\/api\//.test(r.url())) requisicoes.push(r.url()); });

  // Respostas atuais das APIs simuladas; 'falhar' simula queda de rede.
  const api = { nacional: nacional({ stage: 'waiting' }), mapa: { ok: true, source: 'TSE', stage: 'scheduled', states: [], errors: 0 }, falhar: false };
  await contexto.route('https://atlasdaselei-es.vercel.app/api/**', rota => {
    if (api.falhar) return rota.abort('internetdisconnected');
    const url = rota.request().url();
    const corpo = url === API_NACIONAL ? api.nacional : url === API_MAPA ? api.mapa : null;
    if (!corpo) return rota.fulfill({ status: 404, body: 'URL não canônica: ' + url });
    return rota.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(corpo) });
  });

  const avancar = async ms => { for (let t = 0; t < ms; t += 1000) { await pagina.clock.runFor(Math.min(1000, ms - t)); await pagina.waitForTimeout(15); } };
  const ler = () => pagina.evaluate(() => ({
    cena: { ...window.__transmissao.cena }, fila: window.__transmissao.fila,
    pill: document.getElementById('status').dataset.estado, pillTexto: document.getElementById('status-texto').textContent,
    animacao: getComputedStyle(document.querySelector('#status .ponto')).animationName,
    aviso: document.getElementById('aviso').hidden ? '' : document.getElementById('aviso').textContent,
    placar: document.getElementById('placar').innerText, notaMapa: document.getElementById('mapa-nota').hidden ? '' : document.getElementById('mapa-nota').textContent,
    camera: document.getElementById('camera').style.transform, demo: !document.getElementById('demo-faixa').hidden,
    rodape: document.querySelector('.rodape').innerText, largura: document.documentElement.scrollWidth,
  }));
  const passo = (nome, fn) => fn().then(() => console.log('✔', nome)).catch(e => { console.log('✖', nome, '\n  ', e.message); process.exitCode = 1; });

  await pagina.clock.install({ time: new Date('2026-10-25T15:00:00-03:00') });
  await pagina.goto(BASE + '/transmissao.html');
  await avancar(3000);

  await passo('antes das 17h: aguardando, contagem regressiva, sem números nem pulso', async () => {
    const s = await ler();
    assert.equal(s.cena.tipo, 'pre'); assert.equal(s.pill, 'pre'); assert.equal(s.animacao, 'none');
    assert.match(s.placar, /Aguardando divulgação oficial/); assert.match(s.placar, /0?1:59:5\d|02:00:00/);
    assert.doesNotMatch(s.placar, /\d+,\d\d%/); assert.equal(s.demo, false);
    await pagina.waitForTimeout(2200); await pagina.screenshot({ path: path.join(SAIDA, 'transmissao-pre.png') });
  });

  await passo('renderização 1920x1080 sem rolagem e dentro da margem segura', async () => {
    const caixas = await pagina.evaluate(() => ['.topo', '.placar', '.legenda', '.rodape', '.painel-mapa'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [s, r.left, r.top, r.right, r.bottom]; }));
    const s = await ler();
    assert.equal(s.largura, 1920);
    for (const [sel, l, t, r, b] of caixas) assert.ok(l >= 95 && t >= 53 && r <= 1825 && b <= 1027, `${sel} fora da margem: ${[l, t, r, b].map(Math.round)}`);
  });

  await passo('início da apuração: placar nacional com votos, pulso só com apuração oficial', async () => {
    api.nacional = nacional({ counted: 100000, a: 20000000, b: 18000000, publishedAt: '2026-10-25T17:40:00-03:00' });
    api.mapa = mapa();
    await pagina.clock.setSystemTime(new Date('2026-10-25T17:40:00-03:00'));
    await avancar(31000);
    const s = await ler();
    assert.equal(s.pill, 'apuracao'); assert.equal(s.animacao, 'pulso');
    assert.equal(s.cena.tipo, 'nacional'); assert.match(s.placar, /20\.000\.000 votos/); assert.match(s.placar, /Brancos/);
    assert.match(s.rodape, /Arquivo oficial do TSE: 25\/10, 17:40:00/);
    await pagina.waitForTimeout(2200); await pagina.screenshot({ path: path.join(SAIDA, 'transmissao-nacional.png') });
  });

  await passo('alternância automática: cena estadual com aproximação e retorno nacional', async () => {
    await avancar(21000);
    let s = await ler();
    assert.equal(s.cena.tipo, 'estado'); assert.match(s.camera, /scale\((?!1\))/);
    assert.match(s.placar, /Seções totalizadas no estado/); assert.match(s.placar, / votos/);
    await avancar(2500);
    await pagina.waitForTimeout(2200); await pagina.screenshot({ path: path.join(SAIDA, 'transmissao-estado.png') });
    await avancar(14000);
    s = await ler();
    assert.equal(s.cena.tipo, 'nacional'); assert.match(s.camera, /scale\(1\)/);
  });

  await passo('mesma divulgação com fetchedAt novo não vira nova parcial', async () => {
    api.mapa = { ...mapa(), fetchedAt: new Date(Date.now() + 99999).toISOString() };
    await avancar(62000);
    assert.equal((await ler()).fila.length, 0);
  });

  await passo('nova parcial em BA: entra na fila, aparece após a cena atual com selo', async () => {
    api.mapa = mapa({ BA: estadoUF('BA', 9000, 300000, 250000, '2026-10-25T17:55:00-03:00') });
    // Observa desde já: a parcial pode entrar no ar logo após a próxima consulta ao mapa.
    let vista = null, entrouNaFila = false;
    for (let i = 0; i < 125 && !vista; i++) {
      await avancar(1000);
      const s = await ler();
      if (s.fila.some(f => f.uf === 'BA')) entrouNaFila = true;
      if (s.cena.tipo === 'parcial' && s.cena.uf === 'BA') vista = s;
    }
    assert.ok(entrouNaFila || vista, 'BA não entrou na fila de parciais');
    assert.ok(vista, 'cena de nova parcial de BA não apareceu');
    assert.match(vista.placar, /Nova parcial/i); assert.match(vista.placar, /Bahia/); assert.match(vista.placar, /300\.000 votos/);
    await avancar(1500);
    await pagina.waitForTimeout(2200); await pagina.screenshot({ path: path.join(SAIDA, 'transmissao-nova-parcial.png') });
  });

  await passo('resposta antiga fora de ordem (sem stale) é ignorada', async () => {
    api.mapa = mapa({ BA: estadoUF('BA', 5000, 120000, 110000, '2026-10-25T17:30:00-03:00') });
    api.nacional = nacional({ counted: 90000, a: 1, b: 1, publishedAt: '2026-10-25T17:30:00-03:00' });
    await avancar(62000);
    const d = await pagina.evaluate(() => ({ ba: window.__transmissao.estado.estados.get('BA').dados.sections.counted, br: window.__transmissao.estado.nacional.sections.counted, ign: window.__transmissao.estado.respostasAntigasIgnoradas }));
    assert.equal(d.ba, 9000); assert.equal(d.br, 100000); assert.ok(d.ign >= 2);
    assert.equal((await ler()).fila.filter(f => f.uf === 'BA').length, 0);
  });

  await passo('falha de rede: mantém último resultado com aviso e recupera sozinho', async () => {
    api.nacional = nacional({ counted: 100000, a: 20000000, b: 18000000, publishedAt: '2026-10-25T17:40:00-03:00' });
    api.mapa = mapa({ BA: estadoUF('BA', 9000, 300000, 250000, '2026-10-25T17:55:00-03:00') });
    api.falhar = true;
    await avancar(35000);
    let s = await ler();
    assert.equal(s.pill, 'desatualizado'); assert.equal(s.animacao, 'none'); assert.match(s.aviso, /conexão instável/);
    assert.match(s.placar, /\d+,\d\d%/, 'resultado anterior continua na tela');
    await pagina.waitForTimeout(2200); await pagina.screenshot({ path: path.join(SAIDA, 'transmissao-falha.png') });
    api.falhar = false;
    await avancar(35000);
    s = await ler();
    assert.equal(s.aviso, ''); assert.equal(s.pill, 'apuracao');
  });

  await passo('mapa parcial: UFs ausentes identificadas e dados anteriores mantidos', async () => {
    api.mapa = mapa({ BA: estadoUF('BA', 9000, 300000, 250000, '2026-10-25T17:55:00-03:00') }, ['RS', 'AM']);
    await avancar(62000);
    const s = await ler();
    assert.match(s.notaMapa, /2 UF\(s\) sem atualização.*RS, AM|AM, RS/);
    const rs = await pagina.evaluate(() => window.__transmissao.estado.estados.get('RS'));
    assert.equal(rs.ausente, true); assert.ok(rs.dados.sections.counted > 0);
  });

  await passo('API sinaliza stale: aviso de fonte indisponível, sem pulso', async () => {
    api.nacional = { ...nacional({ counted: 100000, a: 20000000, b: 18000000, publishedAt: '2026-10-25T17:40:00-03:00' }), stale: true };
    await avancar(31000);
    const s = await ler();
    assert.match(s.aviso, /fonte oficial temporariamente indisponível/); assert.equal(s.animacao, 'none');
    api.nacional = nacional({ counted: 100000, a: 20000000, b: 18000000, publishedAt: '2026-10-25T17:40:00-03:00' });
    await avancar(31000);
    assert.equal((await ler()).aviso, '');
  });

  await passo('reinício da página sem rede: recupera o último resultado, identificado', async () => {
    api.falhar = true;
    await pagina.reload();
    await avancar(3000);
    let s = await ler();
    assert.match(s.placar, /\d+,\d\d%/); assert.match(s.aviso, /recuperados após reinício|conexão instável/); assert.equal(s.animacao, 'none');
    api.falhar = false;
    await avancar(35000);
    s = await ler();
    assert.equal(s.aviso, ''); assert.equal(s.pill, 'apuracao');
  });

  await passo('somente URLs canônicas da Vercel, sem quebra de cache nem API local', async () => {
    const unicas = [...new Set(requisicoes)];
    assert.deepEqual(unicas.sort(), [API_MAPA, API_NACIONAL].sort());
  });

  await passo('modo real nunca mostra dados de demonstração', async () => {
    const s = await ler();
    assert.equal(s.demo, false); assert.doesNotMatch(s.placar, /CANDIDATO A|DEMONSTRA/);
  });

  // ---------- demonstração: sessão longa simulada ----------
  await passo('demonstração: aviso permanente, sessão de 40 min sem erros nem travamento', async () => {
    const demo = await contexto.newPage();
    demo.on('pageerror', e => erros.push('demo pageerror: ' + e.message));
    demo.on('console', m => { if (m.type() === 'error') erros.push('demo console: ' + m.text()); });
    await demo.clock.install({ time: new Date('2026-10-25T16:58:00-03:00') });
    await demo.goto(BASE + '/transmissao.html?demo=1');
    const ler2 = () => demo.evaluate(() => ({ cena: { ...window.__transmissao.cena }, demo: !document.getElementById('demo-faixa').hidden, faixa: document.getElementById('demo-faixa').textContent, textoTela: document.getElementById('tela').innerText, nos: document.getElementsByTagName('*').length, pill: document.getElementById('status').dataset.estado, aviso: document.getElementById('aviso').hidden ? '' : document.getElementById('aviso').textContent }));
    const vistas = { pre: 0, nacional: 0, estado: 0, parcial: 0 }, porUF = {}, avisos = new Set();
    let ultimaId = -1, nosInicio = 0, capturou = false;
    for (let t = 0; t < 40 * 60; t += 5) {
      await demo.clock.runFor(5000); await demo.waitForTimeout(10);
      const s = await ler2();
      assert.equal(s.demo, true); assert.equal(s.faixa, 'DEMONSTRAÇÃO — DADOS FICTÍCIOS');
      const oficial = s.textoTela.match(/.{0,40}(oficial do TSE|Fonte: Tribunal|Apuração em andamento|fonte oficial).{0,20}/);
      assert.equal(oficial, null, 'demonstração não usa rótulos oficiais: ' + (oficial && oficial[0]));
      if (s.aviso) avisos.add(s.aviso.split('·')[1]?.trim().split('.')[0]);
      if (s.cena.id !== ultimaId) { vistas[s.cena.tipo]++; ultimaId = s.cena.id; if (s.cena.uf) porUF[s.cena.uf] = (porUF[s.cena.uf] || 0) + 1; }
      if (t === 120) nosInicio = s.nos;
      if (!capturou && s.cena.tipo === 'parcial' && Date.now()) { await demo.clock.runFor(2500); await demo.waitForTimeout(20); await demo.waitForTimeout(2200); await demo.screenshot({ path: path.join(SAIDA, 'transmissao-demo.png') }); capturou = true; }
    }
    const fim = await ler2();
    console.log('   cenas:', JSON.stringify(vistas), '| UFs exibidas:', Object.keys(porUF).length, '| máx. por UF:', Math.max(...Object.values(porUF)), '| avisos vistos:', [...avisos].join(' / '), '| nós DOM:', nosInicio, '→', fim.nos);
    assert.ok(vistas.estado + vistas.parcial >= 40); assert.ok(vistas.parcial >= 3, 'demonstração deveria gerar novas parciais');
    assert.ok(Object.keys(porUF).length >= 20, 'rotação deveria cobrir a maioria das UFs');
    assert.ok(Math.abs(fim.nos - nosInicio) < 80, 'DOM estável (sem vazamento)');
    assert.ok(capturou, 'captura da demonstração');
    await demo.close();
  });

  await passo('nenhum erro de JavaScript', async () => { assert.deepEqual(erros, []); });
  await navegador.close();
}
main().catch(e => { console.error(e); process.exit(1); });
