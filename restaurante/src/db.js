'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { agora } = require('./util');
const { ErroUsuario } = require('./erros');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessoes (
  token_hash TEXT PRIMARY KEY,
  criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  preco INTEGER NOT NULL CHECK (preco >= 0),
  categoria TEXT NOT NULL DEFAULT '',
  vai_cozinha INTEGER NOT NULL DEFAULT 1,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL DEFAULT '',
  obs TEXT NOT NULL DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY,
  identificacao TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'pago', 'cancelado')),
  forma_pagamento TEXT CHECK (forma_pagamento IN ('dinheiro', 'pix', 'cartao', 'fiado')),
  cliente_id INTEGER REFERENCES clientes(id),
  total INTEGER NOT NULL DEFAULT 0,
  aberto_em TEXT NOT NULL,
  fechado_em TEXT
);
CREATE INDEX IF NOT EXISTS pedidos_status ON pedidos(status, fechado_em);
CREATE TABLE IF NOT EXISTS pedido_itens (
  id INTEGER PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id INTEGER REFERENCES produtos(id),
  nome TEXT NOT NULL,
  preco INTEGER NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  enviada INTEGER NOT NULL DEFAULT 0,
  vai_cozinha INTEGER NOT NULL DEFAULT 1,
  obs TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS itens_pedido ON pedido_itens(pedido_id);
CREATE TABLE IF NOT EXISTS movimentos (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('compra', 'pagamento')),
  valor INTEGER NOT NULL CHECK (valor > 0),
  descricao TEXT NOT NULL DEFAULT '',
  pedido_id INTEGER REFERENCES pedidos(id),
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS movimentos_cliente ON movimentos(cliente_id);
CREATE TABLE IF NOT EXISTS impressoes (
  id INTEGER PRIMARY KEY,
  descricao TEXT NOT NULL,
  dados BLOB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'impresso', 'erro')),
  erro TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL,
  impresso_em TEXT
);
`;

const AJUSTES_PADRAO = {
  nome_estabelecimento: 'Meu Bar',
  mesas: '10',
  impressora_modo: 'desligada', // desligada | rede | agente
  impressora_host: '',
  impressora_porta: '9100',
  impressora_largura: '48', // 48 colunas = papel 80mm, 32 = papel 58mm
  impressora_acentos: 'remover', // remover | cp860
  impressora_codepage: '3',
};

const FORMAS = ['dinheiro', 'pix', 'cartao', 'fiado'];

function abrirBanco(arquivo, { relogio = (data) => agora(data) } = {}) {
  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(arquivo)), { recursive: true });
  const db = new DatabaseSync(arquivo);
  db.exec('PRAGMA foreign_keys = ON;');
  if (arquivo !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return criarRepositorio(db, relogio);
}

// ---------- validação ----------

function texto(valor, campo, { obrigatorio = false, max = 120 } = {}) {
  const s = valor == null ? '' : String(valor).trim();
  if (obrigatorio && !s) throw new ErroUsuario(`Preencha ${campo}.`);
  if (s.length > max) throw new ErroUsuario(`O campo ${campo} está muito comprido.`);
  return s;
}

function dinheiro(valor, campo, { positivo = false } = {}) {
  if (!Number.isInteger(valor) || valor < 0 || valor > 100_000_000) {
    throw new ErroUsuario(`O valor de ${campo} não está certo.`);
  }
  if (positivo && valor === 0) throw new ErroUsuario(`O valor de ${campo} precisa ser maior que zero.`);
  return valor;
}

function inteiro(valor, campo, { min = 0, max = 999 } = {}) {
  if (!Number.isInteger(valor) || valor < min || valor > max) {
    throw new ErroUsuario(`A quantidade de ${campo} não está certa.`);
  }
  return valor;
}

const comparar = (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });

// ---------- repositório ----------

function criarRepositorio(db, relogio) {
  const um = (sql, ...p) => db.prepare(sql).get(...p);
  const varios = (sql, ...p) => db.prepare(sql).all(...p);
  const rodar = (sql, ...p) => db.prepare(sql).run(...p);

  function transacao(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  // --- config ---
  const lerConfig = (chave) => um('SELECT valor FROM config WHERE chave = ?', chave)?.valor;
  const gravarConfig = (chave, valor) =>
    rodar('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor', chave, String(valor));

  function ajustes() {
    const r = { ...AJUSTES_PADRAO };
    for (const chave of Object.keys(AJUSTES_PADRAO)) {
      const v = lerConfig(chave);
      if (v !== undefined) r[chave] = v;
    }
    return r;
  }

  function salvarAjustes(novos) {
    const atual = ajustes();
    const r = { ...atual };
    if ('nome_estabelecimento' in novos) r.nome_estabelecimento = texto(novos.nome_estabelecimento, 'nome', { obrigatorio: true, max: 60 });
    if ('mesas' in novos) r.mesas = String(inteiro(Number(novos.mesas), 'mesas', { max: 60 }));
    if ('impressora_modo' in novos) {
      if (!['desligada', 'rede', 'agente'].includes(novos.impressora_modo)) throw new ErroUsuario('Modo de impressora desconhecido.');
      r.impressora_modo = novos.impressora_modo;
    }
    if ('impressora_host' in novos) {
      const host = texto(novos.impressora_host, 'endereço da impressora', { max: 100 });
      if (host && !/^[a-zA-Z0-9.\-:]+$/.test(host)) throw new ErroUsuario('O endereço da impressora só pode ter letras, números, pontos e traços.');
      r.impressora_host = host;
    }
    if ('impressora_porta' in novos) r.impressora_porta = String(inteiro(Number(novos.impressora_porta), 'porta', { min: 1, max: 65535 }));
    if ('impressora_largura' in novos) {
      if (!['32', '42', '48'].includes(String(novos.impressora_largura))) throw new ErroUsuario('Largura de papel desconhecida.');
      r.impressora_largura = String(novos.impressora_largura);
    }
    if ('impressora_acentos' in novos) {
      if (!['remover', 'cp860'].includes(novos.impressora_acentos)) throw new ErroUsuario('Opção de acentos desconhecida.');
      r.impressora_acentos = novos.impressora_acentos;
    }
    if ('impressora_codepage' in novos) r.impressora_codepage = String(inteiro(Number(novos.impressora_codepage), 'tabela de caracteres', { max: 255 }));
    for (const [k, v] of Object.entries(r)) if (v !== atual[k]) gravarConfig(k, v);
    return ajustes();
  }

  // --- sessões ---
  const criarSessao = (hash) => rodar('INSERT INTO sessoes (token_hash, criado_em) VALUES (?, ?)', hash, relogio());
  const sessaoExiste = (hash) => !!um('SELECT 1 AS ok FROM sessoes WHERE token_hash = ?', hash);
  const apagarSessao = (hash) => rodar('DELETE FROM sessoes WHERE token_hash = ?', hash);
  const apagarSessoes = () => rodar('DELETE FROM sessoes');

  // --- produtos ---
  const fmtProduto = (p) => p && { ...p, vai_cozinha: !!p.vai_cozinha, ativo: !!p.ativo };

  function listarProdutos({ incluirEscondidos = false } = {}) {
    return varios('SELECT * FROM produtos WHERE ativo = 1 OR ?', incluirEscondidos ? 1 : 0)
      .map(fmtProduto)
      .sort((a, b) => comparar(a.categoria, b.categoria) || comparar(a.nome, b.nome));
  }

  function produto(id) {
    const p = fmtProduto(um('SELECT * FROM produtos WHERE id = ?', id));
    if (!p) throw new ErroUsuario('Produto não encontrado.', 404);
    return p;
  }

  function validarProduto(d) {
    return {
      nome: texto(d.nome, 'o nome do produto', { obrigatorio: true, max: 80 }),
      preco: dinheiro(d.preco, 'preço'),
      categoria: texto(d.categoria, 'a categoria', { max: 40 }),
      vai_cozinha: d.vai_cozinha === false ? 0 : 1,
      ativo: d.ativo === false ? 0 : 1,
    };
  }

  function criarProduto(dados) {
    const p = validarProduto(dados);
    const r = rodar(
      'INSERT INTO produtos (nome, preco, categoria, vai_cozinha, ativo, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
      p.nome, p.preco, p.categoria, p.vai_cozinha, p.ativo, relogio(),
    );
    return produto(Number(r.lastInsertRowid));
  }

  function atualizarProduto(id, dados) {
    const atual = produto(id);
    const p = validarProduto({ ...atual, ...dados });
    rodar('UPDATE produtos SET nome = ?, preco = ?, categoria = ?, vai_cozinha = ?, ativo = ? WHERE id = ?',
      p.nome, p.preco, p.categoria, p.vai_cozinha, p.ativo, id);
    return produto(id);
  }

  // --- clientes e fiado ---
  const SQL_CLIENTES = `
    SELECT c.*,
      COALESCE(SUM(CASE m.tipo WHEN 'compra' THEN m.valor ELSE -m.valor END), 0) AS saldo,
      MAX(m.criado_em) AS ultimo_movimento
    FROM clientes c LEFT JOIN movimentos m ON m.cliente_id = c.id`;

  function listarClientes() {
    return varios(`${SQL_CLIENTES} WHERE c.ativo = 1 GROUP BY c.id`)
      .sort((a, b) => (b.saldo > 0) - (a.saldo > 0) || comparar(a.nome, b.nome));
  }

  function cliente(id) {
    const c = um(`${SQL_CLIENTES} WHERE c.id = ? GROUP BY c.id`, id);
    if (!c || !c.ativo) throw new ErroUsuario('Cliente não encontrado.', 404);
    c.movimentos = varios('SELECT * FROM movimentos WHERE cliente_id = ? ORDER BY criado_em DESC, id DESC', id);
    return c;
  }

  function validarCliente(d) {
    return {
      nome: texto(d.nome, 'o nome do cliente', { obrigatorio: true, max: 80 }),
      telefone: texto(d.telefone, 'o telefone', { max: 30 }),
      obs: texto(d.obs, 'a observação', { max: 300 }),
    };
  }

  function criarCliente(dados) {
    const c = validarCliente(dados);
    const r = rodar('INSERT INTO clientes (nome, telefone, obs, criado_em) VALUES (?, ?, ?, ?)', c.nome, c.telefone, c.obs, relogio());
    return cliente(Number(r.lastInsertRowid));
  }

  function atualizarCliente(id, dados) {
    const atual = cliente(id);
    const c = validarCliente({ ...atual, ...dados });
    rodar('UPDATE clientes SET nome = ?, telefone = ?, obs = ? WHERE id = ?', c.nome, c.telefone, c.obs, id);
    return cliente(id);
  }

  function apagarCliente(id) {
    const c = cliente(id);
    if (c.saldo !== 0) throw new ErroUsuario('Esse cliente ainda tem conta em aberto. Acerte a conta antes de apagar.');
    rodar('UPDATE clientes SET ativo = 0 WHERE id = ?', id);
  }

  function lancarMovimento(clienteId, tipo, { valor, descricao, pedidoId = null }) {
    cliente(clienteId);
    rodar('INSERT INTO movimentos (cliente_id, tipo, valor, descricao, pedido_id, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
      clienteId, tipo, dinheiro(valor, 'valor', { positivo: true }), texto(descricao, 'a descrição', { max: 200 }), pedidoId, relogio());
    return cliente(clienteId);
  }

  function apagarMovimento(id) {
    const m = um('SELECT * FROM movimentos WHERE id = ?', id);
    if (!m) throw new ErroUsuario('Lançamento não encontrado.', 404);
    if (m.pedido_id) throw new ErroUsuario('Esse fiado veio de um pedido. Para corrigir, lance um pagamento.');
    rodar('DELETE FROM movimentos WHERE id = ?', id);
    return cliente(m.cliente_id);
  }

  // --- pedidos ---
  const fmtItem = (i) => ({ ...i, vai_cozinha: !!i.vai_cozinha });

  function pedido(id) {
    const p = um(`SELECT p.*, c.nome AS cliente_nome FROM pedidos p LEFT JOIN clientes c ON c.id = p.cliente_id WHERE p.id = ?`, id);
    if (!p) throw new ErroUsuario('Pedido não encontrado.', 404);
    p.itens = varios('SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY id', id).map(fmtItem);
    if (p.status === 'aberto') p.total = p.itens.reduce((s, i) => s + i.preco * i.quantidade, 0);
    p.falta_enviar = p.itens.reduce((s, i) => s + (i.vai_cozinha ? Math.max(0, i.quantidade - i.enviada) : 0), 0);
    return p;
  }

  function pedidoAberto(id) {
    const p = pedido(id);
    if (p.status !== 'aberto') throw new ErroUsuario('Esse pedido já foi fechado.');
    return p;
  }

  function listarPedidosAbertos() {
    return varios(`
      SELECT p.id, p.identificacao, p.aberto_em,
        COALESCE(SUM(i.quantidade), 0) AS qtd_itens,
        COALESCE(SUM(i.quantidade * i.preco), 0) AS total,
        COALESCE(SUM(CASE WHEN i.vai_cozinha = 1 AND i.quantidade > i.enviada THEN i.quantidade - i.enviada ELSE 0 END), 0) AS falta_enviar
      FROM pedidos p LEFT JOIN pedido_itens i ON i.pedido_id = p.id
      WHERE p.status = 'aberto' GROUP BY p.id ORDER BY p.aberto_em, p.id`);
  }

  function criarPedido({ identificacao } = {}) {
    const r = rodar('INSERT INTO pedidos (identificacao, aberto_em) VALUES (?, ?)', texto(identificacao, 'a mesa ou nome', { max: 40 }), relogio());
    return pedido(Number(r.lastInsertRowid));
  }

  function renomearPedido(id, { identificacao }) {
    pedidoAberto(id);
    rodar('UPDATE pedidos SET identificacao = ? WHERE id = ?', texto(identificacao, 'a mesa ou nome', { max: 40 }), id);
    return pedido(id);
  }

  function adicionarItem(pedidoId, { produto_id, quantidade = 1 }) {
    return transacao(() => {
      pedidoAberto(pedidoId);
      const p = produto(produto_id);
      inteiro(quantidade, 'itens', { min: 1, max: 99 });
      const existente = um(`SELECT id FROM pedido_itens WHERE pedido_id = ? AND produto_id = ? AND obs = '' AND preco = ? ORDER BY id DESC LIMIT 1`,
        pedidoId, p.id, p.preco);
      if (existente) {
        rodar('UPDATE pedido_itens SET quantidade = quantidade + ? WHERE id = ?', quantidade, existente.id);
      } else {
        rodar('INSERT INTO pedido_itens (pedido_id, produto_id, nome, preco, quantidade, vai_cozinha, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
          pedidoId, p.id, p.nome, p.preco, quantidade, p.vai_cozinha ? 1 : 0, relogio());
      }
      return pedido(pedidoId);
    });
  }

  /**
   * Muda quantidade e/ou observação de um item. Quantidade 0 tira o item.
   * Devolve o pedido e o que precisa ser avisado à cozinha como cancelado.
   */
  function alterarItem(itemId, dados) {
    return transacao(() => {
      const item = um('SELECT * FROM pedido_itens WHERE id = ?', itemId);
      if (!item) throw new ErroUsuario('Item não encontrado.', 404);
      pedidoAberto(item.pedido_id);
      const quantidade = 'quantidade' in dados ? inteiro(dados.quantidade, 'itens', { max: 99 }) : item.quantidade;
      const obs = 'obs' in dados ? texto(dados.obs, 'a observação', { max: 120 }) : item.obs;
      const cancelar = [];
      let enviada = item.enviada;
      if (quantidade < enviada) {
        if (item.vai_cozinha) cancelar.push({ nome: item.nome, quantidade: enviada - quantidade, obs: item.obs });
        enviada = quantidade;
      }
      if (quantidade === 0) rodar('DELETE FROM pedido_itens WHERE id = ?', itemId);
      else rodar('UPDATE pedido_itens SET quantidade = ?, obs = ?, enviada = ? WHERE id = ?', quantidade, obs, enviada, itemId);
      return { pedido: pedido(item.pedido_id), cancelar };
    });
  }

  /** Marca como enviado à cozinha tudo o que faltava e devolve o que deve ser impresso. */
  function marcarEnviados(pedidoId) {
    return transacao(() => {
      const p = pedidoAberto(pedidoId);
      const novos = p.itens
        .filter((i) => i.vai_cozinha && i.quantidade > i.enviada)
        .map((i) => ({ nome: i.nome, quantidade: i.quantidade - i.enviada, obs: i.obs }));
      rodar('UPDATE pedido_itens SET enviada = quantidade WHERE pedido_id = ? AND vai_cozinha = 1', pedidoId);
      return { pedido: pedido(pedidoId), novos };
    });
  }

  function fecharPedido(id, { forma, cliente_id }) {
    return transacao(() => {
      const p = pedidoAberto(id);
      if (!FORMAS.includes(forma)) throw new ErroUsuario('Escolha como o cliente pagou.');
      if (p.itens.length === 0) throw new ErroUsuario('O pedido está vazio. Adicione algum produto antes de fechar.');
      let clienteId = null;
      if (forma === 'fiado') {
        if (!Number.isInteger(cliente_id)) throw new ErroUsuario('Escolha quem vai ficar devendo.');
        clienteId = cliente(cliente_id).id;
      }
      const quando = relogio();
      rodar(`UPDATE pedidos SET status = 'pago', forma_pagamento = ?, cliente_id = ?, total = ?, fechado_em = ? WHERE id = ?`,
        forma, clienteId, p.total, quando, id);
      if (clienteId) {
        const nomes = p.itens.map((i) => `${i.quantidade}x ${i.nome}`).join(', ');
        lancarMovimento(clienteId, 'compra', { valor: p.total, descricao: `Pedido ${id}: ${nomes}`.slice(0, 200), pedidoId: id });
      }
      return pedido(id);
    });
  }

  function cancelarPedido(id) {
    return transacao(() => {
      const p = pedidoAberto(id);
      const cancelar = p.itens
        .filter((i) => i.vai_cozinha && i.enviada > 0)
        .map((i) => ({ nome: i.nome, quantidade: i.enviada, obs: i.obs }));
      rodar(`UPDATE pedidos SET status = 'cancelado', total = ?, fechado_em = ? WHERE id = ?`, p.total, relogio(), id);
      return { pedido: pedido(id), cancelar };
    });
  }

  // --- vendas ---
  function vendas(data) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '')) throw new ErroUsuario('Data inválida.');
    const porForma = Object.fromEntries(FORMAS.map((f) => [f, { quantidade: 0, total: 0 }]));
    for (const r of varios(`SELECT forma_pagamento AS forma, COUNT(*) AS quantidade, SUM(total) AS total FROM pedidos
        WHERE status = 'pago' AND substr(fechado_em, 1, 10) = ? GROUP BY forma_pagamento`, data)) {
      porForma[r.forma] = { quantidade: r.quantidade, total: r.total };
    }
    const pedidos = varios(`SELECT p.id, p.identificacao, p.forma_pagamento, p.total, p.fechado_em, c.nome AS cliente_nome
        FROM pedidos p LEFT JOIN clientes c ON c.id = p.cliente_id
        WHERE p.status = 'pago' AND substr(p.fechado_em, 1, 10) = ? ORDER BY p.fechado_em DESC`, data);
    const maisVendidos = varios(`SELECT i.nome, SUM(i.quantidade) AS quantidade, SUM(i.quantidade * i.preco) AS total
        FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id
        WHERE p.status = 'pago' AND substr(p.fechado_em, 1, 10) = ?
        GROUP BY i.nome ORDER BY quantidade DESC, total DESC LIMIT 10`, data);
    const recebidoFiado = um(`SELECT COALESCE(SUM(valor), 0) AS v FROM movimentos WHERE tipo = 'pagamento' AND substr(criado_em, 1, 10) = ?`, data).v;
    const total = Object.values(porForma).reduce((s, f) => s + f.total, 0);
    return { data, total, por_forma: porForma, recebido_fiado: recebidoFiado, pedidos, mais_vendidos: maisVendidos };
  }

  function resumo() {
    const hoje = relogio().slice(0, 10);
    return {
      hoje,
      pedidos_abertos: um(`SELECT COUNT(*) AS n FROM pedidos WHERE status = 'aberto'`).n,
      vendido_hoje: um(`SELECT COALESCE(SUM(total), 0) AS v FROM pedidos WHERE status = 'pago' AND substr(fechado_em, 1, 10) = ?`, hoje).v,
      fiado_a_receber: um(`SELECT COALESCE(SUM(CASE tipo WHEN 'compra' THEN valor ELSE -valor END), 0) AS v FROM movimentos m
        JOIN clientes c ON c.id = m.cliente_id WHERE c.ativo = 1`).v,
      problemas_impressao: problemasImpressao().length,
    };
  }

  // --- impressões ---
  function criarImpressao(dados, descricao) {
    const r = rodar('INSERT INTO impressoes (descricao, dados, criado_em) VALUES (?, ?, ?)', descricao, dados, relogio());
    return Number(r.lastInsertRowid);
  }

  function impressao(id) {
    const i = um('SELECT * FROM impressoes WHERE id = ?', id);
    if (!i) throw new ErroUsuario('Impressão não encontrada.', 404);
    i.dados = Buffer.from(i.dados);
    return i;
  }

  function marcarImpressao(id, status, erro = '') {
    rodar('UPDATE impressoes SET status = ?, erro = ?, impresso_em = ? WHERE id = ?',
      status, String(erro).slice(0, 300), status === 'impresso' ? relogio() : null, id);
  }

  const proximaPendente = () => {
    const i = um(`SELECT id FROM impressoes WHERE status = 'pendente' ORDER BY id LIMIT 1`);
    return i ? impressao(i.id) : null;
  };

  /** Impressões com erro, ou que estão esperando há mais de 1 minuto. */
  function problemasImpressao() {
    const limite = relogio(new Date(Date.now() - 60_000));
    return varios(`SELECT id, descricao, status, erro, criado_em FROM impressoes
      WHERE (status = 'erro' OR (status = 'pendente' AND criado_em < ?)) ORDER BY id DESC LIMIT 50`, limite);
  }

  const listarImpressoes = () =>
    varios('SELECT id, descricao, status, erro, criado_em, impresso_em FROM impressoes ORDER BY id DESC LIMIT 30');

  const descartarImpressao = (id) => {
    impressao(id);
    rodar(`UPDATE impressoes SET status = 'impresso', erro = 'descartada' WHERE id = ?`, id);
  };

  return {
    db, transacao, lerConfig, gravarConfig, ajustes, salvarAjustes,
    criarSessao, sessaoExiste, apagarSessao, apagarSessoes,
    listarProdutos, produto, criarProduto, atualizarProduto,
    listarClientes, cliente, criarCliente, atualizarCliente, apagarCliente, lancarMovimento, apagarMovimento,
    pedido, listarPedidosAbertos, criarPedido, renomearPedido, adicionarItem, alterarItem, marcarEnviados, fecharPedido, cancelarPedido,
    vendas, resumo,
    criarImpressao, impressao, marcarImpressao, proximaPendente, problemasImpressao, listarImpressoes, descartarImpressao,
    agora: relogio,
  };
}

module.exports = { abrirBanco, AJUSTES_PADRAO };
