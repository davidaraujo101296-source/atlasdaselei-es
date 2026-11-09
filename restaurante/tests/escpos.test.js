'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { codificar, quebrar, comandaCozinha } = require('../src/escpos');
const { AJUSTES_PADRAO } = require('../src/db');

test('remove acentos por padrão', () => {
  assert.equal(Buffer.from(codificar('Pão de açúcar')).toString('latin1'), 'Pao de acucar');
});

test('usa a tabela PC860 quando pedido', () => {
  assert.deepEqual(codificar('çã', 'cp860'), [0x87, 0x84]);
});

test('descarta emojis e caracteres que a impressora não conhece', () => {
  assert.equal(Buffer.from(codificar('Cerveja 🍺')).toString('latin1'), 'Cerveja ');
});

test('quebra linhas sem cortar palavras', () => {
  assert.deepEqual(quebrar('Porção de batata frita com cheddar', 16), ['Porção de batata', 'frita com', 'cheddar']);
  assert.deepEqual(quebrar('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
});

test('comanda da cozinha tem itens, observação e corte de papel', () => {
  const bytes = comandaCozinha({
    ajustes: AJUSTES_PADRAO,
    pedidoId: 7,
    identificacao: 'Mesa 3',
    itens: [{ nome: 'X-Burguer', quantidade: 2, obs: 'sem cebola' }],
    quando: '2026-11-09 14:32:00',
  });
  const texto = bytes.toString('latin1');
  assert.ok(texto.includes('COZINHA'));
  assert.ok(texto.includes('MESA 3'));
  assert.ok(texto.includes('2x X-Burguer'));
  assert.ok(texto.includes('>> sem cebola'));
  assert.ok(texto.includes('09/11 14:32'));
  assert.deepEqual([...bytes.subarray(0, 2)], [0x1b, 0x40]);
  assert.deepEqual([...bytes.subarray(-4)], [0x1d, 0x56, 0x42, 0x00]);
});

test('comanda de cancelamento avisa para não fazer', () => {
  const texto = comandaCozinha({
    ajustes: AJUSTES_PADRAO, pedidoId: 1, identificacao: '', tipo: 'cancelar',
    itens: [{ nome: 'Pastel', quantidade: 1, obs: '' }], quando: '2026-11-09 10:00:00',
  }).toString('latin1');
  assert.ok(texto.includes('CANCELAR'));
  assert.ok(texto.includes('NAO FAZER'));
});
