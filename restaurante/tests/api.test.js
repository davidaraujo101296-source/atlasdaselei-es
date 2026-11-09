'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { abrirBanco } = require('../src/db');
const { criarApp } = require('../src/app');
const { enviarParaImpressora } = require('../src/impressora');

async function iniciar({ enviarImpressora } = {}) {
  const repo = abrirBanco(':memory:');
  const impressos = [];
  const app = criarApp({
    repo,
    enviarImpressora: enviarImpressora || (async (destino, dados) => { impressos.push({ destino, dados }); }),
  });
  const servidor = http.createServer(app);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  let cookie = '';
  async function api(metodo, url, corpo, cabecalhos = {}) {
    const r = await fetch(base + url, {
      method: metodo,
      headers: { ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...cabecalhos },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const novo = r.headers.get('set-cookie');
    if (novo) cookie = novo.split(';')[0];
    const texto = await r.text();
    return { status: r.status, dados: texto ? JSON.parse(texto) : null };
  }
  return { repo, api, base, impressos, fechar: () => servidor.close(), sairSessao: () => { cookie = ''; } };
}

test('primeiro acesso, login e proteção das rotas', async (t) => {
  const s = await iniciar();
  t.after(s.fechar);
  assert.equal((await s.api('GET', '/api/produtos')).status, 401);
  assert.deepEqual((await s.api('GET', '/api/estado')).dados, { configurado: false, logado: false, nome: 'Meu Bar' });
  assert.equal((await s.api('POST', '/api/configurar', { senha: '12' })).status, 400);
  assert.equal((await s.api('POST', '/api/configurar', { senha: '1234', nome: 'Bar da Mãe' })).status, 200);
  assert.equal((await s.api('GET', '/api/estado')).dados.logado, true);
  assert.equal((await s.api('POST', '/api/configurar', { senha: '9999' })).status, 409);

  s.sairSessao();
  assert.equal((await s.api('POST', '/api/entrar', { senha: 'errada' })).status, 401);
  assert.equal((await s.api('POST', '/api/entrar', { senha: '1234' })).status, 200);
  assert.equal((await s.api('GET', '/api/produtos')).status, 200);
  await s.api('POST', '/api/sair');
  assert.equal((await s.api('GET', '/api/produtos')).status, 401);
});

test('bloqueia depois de muitas senhas erradas', async (t) => {
  const s = await iniciar();
  t.after(s.fechar);
  await s.api('POST', '/api/configurar', { senha: '1234' });
  s.sairSessao();
  for (let i = 0; i < 5; i++) await s.api('POST', '/api/entrar', { senha: 'x' });
  assert.equal((await s.api('POST', '/api/entrar', { senha: '1234' })).status, 429);
});

test('fluxo completo: produto, pedido, cozinha, fechar no fiado', async (t) => {
  const s = await iniciar();
  t.after(s.fechar);
  await s.api('POST', '/api/configurar', { senha: '1234' });
  await s.api('PUT', '/api/ajustes', { impressora_modo: 'rede', impressora_host: '10.0.0.9' });

  const lanche = (await s.api('POST', '/api/produtos', { nome: 'X-Salada', preco: 2200, categoria: 'Lanches' })).dados;
  const cerveja = (await s.api('POST', '/api/produtos', { nome: 'Cerveja', preco: 1000, vai_cozinha: false })).dados;
  const pedido = (await s.api('POST', '/api/pedidos', { identificacao: 'Mesa 2' })).dados;
  await s.api('POST', `/api/pedidos/${pedido.id}/itens`, { produto_id: lanche.id });
  const comItens = (await s.api('POST', `/api/pedidos/${pedido.id}/itens`, { produto_id: cerveja.id })).dados;
  await s.api('PUT', `/api/itens/${comItens.itens[0].id}`, { obs: 'sem tomate' });

  const enviado = await s.api('POST', `/api/pedidos/${pedido.id}/enviar`);
  assert.equal(enviado.dados.impressao.status, 'impresso');
  assert.equal(s.impressos.length, 1);
  assert.deepEqual(s.impressos[0].destino, { host: '10.0.0.9', porta: '9100' });
  const papel = s.impressos[0].dados.toString('latin1');
  assert.ok(papel.includes('1x X-Salada'));
  assert.ok(papel.includes('sem tomate'));
  assert.ok(!papel.includes('Cerveja'), 'bebida não vai para a cozinha');
  assert.equal((await s.api('POST', `/api/pedidos/${pedido.id}/enviar`)).status, 400);

  // fiado sem cliente não pode, e não imprime nada por engano
  await s.api('POST', `/api/pedidos/${pedido.id}/itens`, { produto_id: lanche.id });
  assert.equal((await s.api('POST', `/api/pedidos/${pedido.id}/fechar`, { forma: 'fiado' })).status, 400);
  assert.equal(s.impressos.length, 1);

  const cliente = (await s.api('POST', '/api/clientes', { nome: 'Seu Zé' })).dados;
  const fechado = await s.api('POST', `/api/pedidos/${pedido.id}/fechar`, { forma: 'fiado', cliente_id: cliente.id });
  assert.equal(fechado.status, 200);
  assert.equal(fechado.dados.total, 5400);
  assert.equal(s.impressos.length, 2, 'o lanche que faltava foi para a cozinha ao fechar');
  assert.equal((await s.api('GET', `/api/clientes/${cliente.id}`)).dados.saldo, 5400);
  assert.equal((await s.api('GET', '/api/resumo')).dados.fiado_a_receber, 5400);
  assert.equal((await s.api('GET', '/api/pedidos')).dados.length, 0);
});

test('impressora com problema aparece no aviso e pode reimprimir', async (t) => {
  let funcionando = false;
  const s = await iniciar({
    enviarImpressora: async () => { if (!funcionando) throw new Error('A impressora não respondeu.'); },
  });
  t.after(s.fechar);
  await s.api('POST', '/api/configurar', { senha: '1234' });
  await s.api('PUT', '/api/ajustes', { impressora_modo: 'rede', impressora_host: '10.0.0.9' });
  const prato = (await s.api('POST', '/api/produtos', { nome: 'Feijoada', preco: 3500 })).dados;
  const pedido = (await s.api('POST', '/api/pedidos', {})).dados;
  await s.api('POST', `/api/pedidos/${pedido.id}/itens`, { produto_id: prato.id });
  const r = await s.api('POST', `/api/pedidos/${pedido.id}/enviar`);
  assert.equal(r.dados.impressao.status, 'erro');
  assert.equal((await s.api('GET', '/api/resumo')).dados.problemas_impressao, 1);

  funcionando = true;
  const de_novo = await s.api('POST', `/api/impressoes/${r.dados.impressao.id}/reimprimir`);
  assert.equal(de_novo.dados.status, 'impresso');
  assert.equal((await s.api('GET', '/api/resumo')).dados.problemas_impressao, 0);
});

test('agente de impressão busca trabalhos com o código certo', async (t) => {
  const s = await iniciar();
  t.after(s.fechar);
  await s.api('POST', '/api/configurar', { senha: '1234' });
  await s.api('PUT', '/api/ajustes', { impressora_modo: 'agente' });
  const token = (await s.api('GET', '/api/ajustes')).dados.token_agente;
  assert.equal((await s.api('POST', '/api/ajustes/teste-impressao')).dados.status, 'pendente');

  assert.equal((await s.api('GET', '/api/agente/proxima', null, { 'X-Agente-Token': 'errado' })).status, 401);
  const trabalho = await s.api('GET', '/api/agente/proxima', null, { 'X-Agente-Token': token });
  assert.equal(trabalho.status, 200);
  assert.ok(Buffer.from(trabalho.dados.dados, 'base64').toString('latin1').includes('TESTE'));
  await s.api('POST', `/api/agente/${trabalho.dados.id}/resultado`, { ok: true }, { 'X-Agente-Token': token });
  assert.equal((await s.api('GET', '/api/agente/proxima', null, { 'X-Agente-Token': token })).status, 204);
  assert.ok((await s.api('GET', '/api/ajustes')).dados.agente_visto_em);
});

test('serve as telas sem deixar sair da pasta pública', async (t) => {
  const s = await iniciar();
  t.after(s.fechar);
  const pagina = await fetch(`${s.base}/`);
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /Comanda Fácil/);
  assert.equal((await fetch(`${s.base}/app.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await fetch(`${s.base}/..%2fserver.js`)).status, 404);
});

test('enviarParaImpressora manda os bytes por TCP (porta 9100)', async (t) => {
  const recebido = [];
  const falsa = net.createServer((c) => c.on('data', (d) => recebido.push(d)));
  await new Promise((r) => falsa.listen(0, '127.0.0.1', r));
  t.after(() => falsa.close());
  const fechou = new Promise((r) => falsa.on('connection', (c) => c.on('end', r)));
  await enviarParaImpressora({ host: '127.0.0.1', porta: falsa.address().port }, Buffer.from('ola'));
  await fechou;
  assert.equal(Buffer.concat(recebido).toString(), 'ola');
  await assert.rejects(enviarParaImpressora({ host: '' }, Buffer.from('x')), /não foi configurado/);
});
