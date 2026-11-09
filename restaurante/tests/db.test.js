'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirBanco } = require('../src/db');

function novoBanco() {
  let hora = '2026-11-09 12:00:00';
  const repo = abrirBanco(':memory:', { relogio: () => hora });
  repo.mudarHora = (h) => { hora = h; };
  return repo;
}

test('produtos: cria, edita, esconde', () => {
  const r = novoBanco();
  const p = r.criarProduto({ nome: ' Cerveja ', preco: 1200, categoria: 'Bebidas', vai_cozinha: false });
  assert.equal(p.nome, 'Cerveja');
  assert.equal(p.vai_cozinha, false);
  r.atualizarProduto(p.id, { preco: 1300 });
  assert.equal(r.produto(p.id).preco, 1300);
  r.atualizarProduto(p.id, { ativo: false });
  assert.equal(r.listarProdutos().length, 0);
  assert.equal(r.listarProdutos({ incluirEscondidos: true }).length, 1);
  assert.throws(() => r.criarProduto({ nome: '', preco: 100 }), /Preencha/);
  assert.throws(() => r.criarProduto({ nome: 'X', preco: 1.5 }), /valor/);
});

test('pedido: junta itens iguais e sabe o que falta mandar para a cozinha', () => {
  const r = novoBanco();
  const lanche = r.criarProduto({ nome: 'X-Burguer', preco: 2500 });
  const refri = r.criarProduto({ nome: 'Refri', preco: 600, vai_cozinha: false });
  const p = r.criarPedido({ identificacao: 'Mesa 1' });
  r.adicionarItem(p.id, { produto_id: lanche.id });
  r.adicionarItem(p.id, { produto_id: lanche.id });
  let atual = r.adicionarItem(p.id, { produto_id: refri.id });
  assert.equal(atual.itens.length, 2);
  assert.equal(atual.total, 5600);
  assert.equal(atual.falta_enviar, 2);

  const { novos } = r.marcarEnviados(p.id);
  assert.deepEqual(novos, [{ nome: 'X-Burguer', quantidade: 2, obs: '' }]);
  assert.equal(r.marcarEnviados(p.id).novos.length, 0);

  // pediu mais um depois: só o novo vai para a cozinha
  atual = r.adicionarItem(p.id, { produto_id: lanche.id });
  assert.equal(atual.falta_enviar, 1);
  assert.deepEqual(r.marcarEnviados(p.id).novos, [{ nome: 'X-Burguer', quantidade: 1, obs: '' }]);
});

test('pedido: tirar item que já foi para a cozinha gera cancelamento', () => {
  const r = novoBanco();
  const lanche = r.criarProduto({ nome: 'Pastel', preco: 800 });
  const p = r.criarPedido({});
  const item = r.adicionarItem(p.id, { produto_id: lanche.id, quantidade: 3 }).itens[0];
  r.marcarEnviados(p.id);
  const menos = r.alterarItem(item.id, { quantidade: 1 });
  assert.deepEqual(menos.cancelar, [{ nome: 'Pastel', quantidade: 2, obs: '' }]);
  assert.equal(menos.pedido.total, 800);
  const fora = r.alterarItem(item.id, { quantidade: 0 });
  assert.equal(fora.cancelar[0].quantidade, 1);
  assert.equal(fora.pedido.itens.length, 0);
});

test('fiado: fechar pedido no fiado soma no caderninho e pagamento abate', () => {
  const r = novoBanco();
  const prato = r.criarProduto({ nome: 'PF', preco: 2000 });
  const joao = r.criarCliente({ nome: 'João' });
  const p = r.criarPedido({ identificacao: 'João' });
  r.adicionarItem(p.id, { produto_id: prato.id, quantidade: 2 });
  assert.throws(() => r.fecharPedido(p.id, { forma: 'fiado' }), /quem vai ficar devendo/);
  const fechado = r.fecharPedido(p.id, { forma: 'fiado', cliente_id: joao.id });
  assert.equal(fechado.status, 'pago');
  assert.equal(fechado.cliente_nome, 'João');
  assert.equal(r.cliente(joao.id).saldo, 4000);

  r.lancarMovimento(joao.id, 'compra', { valor: 500, descricao: 'cigarro' });
  r.lancarMovimento(joao.id, 'pagamento', { valor: 1500, descricao: '' });
  const c = r.cliente(joao.id);
  assert.equal(c.saldo, 3000);
  assert.equal(c.movimentos.length, 3);
  assert.throws(() => r.apagarCliente(joao.id), /conta em aberto/);
  assert.throws(() => r.apagarMovimento(c.movimentos.find((m) => m.pedido_id).id), /veio de um pedido/);
  assert.throws(() => r.fecharPedido(p.id, { forma: 'pix' }), /já foi fechado/);
});

test('vendas do dia separam por forma de pagamento', () => {
  const r = novoBanco();
  const cerveja = r.criarProduto({ nome: 'Cerveja', preco: 1000, vai_cozinha: false });
  const maria = r.criarCliente({ nome: 'Maria' });
  for (const forma of ['dinheiro', 'pix', 'pix', 'fiado']) {
    const p = r.criarPedido({});
    r.adicionarItem(p.id, { produto_id: cerveja.id });
    r.fecharPedido(p.id, { forma, cliente_id: maria.id });
  }
  const cancelado = r.criarPedido({});
  r.adicionarItem(cancelado.id, { produto_id: cerveja.id });
  r.cancelarPedido(cancelado.id);
  r.lancarMovimento(maria.id, 'pagamento', { valor: 1000 });

  r.mudarHora('2026-11-10 09:00:00');
  const ontem = r.criarPedido({});
  r.adicionarItem(ontem.id, { produto_id: cerveja.id });
  r.fecharPedido(ontem.id, { forma: 'cartao' });

  const v = r.vendas('2026-11-09');
  assert.equal(v.total, 4000);
  assert.equal(v.por_forma.pix.total, 2000);
  assert.equal(v.por_forma.fiado.total, 1000);
  assert.equal(v.por_forma.cartao.total, 0);
  assert.equal(v.recebido_fiado, 1000);
  assert.equal(v.pedidos.length, 4);
  assert.deepEqual({ ...v.mais_vendidos[0] }, { nome: 'Cerveja', quantidade: 4, total: 4000 });
  assert.equal(r.vendas('2026-11-10').total, 1000);
});

test('ajustes validam valores', () => {
  const r = novoBanco();
  assert.equal(r.ajustes().impressora_modo, 'desligada');
  r.salvarAjustes({ impressora_modo: 'rede', impressora_host: '192.168.0.50', mesas: 6 });
  assert.equal(r.ajustes().impressora_host, '192.168.0.50');
  assert.equal(r.ajustes().mesas, '6');
  assert.throws(() => r.salvarAjustes({ impressora_modo: 'bluetooth' }), /desconhecido/);
  assert.throws(() => r.salvarAjustes({ impressora_host: 'a b;rm' }), /só pode ter/);
});
