'use strict';

/* Comanda Fácil — telas do aplicativo (funciona no navegador do celular). */

// ================= utilidades =================

const $ = (sel, el = document) => el.querySelector(sel);

/** Cria elementos sem usar innerHTML (protege contra texto malicioso). */
function h(tag, props, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'texto') el.textContent = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat(Infinity)) {
    if (f == null || f === false) continue;
    el.append(f instanceof Node ? f : String(f));
  }
  return el;
}

const reais = (centavos) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Lê "12,50", "12.50", "R$ 1.234,56" → centavos. Devolve null se não der. */
function lerDinheiro(texto) {
  let s = String(texto || '').replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

const paraCampo = (centavos) => (centavos / 100).toFixed(2).replace('.', ',');
const horaDe = (quando) => (quando ? quando.slice(11, 16) : '');
const dataDe = (quando) => (quando ? `${quando.slice(8, 10)}/${quando.slice(5, 7)}/${quando.slice(0, 4)}` : '');
const dataHora = (quando) => `${dataDe(quando)} às ${horaDe(quando)}`;
const NOMES_FORMA = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão', fiado: 'Fiado' };
const ICONES_FORMA = { dinheiro: '💵', pix: '📱', cartao: '💳', fiado: '📒' };

function avisar(mensagem, tipo = 'ok', tempo = 2600) {
  // Um aviso por vez: o novo substitui o anterior (não acumula na tela).
  const t = h('div', { class: `toast ${tipo}` }, mensagem);
  $('#aviso').replaceChildren(t);
  setTimeout(() => t.remove(), tipo === 'erro' ? Math.max(tempo, 5000) : tempo);
}

class ErroLogin extends Error {}

async function api(metodo, url, corpo) {
  const opcoes = { method: metodo, credentials: 'same-origin', headers: {} };
  if (corpo !== undefined) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }
  let r;
  try {
    r = await fetch(`/api${url}`, opcoes);
  } catch {
    throw new Error('Sem internet ou o sistema está fora do ar. Tente de novo.');
  }
  const dados = await r.json().catch(() => null);
  if (r.status === 401 && !url.startsWith('/entrar') && !url.startsWith('/senha')) {
    telaLogin();
    throw new ErroLogin('Precisa entrar com a senha.');
  }
  if (!r.ok) throw new Error(dados?.erro || 'Algo deu errado. Tente de novo.');
  return dados;
}

/** Roda uma ação e mostra o erro (se houver) de forma clara. */
async function tentar(acao) {
  try {
    return await acao();
  } catch (e) {
    if (!(e instanceof ErroLogin)) avisar(e.message, 'erro');
    return undefined;
  }
}

/** Mostra o resultado da impressão de forma simples. */
function avisarImpressao(impressao, textoOk) {
  if (!impressao) return avisar(textoOk);
  if (impressao.status === 'erro') {
    avisar(`⚠️ A impressora NÃO imprimiu. ${impressao.erro || ''}`, 'erro', 7000);
  } else if (impressao.status === 'desligada') {
    avisar(`${textoOk} (impressora desligada nos ajustes)`);
  } else {
    avisar(`${textoOk} 🖨️`);
  }
}

// ================= tamanho da letra =================

const TAMANHOS = [16, 19, 22, 26, 30];
const NOMES_TAMANHO = ['Pequena', 'Normal', 'Grande', 'Muito grande', 'Enorme'];

function tamanhoAtual() {
  try {
    const n = parseInt(localStorage.getItem('tamanhoLetra'), 10);
    if (n >= 0 && n < TAMANHOS.length) return n;
  } catch { /* sem armazenamento */ }
  return 2;
}

function mudarTamanho(n) {
  const novo = Math.max(0, Math.min(TAMANHOS.length - 1, n));
  document.documentElement.style.fontSize = `${TAMANHOS[novo]}px`;
  try { localStorage.setItem('tamanhoLetra', String(novo)); } catch { /* ok */ }
  $('#letra-menos').disabled = novo === 0;
  $('#letra-mais').disabled = novo === TAMANHOS.length - 1;
  document.dispatchEvent(new CustomEvent('tamanho-letra', { detail: novo }));
  return novo;
}

$('#letra-menos').addEventListener('click', () => {
  const n = mudarTamanho(tamanhoAtual() - 1);
  avisar(`Letra: ${NOMES_TAMANHO[n]}`, 'ok', 1200);
});
$('#letra-mais').addEventListener('click', () => {
  const n = mudarTamanho(tamanhoAtual() + 1);
  avisar(`Letra: ${NOMES_TAMANHO[n]}`, 'ok', 1200);
});
mudarTamanho(tamanhoAtual());

// ================= janelas (modal) =================

function modal({ titulo, corpo = [], botoes }) {
  return new Promise((resolver) => {
    const fundo = $('#modal');
    const fechar = (valor) => {
      fundo.hidden = true;
      fundo.replaceChildren();
      document.removeEventListener('keydown', tecla);
      resolver(valor);
    };
    const tecla = (e) => { if (e.key === 'Escape') fechar(undefined); };
    const caixa = h('div', { class: 'modal-caixa', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo },
      h('h2', null, titulo),
      corpo,
      h('div', { class: 'modal-botoes' }, botoes.map((b) => h('button', {
        type: 'button',
        class: `botao ${b.classe || ''}`,
        onclick: async () => {
          const valor = b.valor === undefined ? true : b.valor;
          if (b.antes) {
            const ok = await b.antes();
            if (ok === false) return;
          }
          fechar(typeof valor === 'function' ? valor() : valor);
        },
      }, b.texto))),
    );
    fundo.replaceChildren(caixa);
    fundo.hidden = false;
    fundo.onclick = (e) => { if (e.target === fundo) fechar(undefined); };
    document.addEventListener('keydown', tecla);
    const primeiro = caixa.querySelector('input, textarea');
    if (primeiro) setTimeout(() => primeiro.focus(), 50);
  });
}

const confirmar = (titulo, texto, { sim = 'Sim', nao = 'Não', perigo = false } = {}) =>
  modal({
    titulo,
    corpo: texto ? [h('p', null, texto)] : [],
    botoes: [
      { texto: sim, classe: perigo ? 'perigo' : '', valor: true },
      { texto: nao, classe: 'secundario', valor: false },
    ],
  }).then((v) => v === true);

/** Pede um valor em dinheiro (e, opcionalmente, uma descrição). */
function pedirValor({ titulo, rotulo = 'Valor (R$)', inicial = '', comDescricao = false, rotuloDescricao = 'O que foi? (opcional)', atalhos = [] }) {
  const campoValor = h('input', { type: 'text', inputmode: 'decimal', placeholder: '0,00', value: inicial, autocomplete: 'off' });
  const campoDesc = h('input', { type: 'text', maxlength: '200', autocomplete: 'off' });
  const corpo = [
    h('label', { class: 'campo' }, h('span', null, rotulo), campoValor),
    atalhos.length ? h('div', { class: 'escolhas', style: 'margin-bottom:1rem' }, atalhos.map((a) =>
      h('button', { type: 'button', class: 'escolha', onclick: () => { campoValor.value = paraCampo(a.valor); } }, a.texto))) : null,
    comDescricao ? h('label', { class: 'campo' }, h('span', null, rotuloDescricao), campoDesc) : null,
  ];
  return modal({
    titulo,
    corpo,
    botoes: [
      {
        texto: '✓ Confirmar',
        antes: () => {
          const v = lerDinheiro(campoValor.value);
          if (!v) { avisar('Digite um valor. Exemplo: 12,50', 'erro'); campoValor.focus(); return false; }
          return true;
        },
        valor: () => ({ valor: lerDinheiro(campoValor.value), descricao: campoDesc.value.trim() }),
      },
      { texto: 'Cancelar', classe: 'secundario', valor: null },
    ],
  });
}

function pedirTexto({ titulo, rotulo, inicial = '', dica = '', max = 120 }) {
  const campo = h('input', { type: 'text', value: inicial, maxlength: String(max), autocomplete: 'off' });
  return modal({
    titulo,
    corpo: [h('label', { class: 'campo' }, h('span', null, rotulo), campo, dica ? h('small', null, dica) : null)],
    botoes: [
      { texto: '✓ Confirmar', valor: () => campo.value.trim() },
      { texto: 'Cancelar', classe: 'secundario', valor: null },
    ],
  });
}

// ================= navegação =================

let estado = { nome: 'Comanda Fácil' };
let limparTela = null;

const rotas = [
  [/^#?\/?$/, telaInicio],
  [/^#\/pedidos$/, telaPedidos],
  [/^#\/pedido\/novo$/, telaNovoPedido],
  [/^#\/pedido\/(\d+)$/, telaPedido],
  [/^#\/pedido\/(\d+)\/adicionar$/, telaAdicionar],
  [/^#\/pedido\/(\d+)\/fechar$/, telaFechar],
  [/^#\/produtos$/, telaProdutos],
  [/^#\/produto\/(novo|\d+)$/, telaProduto],
  [/^#\/fiado$/, telaFiado],
  [/^#\/cliente\/(novo|\d+)\/editar$/, telaEditarCliente],
  [/^#\/cliente\/novo$/, () => telaEditarCliente('novo')],
  [/^#\/cliente\/(\d+)$/, telaCliente],
  [/^#\/vendas$/, telaVendas],
  [/^#\/impressoes$/, telaImpressoes],
  [/^#\/ajustes$/, telaAjustes],
];

function ir(destino) {
  if (location.hash === destino) mostrar();
  else location.hash = destino;
}

async function mostrar() {
  if (limparTela) { limparTela(); limparTela = null; }
  const hash = location.hash || '#/';
  const encontrada = rotas.find(([re]) => re.test(hash)) || rotas[0];
  const params = hash.match(encontrada[0]).slice(1);
  const main = $('#tela');
  main.replaceChildren(h('p', { class: 'carregando' }, 'Carregando…'));
  try {
    const tela = await encontrada[1](...params);
    if (!tela) return;
    $('#titulo').textContent = tela.titulo || estado.nome;
    document.title = tela.titulo ? `${tela.titulo} · ${estado.nome}` : estado.nome;
    const voltar = $('#voltar');
    voltar.hidden = !tela.voltar;
    voltar.onclick = () => ir(tela.voltar);
    main.replaceChildren(...[].concat(tela.conteudo).flat(Infinity).filter((x) => x != null && x !== false));
    limparTela = tela.limpar || null;
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  } catch (e) {
    if (e instanceof ErroLogin) return;
    main.replaceChildren(
      h('div', { class: 'alerta' }, h('span', null, e.message)),
      h('button', { class: 'botao', type: 'button', onclick: mostrar }, '↻ Tentar de novo'),
      h('div', { class: 'pilha' }, h('a', { class: 'botao secundario', href: '#/' }, '🏠 Voltar ao início')),
    );
  }
}

window.addEventListener('hashchange', mostrar);

// ================= entrar =================

function telaLogin() {
  $('#voltar').hidden = true;
  $('#titulo').textContent = estado.nome;
  const senha = h('input', { type: 'password', autocomplete: 'current-password', id: 'senha' });
  const form = h('form', {
    class: 'cartao',
    onsubmit: async (e) => {
      e.preventDefault();
      await tentar(async () => {
        await api('POST', '/entrar', { senha: senha.value });
        await iniciar();
      });
    },
  },
  h('h2', { style: 'margin-top:0' }, '🔒 Entrar'),
  h('label', { class: 'campo' }, h('span', null, 'Senha'), senha),
  h('button', { class: 'botao', type: 'submit' }, 'Entrar'));
  $('#tela').replaceChildren(form);
  senha.focus();
}

function telaPrimeiroAcesso() {
  $('#voltar').hidden = true;
  $('#titulo').textContent = 'Bem-vinda!';
  const nome = h('input', { type: 'text', value: '', placeholder: 'Ex.: Bar da Dona Maria', maxlength: '60' });
  const senha = h('input', { type: 'password', autocomplete: 'new-password' });
  const repetir = h('input', { type: 'password', autocomplete: 'new-password' });
  const form = h('form', {
    class: 'cartao',
    onsubmit: async (e) => {
      e.preventDefault();
      if (senha.value !== repetir.value) return avisar('As duas senhas não são iguais.', 'erro');
      await tentar(async () => {
        await api('POST', '/configurar', { nome: nome.value.trim() || 'Meu Bar', senha: senha.value });
        avisar('Pronto! Sistema configurado.');
        await iniciar();
      });
      return undefined;
    },
  },
  h('h2', { style: 'margin-top:0' }, 'Primeiro acesso'),
  h('p', { class: 'suave' }, 'Vamos dar um nome e criar uma senha. Você só precisa fazer isso uma vez.'),
  h('label', { class: 'campo' }, h('span', null, 'Nome do bar ou restaurante'), nome),
  h('label', { class: 'campo' }, h('span', null, 'Crie uma senha'), senha, h('small', null, 'Pelo menos 4 letras ou números.')),
  h('label', { class: 'campo' }, h('span', null, 'Repita a senha'), repetir),
  h('button', { class: 'botao', type: 'submit' }, '✓ Começar'));
  $('#tela').replaceChildren(form);
}

// ================= início =================

async function telaInicio() {
  const r = await api('GET', '/resumo');
  const conteudo = [];
  if (r.problemas_impressao > 0) {
    conteudo.push(h('div', { class: 'alerta' },
      h('span', null, `⚠️ A impressora não imprimiu ${r.problemas_impressao === 1 ? '1 pedido' : `${r.problemas_impressao} pedidos`}.`),
      h('a', { class: 'botao pequeno perigo', href: '#/impressoes' }, 'Ver')));
  }
  conteudo.push(
    h('div', { class: 'destaques' },
      h('div', { class: 'destaque' }, h('div', { class: 'rotulo' }, 'Vendido hoje'), h('div', { class: 'valor' }, reais(r.vendido_hoje))),
      h('div', { class: 'destaque' }, h('div', { class: 'rotulo' }, 'Fiado a receber'), h('div', { class: 'valor' }, reais(r.fiado_a_receber)))),
    h('nav', { class: 'menu', 'aria-label': 'Menu principal' },
      h('a', { class: 'principal', href: '#/pedido/novo' }, h('span', { class: 'icone' }, '➕'), 'Novo pedido'),
      h('a', { href: '#/pedidos' }, h('span', { class: 'icone' }, '🍽️'), 'Pedidos abertos',
        r.pedidos_abertos ? h('span', { class: 'contador' }, r.pedidos_abertos) : null),
      h('a', { href: '#/fiado' }, h('span', { class: 'icone' }, '📒'), 'Fiado'),
      h('a', { href: '#/produtos' }, h('span', { class: 'icone' }, '🍺'), 'Produtos'),
      h('a', { href: '#/vendas' }, h('span', { class: 'icone' }, '💰'), 'Vendas'),
      h('a', { href: '#/ajustes' }, h('span', { class: 'icone' }, '⚙️'), 'Ajustes')),
  );
  return { titulo: estado.nome, conteudo };
}

// ================= pedidos =================

async function telaPedidos() {
  const pedidos = await api('GET', '/pedidos');
  const lista = pedidos.length
    ? h('ul', { class: 'lista' }, pedidos.map((p) => h('li', null,
      h('a', { class: `linha ${p.falta_enviar ? 'atencao' : ''}`, href: `#/pedido/${p.id}` },
        h('div', { class: 'principal' },
          h('div', { class: 'nome' }, p.identificacao || `Pedido ${p.id}`),
          h('div', { class: 'detalhe' }, `${p.qtd_itens} ${p.qtd_itens === 1 ? 'item' : 'itens'} · desde ${horaDe(p.aberto_em)}`),
          p.falta_enviar ? h('span', { class: 'etiqueta alerta-leve' }, '⏳ falta mandar p/ cozinha') : null),
        h('div', { class: 'valor' }, reais(p.total)),
        h('span', { class: 'seta', 'aria-hidden': 'true' }, '›')))))
    : h('p', { class: 'centro suave' }, 'Nenhum pedido aberto agora.');
  return {
    titulo: 'Pedidos abertos',
    voltar: '#/',
    conteudo: [h('div', { class: 'pilha', style: 'margin-top:0' }, h('a', { class: 'botao', href: '#/pedido/novo' }, '➕ Novo pedido')), lista],
  };
}

async function telaNovoPedido() {
  const [abertos, ajustes] = await Promise.all([api('GET', '/pedidos'), api('GET', '/ajustes')]);
  const porNome = new Map(abertos.map((p) => [p.identificacao.toLowerCase(), p.id]));

  async function comecar(identificacao) {
    const existente = identificacao && porNome.get(identificacao.toLowerCase());
    if (existente) return ir(`#/pedido/${existente}`);
    const p = await tentar(() => api('POST', '/pedidos', { identificacao }));
    if (p) ir(`#/pedido/${p.id}/adicionar`);
    return undefined;
  }

  const botaoRapido = (nome) => {
    const aberto = porNome.has(nome.toLowerCase());
    return h('button', { type: 'button', class: 'escolha', 'aria-pressed': aberto ? 'true' : 'false', onclick: () => comecar(nome) },
      nome, aberto ? h('div', { style: 'font-size:0.8em' }, '(aberta)') : null);
  };

  const mesas = Array.from({ length: Number(ajustes.mesas) || 0 }, (_, i) => `Mesa ${i + 1}`);
  const campo = h('input', { type: 'text', maxlength: '40', placeholder: 'Ex.: João, Mesa 3…', autocomplete: 'off' });
  return {
    titulo: 'Novo pedido',
    voltar: '#/',
    conteudo: [
      h('h2', { style: 'margin-top:0' }, 'Para quem é?'),
      h('div', { class: 'escolhas' }, botaoRapido('Balcão'), mesas.map(botaoRapido)),
      h('form', {
        class: 'cartao',
        style: 'margin-top:1rem',
        onsubmit: (e) => { e.preventDefault(); comecar(campo.value.trim()); },
      },
      h('label', { class: 'campo' }, h('span', null, 'Ou escreva um nome'), campo),
      h('button', { class: 'botao', type: 'submit' }, 'Começar pedido')),
      h('button', { class: 'botao secundario', type: 'button', onclick: () => comecar('') }, 'Começar sem nome'),
    ],
  };
}

function etiquetaCozinha(item) {
  if (!item.vai_cozinha) return null;
  if (item.enviada >= item.quantidade) return h('span', { class: 'etiqueta' }, '✓ na cozinha');
  if (item.enviada > 0) return h('span', { class: 'etiqueta alerta-leve' }, `⏳ ${item.quantidade - item.enviada} para mandar`);
  return h('span', { class: 'etiqueta alerta-leve' }, '⏳ falta mandar');
}

async function telaPedido(id) {
  const p = await api('GET', `/pedidos/${id}`);
  const nome = p.identificacao || `Pedido ${p.id}`;

  if (p.status !== 'aberto') {
    const situacao = p.status === 'cancelado' ? '❌ Cancelado' : `✓ Pago no ${NOMES_FORMA[p.forma_pagamento]}${p.cliente_nome ? ` — ${p.cliente_nome}` : ''}`;
    return {
      titulo: nome,
      voltar: '#/vendas',
      conteudo: [
        h('div', { class: 'cartao' },
          h('div', { class: 'nome', style: 'font-size:1.3rem;font-weight:800' }, situacao),
          h('div', { class: 'suave' }, `Aberto ${dataHora(p.aberto_em)}`),
          p.fechado_em ? h('div', { class: 'suave' }, `Fechado ${dataHora(p.fechado_em)}`) : null),
        h('ul', { class: 'lista' }, p.itens.map((i) => h('li', { class: 'linha' },
          h('div', { class: 'principal' }, h('div', { class: 'nome' }, `${i.quantidade}x ${i.nome}`), i.obs ? h('div', { class: 'detalhe' }, i.obs) : null),
          h('div', { class: 'valor' }, reais(i.preco * i.quantidade))))),
        h('div', { class: 'total-grande' }, h('span', null, 'Total'), h('strong', null, reais(p.total))),
      ],
    };
  }

  async function atualizarItem(item, dados) {
    const r = await tentar(() => api(dados === null ? 'DELETE' : 'PUT', `/itens/${item.id}`, dados ?? undefined));
    if (r) {
      if (r.impressao) avisarImpressao(r.impressao, 'Aviso de cancelamento enviado para a cozinha');
      mostrar();
    }
  }

  async function diminuir(item) {
    if (item.quantidade > 1) return atualizarItem(item, { quantidade: item.quantidade - 1 });
    const naCozinha = item.vai_cozinha && item.enviada > 0;
    const ok = await confirmar(`Tirar "${item.nome}" do pedido?`,
      naCozinha ? 'Esse item já foi para a cozinha. Vai sair um papel avisando para NÃO fazer.' : '',
      { sim: 'Sim, tirar', perigo: true });
    if (ok) await atualizarItem(item, null);
    return undefined;
  }

  async function observacao(item) {
    const obs = await pedirTexto({ titulo: item.nome, rotulo: 'Observação para a cozinha', inicial: item.obs, dica: 'Ex.: sem cebola, bem passado, para viagem' });
    if (obs !== null && obs !== undefined) await atualizarItem(item, { obs });
  }

  async function renomear() {
    const novo = await pedirTexto({ titulo: 'Mesa ou nome do pedido', rotulo: 'Mesa ou nome', inicial: p.identificacao, max: 40 });
    if (novo === null || novo === undefined) return;
    if (await tentar(() => api('PUT', `/pedidos/${p.id}`, { identificacao: novo }))) mostrar();
  }

  async function enviar() {
    const r = await tentar(() => api('POST', `/pedidos/${p.id}/enviar`));
    if (r) {
      avisarImpressao(r.impressao, '✓ Mandado para a cozinha');
      mostrar();
    }
  }

  async function cancelar() {
    const ok = await confirmar('Cancelar este pedido inteiro?', 'O pedido some da lista e não conta nas vendas.', { sim: 'Sim, cancelar pedido', nao: 'Não, voltar', perigo: true });
    if (!ok) return;
    const r = await tentar(() => api('POST', `/pedidos/${p.id}/cancelar`));
    if (r) {
      avisarImpressao(r.impressao?.status ? r.impressao : null, 'Pedido cancelado');
      ir('#/pedidos');
    }
  }

  const itens = p.itens.length
    ? h('ul', { class: 'lista' }, p.itens.map((i) => h('li', { class: 'item' },
      h('div', { class: 'topo-item' },
        h('div', { class: 'nome' }, i.nome, i.obs ? h('div', { class: 'obs' }, `» ${i.obs}`) : null),
        h('div', { class: 'valor' }, reais(i.preco * i.quantidade))),
      h('div', { class: 'controles' },
        h('div', { class: 'quantidade' },
          h('button', { type: 'button', 'aria-label': `Tirar um ${i.nome}`, onclick: () => diminuir(i) }, '−'),
          h('output', null, i.quantidade),
          h('button', { type: 'button', 'aria-label': `Mais um ${i.nome}`, onclick: () => atualizarItem(i, { quantidade: i.quantidade + 1 }) }, '+')),
        h('button', { type: 'button', class: 'botao secundario pequeno', onclick: () => observacao(i) }, '✏️ Obs.'),
        etiquetaCozinha(i)))))
    : h('p', { class: 'centro suave' }, 'Ainda não tem nada neste pedido.');

  return {
    titulo: nome,
    voltar: '#/pedidos',
    conteudo: [
      h('div', { class: 'cabeca-pedido' },
        h('div', { class: 'nome' }, nome),
        h('button', { type: 'button', class: 'botao secundario pequeno', onclick: renomear }, '✏️ Trocar nome')),
      h('p', { class: 'suave' }, `Pedido ${p.id} · aberto às ${horaDe(p.aberto_em)}`),
      h('div', { class: 'pilha' }, h('a', { class: 'botao azul', href: `#/pedido/${p.id}/adicionar` }, '➕ Adicionar produto')),
      itens,
      h('div', { class: 'total-grande' }, h('span', null, 'Total'), h('strong', null, reais(p.total))),
      h('div', { class: 'pilha' },
        h('button', { type: 'button', class: 'botao amarelo', disabled: !p.falta_enviar, onclick: enviar },
          p.falta_enviar ? `🔔 Mandar para a cozinha (${p.falta_enviar})` : '✓ Cozinha já recebeu tudo'),
        h('a', { class: 'botao', href: `#/pedido/${p.id}/fechar`, onclick: (e) => { if (!p.itens.length) { e.preventDefault(); avisar('O pedido está vazio.', 'erro'); } } }, '💰 Fechar a conta'),
        h('button', { type: 'button', class: 'botao perigo-leve', onclick: cancelar }, '🗑️ Cancelar pedido')),
    ],
  };
}

async function telaAdicionar(id) {
  const [p, produtos] = await Promise.all([api('GET', `/pedidos/${id}`), api('GET', '/produtos')]);
  if (p.status !== 'aberto') { ir(`#/pedido/${id}`); return null; }
  const nome = p.identificacao || `Pedido ${p.id}`;
  const noPedido = new Map();
  for (const i of p.itens) if (i.produto_id) noPedido.set(i.produto_id, (noPedido.get(i.produto_id) || 0) + i.quantidade);
  let total = p.total;
  let categoria = '';
  let busca = '';

  const categorias = [...new Set(produtos.map((x) => x.categoria).filter(Boolean))];
  const grade = h('div', { class: 'produtos' });
  const rodape = h('a', { class: 'botao', href: `#/pedido/${id}` });
  const atualizarRodape = () => {
    const qtd = [...noPedido.values()].reduce((s, n) => s + n, 0);
    rodape.textContent = `✓ Pronto — ver pedido (${qtd} ${qtd === 1 ? 'item' : 'itens'} · ${reais(total)})`;
  };

  async function adicionar(produto, botao) {
    botao.disabled = true;
    const r = await tentar(() => api('POST', `/pedidos/${id}/itens`, { produto_id: produto.id }));
    botao.disabled = false;
    if (!r) return;
    noPedido.set(produto.id, (noPedido.get(produto.id) || 0) + 1);
    total = r.total;
    avisar(`+1 ${produto.nome}`, 'ok', 1300);
    desenhar();
  }

  function desenhar() {
    const termo = busca.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const visiveis = produtos.filter((x) => (!categoria || x.categoria === categoria)
      && (!termo || x.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(termo)));
    grade.replaceChildren(...(visiveis.length ? visiveis.map((x) => {
      const qtd = noPedido.get(x.id);
      const botao = h('button', { type: 'button', class: 'produto', 'aria-label': `Adicionar ${x.nome}` },
        h('span', { class: 'nome' }, x.nome),
        h('span', { class: 'preco' }, reais(x.preco)),
        qtd ? h('span', { class: 'qtd', 'aria-label': `${qtd} no pedido` }, qtd) : null);
      botao.addEventListener('click', () => adicionar(x, botao));
      return botao;
    }) : [h('p', { class: 'suave', style: 'grid-column:1/-1' }, produtos.length ? 'Nenhum produto com esse nome.' : 'Nenhum produto cadastrado ainda.')]));
    atualizarRodape();
  }

  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Categorias' });
  const desenharChips = () => chips.replaceChildren(...['', ...categorias].map((c) => h('button', {
    type: 'button',
    'aria-pressed': String(c === categoria),
    onclick: () => { categoria = c; desenharChips(); desenhar(); },
  }, c || 'Tudo')));
  desenharChips();

  const campoBusca = h('input', { type: 'search', placeholder: '🔍 Procurar produto…', autocomplete: 'off', oninput: (e) => { busca = e.target.value; desenhar(); } });
  desenhar();

  return {
    titulo: `Adicionar — ${nome}`,
    voltar: `#/pedido/${id}`,
    conteudo: [
      h('p', { class: 'suave', style: 'margin-top:0' }, 'Toque no produto para colocar no pedido. Cada toque = 1 unidade.'),
      h('div', { style: 'margin-bottom:0.6rem' }, campoBusca),
      categorias.length ? chips : null,
      grade,
      produtos.length ? null : h('div', { class: 'pilha' }, h('a', { class: 'botao secundario', href: '#/produto/novo' }, '➕ Cadastrar produto')),
      h('div', { class: 'barra-fixa' }, rodape),
    ],
  };
}

async function telaFechar(id) {
  const p = await api('GET', `/pedidos/${id}`);
  if (p.status !== 'aberto') { ir(`#/pedido/${id}`); return null; }
  const nome = p.identificacao || `Pedido ${p.id}`;
  const area = h('div');

  async function fechar(forma, clienteId) {
    const r = await tentar(() => api('POST', `/pedidos/${id}/fechar`, { forma, cliente_id: clienteId }));
    if (!r) return;
    if (r.impressao && r.impressao.status === 'erro') avisarImpressao(r.impressao, '');
    avisar(`✓ Conta fechada — ${NOMES_FORMA[forma]}${r.cliente_nome ? ` (${r.cliente_nome})` : ''}`);
    ir('#/');
  }

  function escolherForma() {
    area.replaceChildren(
      h('h2', null, 'Como pagou?'),
      h('div', { class: 'formas' }, ['dinheiro', 'pix', 'cartao', 'fiado'].map((f) => h('button', {
        type: 'button',
        class: `botao ${f === 'fiado' ? 'secundario' : ''}`,
        onclick: () => {
          if (f === 'dinheiro') return dinheiro();
          if (f === 'fiado') return fiado();
          return confirmar(`Pago no ${NOMES_FORMA[f]}?`, `Total: ${reais(p.total)}`, { sim: '✓ Sim, fechar conta' }).then((ok) => ok && fechar(f));
        },
      }, h('span', { class: 'icone' }, ICONES_FORMA[f]), NOMES_FORMA[f]))));
  }

  function dinheiro() {
    const campo = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'Opcional', autocomplete: 'off' });
    const troco = h('div', { class: 'troco' });
    const calcular = () => {
      const v = lerDinheiro(campo.value);
      if (!v) troco.textContent = '';
      else if (v < p.total) troco.textContent = `Faltam ${reais(p.total - v)}`;
      else troco.textContent = `Troco: ${reais(v - p.total)}`;
    };
    campo.addEventListener('input', calcular);
    const sugestoes = [...new Set([p.total, Math.ceil(p.total / 1000) * 1000, Math.ceil(p.total / 5000) * 5000, Math.ceil(p.total / 10000) * 10000])];
    area.replaceChildren(
      h('h2', null, '💵 Dinheiro'),
      h('label', { class: 'campo' }, h('span', null, 'Quanto o cliente deu? (para calcular o troco)'), campo),
      h('div', { class: 'escolhas' }, sugestoes.map((v) => h('button', { type: 'button', class: 'escolha', onclick: () => { campo.value = paraCampo(v); calcular(); } }, reais(v)))),
      troco,
      h('div', { class: 'pilha' },
        h('button', { type: 'button', class: 'botao', onclick: () => fechar('dinheiro') }, '✓ Fechar conta'),
        h('button', { type: 'button', class: 'botao secundario', onclick: escolherForma }, '‹ Escolher outra forma')),
    );
    campo.focus();
  }

  async function fiado() {
    const clientes = await tentar(() => api('GET', '/clientes'));
    if (!clientes) return;
    const lista = h('ul', { class: 'lista' });
    const desenhar = (termo) => {
      const t = termo.toLowerCase();
      const visiveis = clientes.filter((c) => !t || c.nome.toLowerCase().includes(t));
      lista.replaceChildren(...visiveis.map((c) => h('li', null, h('button', {
        type: 'button',
        class: 'linha',
        onclick: async () => {
          const ok = await confirmar(`Anotar no fiado de ${c.nome}?`, `${reais(p.total)} vão para o caderninho.`, { sim: '✓ Sim, anotar' });
          if (ok) fechar('fiado', c.id);
        },
      }, h('div', { class: 'principal' }, h('div', { class: 'nome' }, c.nome),
        c.saldo > 0 ? h('div', { class: 'detalhe devendo' }, `Já deve ${reais(c.saldo)}`) : null),
      h('span', { class: 'seta' }, '›')))));
      if (!visiveis.length) lista.append(h('li', { class: 'suave centro' }, 'Ninguém com esse nome.'));
    };
    const busca = h('input', { type: 'search', placeholder: '🔍 Procurar cliente…', autocomplete: 'off', oninput: (e) => desenhar(e.target.value) });
    async function novoCliente() {
      const nomeCliente = await pedirTexto({ titulo: 'Novo cliente', rotulo: 'Nome do cliente', inicial: busca.value, max: 80 });
      if (!nomeCliente) return;
      const c = await tentar(() => api('POST', '/clientes', { nome: nomeCliente }));
      if (c) fechar('fiado', c.id);
    }
    area.replaceChildren(
      h('h2', null, '📒 Fiado — quem vai ficar devendo?'),
      h('div', { style: 'margin-bottom:0.6rem' }, busca),
      h('div', { class: 'pilha', style: 'margin-top:0' }, h('button', { type: 'button', class: 'botao secundario', onclick: novoCliente }, '➕ Cliente novo')),
      lista,
      h('div', { class: 'pilha' }, h('button', { type: 'button', class: 'botao secundario', onclick: escolherForma }, '‹ Escolher outra forma')),
    );
    desenhar('');
  }

  escolherForma();
  return {
    titulo: `Fechar — ${nome}`,
    voltar: `#/pedido/${id}`,
    conteudo: [
      h('div', { class: 'total-grande' }, h('span', null, 'Total a pagar'), h('strong', null, reais(p.total))),
      p.falta_enviar ? h('div', { class: 'alerta info' }, h('span', null, `🔔 ${p.falta_enviar} item(ns) ainda não foram para a cozinha. Eles vão ser impressos agora.`)) : null,
      area,
    ],
  };
}

// ================= produtos =================

async function telaProdutos() {
  const produtos = await api('GET', '/produtos?todos=1');
  const ativos = produtos.filter((x) => x.ativo);
  const escondidos = produtos.filter((x) => !x.ativo);
  const grupos = new Map();
  for (const x of ativos) {
    const c = x.categoria || 'Sem categoria';
    if (!grupos.has(c)) grupos.set(c, []);
    grupos.get(c).push(x);
  }
  const linha = (x) => h('li', null, h('a', { class: 'linha', href: `#/produto/${x.id}` },
    h('div', { class: 'principal' }, h('div', { class: 'nome' }, x.nome),
      h('div', { class: 'detalhe' }, x.vai_cozinha ? '🍳 vai para a cozinha' : '🥤 não vai para a cozinha')),
    h('div', { class: 'valor' }, reais(x.preco)),
    h('span', { class: 'seta' }, '›')));
  return {
    titulo: 'Produtos',
    voltar: '#/',
    conteudo: [
      h('div', { class: 'pilha', style: 'margin-top:0' }, h('a', { class: 'botao', href: '#/produto/novo' }, '➕ Novo produto')),
      ativos.length ? null : h('p', { class: 'centro suave' }, 'Nenhum produto cadastrado ainda. Toque em "Novo produto" para começar.'),
      [...grupos].map(([cat, itens]) => [h('h2', null, cat), h('ul', { class: 'lista' }, itens.map(linha))]),
      escondidos.length ? [h('h2', { class: 'suave' }, '🙈 Escondidos (não aparecem no pedido)'), h('ul', { class: 'lista' }, escondidos.map(linha))] : null,
    ],
  };
}

async function telaProduto(id) {
  const novo = id === 'novo';
  const [produto, todos] = await Promise.all([
    novo ? Promise.resolve({ nome: '', preco: 0, categoria: '', vai_cozinha: true, ativo: true }) : api('GET', `/produtos/${id}`),
    api('GET', '/produtos?todos=1'),
  ]);
  const categorias = [...new Set(todos.map((x) => x.categoria).filter(Boolean))];
  let vaiCozinha = produto.vai_cozinha;

  const nome = h('input', { type: 'text', value: produto.nome, maxlength: '80', placeholder: 'Ex.: X-Burguer', autocomplete: 'off' });
  const preco = h('input', { type: 'text', inputmode: 'decimal', value: novo ? '' : paraCampo(produto.preco), placeholder: '0,00', autocomplete: 'off' });
  const categoria = h('input', { type: 'text', value: produto.categoria, maxlength: '40', placeholder: 'Ex.: Lanches, Bebidas, Porções', autocomplete: 'off' });
  const sugestoes = h('div', { class: 'chips' }, categorias.map((c) => h('button', { type: 'button', onclick: () => { categoria.value = c; } }, c)));

  const escolhaCozinha = h('div', { class: 'escolhas' });
  const desenharCozinha = () => escolhaCozinha.replaceChildren(
    h('button', { type: 'button', class: 'escolha', 'aria-pressed': String(vaiCozinha), onclick: () => { vaiCozinha = true; desenharCozinha(); } }, '🍳 Sim, imprime'),
    h('button', { type: 'button', class: 'escolha', 'aria-pressed': String(!vaiCozinha), onclick: () => { vaiCozinha = false; desenharCozinha(); } }, '🥤 Não precisa'),
  );
  desenharCozinha();

  async function salvar(e) {
    e.preventDefault();
    const valor = lerDinheiro(preco.value);
    if (valor === null) return avisar('Digite o preço. Exemplo: 12,50', 'erro');
    const dados = { nome: nome.value, preco: valor, categoria: categoria.value, vai_cozinha: vaiCozinha };
    const r = await tentar(() => (novo ? api('POST', '/produtos', dados) : api('PUT', `/produtos/${id}`, dados)));
    if (r) {
      avisar(novo ? `✓ ${r.nome} cadastrado` : '✓ Produto salvo');
      ir('#/produtos');
    }
    return undefined;
  }

  async function alternarVisivel() {
    const r = await tentar(() => api('PUT', `/produtos/${id}`, { ativo: !produto.ativo }));
    if (r) {
      avisar(r.ativo ? 'Produto voltou para o cardápio' : 'Produto escondido');
      ir('#/produtos');
    }
  }

  return {
    titulo: novo ? 'Novo produto' : produto.nome,
    voltar: '#/produtos',
    conteudo: h('form', { onsubmit: salvar },
      h('label', { class: 'campo' }, h('span', null, 'Nome'), nome),
      h('label', { class: 'campo' }, h('span', null, 'Preço (R$)'), preco),
      h('label', { class: 'campo' }, h('span', null, 'Categoria (opcional)'), categoria),
      categorias.length ? sugestoes : null,
      h('div', { class: 'campo' }, h('span', null, 'Imprimir na cozinha?'), escolhaCozinha,
        h('small', null, 'Comida normalmente vai para a cozinha. Bebidas e coisas do balcão, não.')),
      h('div', { class: 'pilha' },
        h('button', { class: 'botao', type: 'submit' }, '✓ Salvar'),
        novo ? null : h('button', { class: 'botao secundario', type: 'button', onclick: alternarVisivel },
          produto.ativo ? '🙈 Esconder do cardápio' : '👁️ Mostrar no cardápio de novo'))),
  };
}

// ================= fiado =================

async function telaFiado() {
  const clientes = await api('GET', '/clientes');
  const totalDevido = clientes.reduce((s, c) => s + Math.max(0, c.saldo), 0);
  const lista = h('ul', { class: 'lista' });
  const desenhar = (termo = '') => {
    const t = termo.toLowerCase();
    const visiveis = clientes.filter((c) => !t || c.nome.toLowerCase().includes(t));
    lista.replaceChildren(...visiveis.map((c) => h('li', null, h('a', { class: 'linha', href: `#/cliente/${c.id}` },
      h('div', { class: 'principal' }, h('div', { class: 'nome' }, c.nome),
        c.ultimo_movimento ? h('div', { class: 'detalhe' }, `Último: ${dataDe(c.ultimo_movimento)}`) : null),
      h('div', { class: `valor ${c.saldo > 0 ? 'devendo' : 'em-dia'}` }, c.saldo > 0 ? reais(c.saldo) : (c.saldo < 0 ? `crédito ${reais(-c.saldo)}` : 'em dia')),
      h('span', { class: 'seta' }, '›')))));
    if (!visiveis.length) lista.append(h('li', { class: 'centro suave' }, clientes.length ? 'Ninguém com esse nome.' : 'Nenhum cliente no caderninho ainda.'));
  };
  desenhar();
  return {
    titulo: 'Fiado',
    voltar: '#/',
    conteudo: [
      h('div', { class: 'destaque', style: 'margin-bottom:0.75rem' }, h('div', { class: 'rotulo' }, 'Total a receber'), h('div', { class: 'valor devendo' }, reais(totalDevido))),
      h('div', { class: 'pilha', style: 'margin-top:0' }, h('a', { class: 'botao', href: '#/cliente/novo' }, '➕ Novo cliente')),
      h('div', { style: 'margin-bottom:0.6rem' }, h('input', { type: 'search', placeholder: '🔍 Procurar cliente…', autocomplete: 'off', oninput: (e) => desenhar(e.target.value) })),
      lista,
    ],
  };
}

async function telaCliente(id) {
  const c = await api('GET', `/clientes/${id}`);

  async function anotar() {
    const r = await pedirValor({ titulo: `Anotar fiado — ${c.nome}`, comDescricao: true, rotuloDescricao: 'O que levou? (opcional)' });
    if (!r) return;
    if (await tentar(() => api('POST', `/clientes/${id}/fiado`, r))) { avisar('✓ Anotado no caderninho'); mostrar(); }
  }

  async function receber() {
    const atalhos = c.saldo > 0 ? [{ texto: `Pagou tudo (${reais(c.saldo)})`, valor: c.saldo }] : [];
    const r = await pedirValor({ titulo: `Recebi de ${c.nome}`, rotulo: 'Quanto pagou? (R$)', atalhos });
    if (!r) return;
    if (await tentar(() => api('POST', `/clientes/${id}/pagamento`, { valor: r.valor, descricao: 'Pagamento' }))) { avisar('✓ Pagamento anotado'); mostrar(); }
  }

  async function apagarMovimento(m) {
    if (m.pedido_id) return avisar('Esse fiado veio de um pedido. Para corrigir, lance um pagamento.', 'erro');
    const ok = await confirmar('Apagar este lançamento?', `${m.tipo === 'compra' ? 'Fiado' : 'Pagamento'} de ${reais(m.valor)} em ${dataDe(m.criado_em)}. Use só se foi lançado errado.`, { sim: 'Sim, apagar', perigo: true });
    if (ok && await tentar(() => api('DELETE', `/movimentos/${m.id}`))) { avisar('Lançamento apagado'); mostrar(); }
    return undefined;
  }

  const telefone = c.telefone.replace(/\D/g, '');
  return {
    titulo: c.nome,
    voltar: '#/fiado',
    conteudo: [
      h('div', { class: 'cartao saldo' },
        h('div', { class: 'suave' }, c.saldo > 0 ? 'Está devendo' : (c.saldo < 0 ? 'Tem crédito de' : 'Situação')),
        h('div', { class: `valor ${c.saldo > 0 ? 'devendo' : 'em-dia'}` }, c.saldo === 0 ? 'Em dia ✓' : reais(Math.abs(c.saldo))),
        c.obs ? h('p', { class: 'suave' }, c.obs) : null),
      h('div', { class: 'lado-a-lado' },
        h('button', { type: 'button', class: 'botao perigo', onclick: anotar }, '📝 Anotar fiado'),
        h('button', { type: 'button', class: 'botao', onclick: receber }, '💵 Recebi pagamento')),
      telefone ? h('div', { class: 'lado-a-lado', style: 'margin-top:0.6rem' },
        h('a', { class: 'botao secundario', href: `tel:${telefone}` }, '📞 Ligar'),
        h('a', { class: 'botao secundario', href: `https://wa.me/${telefone.length <= 11 ? `55${telefone}` : telefone}`, target: '_blank', rel: 'noopener' }, '💬 WhatsApp')) : null,
      h('h2', null, 'Histórico'),
      c.movimentos.length
        ? h('ul', { class: 'lista' }, c.movimentos.map((m) => h('li', null, h('button', { type: 'button', class: 'linha movimento', onclick: () => apagarMovimento(m) },
          h('div', { class: 'principal' },
            h('div', { class: 'nome' }, m.tipo === 'compra' ? '📝 Fiado' : '💵 Pagou'),
            m.descricao && m.descricao !== 'Pagamento' ? h('div', { class: 'detalhe' }, m.descricao) : null,
            h('div', { class: 'detalhe' }, dataHora(m.criado_em))),
          h('div', { class: `valor ${m.tipo}` }, `${m.tipo === 'compra' ? '+' : '−'} ${reais(m.valor)}`)))))
        : h('p', { class: 'suave' }, 'Nada anotado ainda.'),
      h('div', { class: 'pilha' }, h('a', { class: 'botao secundario', href: `#/cliente/${id}/editar` }, '✏️ Editar dados do cliente')),
    ],
  };
}

async function telaEditarCliente(id) {
  const novo = id === 'novo';
  const c = novo ? { nome: '', telefone: '', obs: '', saldo: 0 } : await api('GET', `/clientes/${id}`);
  const nome = h('input', { type: 'text', value: c.nome, maxlength: '80', autocomplete: 'off' });
  const telefone = h('input', { type: 'tel', value: c.telefone, maxlength: '30', placeholder: 'Opcional', autocomplete: 'off' });
  const obs = h('textarea', { maxlength: '300', placeholder: 'Opcional. Ex.: vizinho da padaria' });
  obs.value = c.obs;

  async function salvar(e) {
    e.preventDefault();
    const dados = { nome: nome.value, telefone: telefone.value, obs: obs.value };
    const r = await tentar(() => (novo ? api('POST', '/clientes', dados) : api('PUT', `/clientes/${id}`, dados)));
    if (r) { avisar('✓ Cliente salvo'); ir(`#/cliente/${r.id}`); }
  }

  async function apagar() {
    const ok = await confirmar(`Apagar ${c.nome} do caderninho?`, '', { sim: 'Sim, apagar', perigo: true });
    if (ok && await tentar(() => api('DELETE', `/clientes/${id}`))) { avisar('Cliente apagado'); ir('#/fiado'); }
  }

  return {
    titulo: novo ? 'Novo cliente' : `Editar — ${c.nome}`,
    voltar: novo ? '#/fiado' : `#/cliente/${id}`,
    conteudo: h('form', { onsubmit: salvar },
      h('label', { class: 'campo' }, h('span', null, 'Nome'), nome),
      h('label', { class: 'campo' }, h('span', null, 'Telefone'), telefone),
      h('label', { class: 'campo' }, h('span', null, 'Anotações'), obs),
      h('div', { class: 'pilha' },
        h('button', { class: 'botao', type: 'submit' }, '✓ Salvar'),
        !novo && c.saldo === 0 ? h('button', { class: 'botao perigo-leve', type: 'button', onclick: apagar }, '🗑️ Apagar cliente') : null)),
  };
}

// ================= vendas =================

let diaVendas = null;

async function telaVendas() {
  const v = await api('GET', `/vendas${diaVendas ? `?data=${diaVendas}` : ''}`);
  diaVendas = v.data;
  const mudarDia = (delta) => {
    const d = new Date(`${v.data}T12:00:00`);
    d.setDate(d.getDate() + delta);
    diaVendas = d.toISOString().slice(0, 10);
    mostrar();
  };
  const campoData = h('input', { type: 'date', value: v.data, onchange: (e) => { if (e.target.value) { diaVendas = e.target.value; mostrar(); } } });
  const semana = new Date(`${v.data}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long' });

  return {
    titulo: 'Vendas',
    voltar: '#/',
    limpar: () => { if (!location.hash.startsWith('#/pedido/') && location.hash !== '#/vendas') diaVendas = null; },
    conteudo: [
      h('div', { class: 'navega-dia' },
        h('button', { type: 'button', class: 'botao secundario pequeno', 'aria-label': 'Dia anterior', onclick: () => mudarDia(-1) }, '◀'),
        campoData,
        h('button', { type: 'button', class: 'botao secundario pequeno', 'aria-label': 'Dia seguinte', onclick: () => mudarDia(1) }, '▶')),
      h('p', { class: 'centro suave' }, semana),
      h('div', { class: 'cartao' },
        h('table', { class: 'tabela' }, h('tbody', null,
          ['dinheiro', 'pix', 'cartao', 'fiado'].map((f) => h('tr', null,
            h('td', null, `${ICONES_FORMA[f]} ${NOMES_FORMA[f]}${f === 'fiado' ? ' (a receber)' : ''}`),
            h('td', null, reais(v.por_forma[f].total)))),
          h('tr', { class: 'soma' }, h('td', null, `Total vendido (${v.pedidos.length} ${v.pedidos.length === 1 ? 'pedido' : 'pedidos'})`), h('td', null, reais(v.total)))))),
      v.recebido_fiado ? h('div', { class: 'cartao' }, h('table', { class: 'tabela' }, h('tbody', null,
        h('tr', null, h('td', null, '📒 Recebido de fiados'), h('td', null, reais(v.recebido_fiado)))))) : null,
      v.mais_vendidos.length ? [h('h2', null, '🏆 Mais vendidos'), h('div', { class: 'cartao' }, h('table', { class: 'tabela' }, h('tbody', null,
        v.mais_vendidos.map((m) => h('tr', null, h('td', null, `${m.quantidade}x ${m.nome}`), h('td', null, reais(m.total)))))))] : null,
      h('h2', null, 'Pedidos do dia'),
      v.pedidos.length
        ? h('ul', { class: 'lista' }, v.pedidos.map((p) => h('li', null, h('a', { class: 'linha', href: `#/pedido/${p.id}` },
          h('div', { class: 'principal' },
            h('div', { class: 'nome' }, p.identificacao || `Pedido ${p.id}`),
            h('div', { class: 'detalhe' }, `${horaDe(p.fechado_em)} · ${ICONES_FORMA[p.forma_pagamento]} ${NOMES_FORMA[p.forma_pagamento]}${p.cliente_nome ? ` — ${p.cliente_nome}` : ''}`)),
          h('div', { class: 'valor' }, reais(p.total))))))
        : h('p', { class: 'suave centro' }, 'Nenhuma venda neste dia.'),
    ],
  };
}

// ================= impressões =================

async function telaImpressoes() {
  const { problemas, recentes } = await api('GET', '/impressoes');
  async function reimprimir(i) {
    const r = await tentar(() => api('POST', `/impressoes/${i.id}/reimprimir`));
    if (r) { avisarImpressao(r, 'Mandado imprimir de novo'); mostrar(); }
  }
  async function descartar(i) {
    const ok = await confirmar('Esquecer esta impressão?', 'Use quando o pedido já foi resolvido de outro jeito.', { sim: 'Sim, esquecer' });
    if (ok && await tentar(() => api('POST', `/impressoes/${i.id}/descartar`))) mostrar();
  }
  const STATUS = { impresso: '✓ impresso', pendente: '⏳ esperando', erro: '⚠️ erro' };
  return {
    titulo: 'Impressões',
    voltar: '#/',
    conteudo: [
      problemas.length ? [
        h('h2', { style: 'margin-top:0' }, '⚠️ Não imprimiram'),
        h('ul', { class: 'lista' }, problemas.map((i) => h('li', { class: 'cartao' },
          h('div', { class: 'nome', style: 'font-weight:700' }, i.descricao),
          h('div', { class: 'suave' }, `${dataHora(i.criado_em)}${i.erro ? ` — ${i.erro}` : (i.status === 'pendente' ? ' — esperando a impressora' : '')}`),
          h('div', { class: 'lado-a-lado', style: 'margin-top:0.6rem' },
            h('button', { type: 'button', class: 'botao', onclick: () => reimprimir(i) }, '🖨️ Imprimir de novo'),
            h('button', { type: 'button', class: 'botao secundario', onclick: () => descartar(i) }, 'Esquecer'))))),
      ] : h('div', { class: 'alerta info' }, h('span', null, '✓ Nenhum problema com a impressora.')),
      h('h2', null, 'Últimas impressões'),
      recentes.length ? h('ul', { class: 'lista' }, recentes.map((i) => h('li', { class: 'linha' },
        h('div', { class: 'principal' }, h('div', { class: 'nome' }, i.descricao), h('div', { class: 'detalhe' }, dataHora(i.criado_em))),
        h('span', { class: `etiqueta ${i.status === 'impresso' ? '' : 'alerta-leve'}` }, STATUS[i.status]),
        i.status === 'impresso' ? h('button', { type: 'button', class: 'botao secundario pequeno', onclick: () => reimprimir(i) }, '🖨️') : null)))
        : h('p', { class: 'suave' }, 'Nada impresso ainda.'),
      h('div', { class: 'pilha' }, h('a', { class: 'botao secundario', href: '#/ajustes' }, '⚙️ Ajustes da impressora')),
    ],
  };
}

// ================= ajustes =================

async function telaAjustes() {
  const a = await api('GET', '/ajustes');

  // tamanho da letra
  const tamanhos = h('div', { class: 'tamanhos' });
  const desenharTamanhos = () => {
    const atual = tamanhoAtual();
    tamanhos.replaceChildren(...TAMANHOS.map((px, n) => h('button', {
      type: 'button',
      class: 'escolha',
      'aria-pressed': String(n === atual),
      onclick: () => mudarTamanho(n),
    }, h('span', { style: `font-size:${px}px;font-weight:800` }, 'Aa'), h('small', null, NOMES_TAMANHO[n]))));
  };
  desenharTamanhos();
  document.addEventListener('tamanho-letra', desenharTamanhos);

  // estabelecimento
  const nome = h('input', { type: 'text', value: a.nome_estabelecimento, maxlength: '60' });
  const mesas = h('input', { type: 'number', min: '0', max: '60', value: a.mesas, inputmode: 'numeric' });

  // impressora
  let modo = a.impressora_modo;
  const host = h('input', { type: 'text', value: a.impressora_host, placeholder: 'Ex.: 192.168.0.50', inputmode: 'decimal', autocomplete: 'off' });
  const porta = h('input', { type: 'number', value: a.impressora_porta, inputmode: 'numeric' });
  const largura = h('select', null,
    h('option', { value: '48' }, 'Papel 80mm (48 letras por linha)'),
    h('option', { value: '42' }, 'Papel 80mm (42 letras por linha)'),
    h('option', { value: '32' }, 'Papel 58mm (32 letras por linha)'));
  largura.value = a.impressora_largura;
  const acentos = h('select', null,
    h('option', { value: 'remover' }, 'Imprimir sem acento (funciona em todas)'),
    h('option', { value: 'cp860' }, 'Imprimir com acento (tabela PC860)'));
  acentos.value = a.impressora_acentos;
  const codepage = h('input', { type: 'number', value: a.impressora_codepage, min: '0', max: '255', inputmode: 'numeric' });

  const detalhesRede = h('div', null,
    h('label', { class: 'campo' }, h('span', null, 'Endereço (IP) da impressora'), host,
      h('small', null, 'Aparece na folhinha que a impressora imprime quando liga segurando o botão FEED.')),
    h('label', { class: 'campo' }, h('span', null, 'Porta'), porta, h('small', null, 'Quase sempre é 9100.')));

  const visto = a.agente_visto_em ? (Date.parse(a.agora.replace(' ', 'T')) - Date.parse(a.agente_visto_em.replace(' ', 'T'))) / 1000 : null;
  const detalhesAgente = h('div', null,
    h('div', { class: `alerta ${visto !== null && visto < 30 ? 'info' : ''}` }, h('span', null,
      visto === null ? '❌ O programa da impressora nunca se conectou.'
        : visto < 30 ? '✓ O programa da impressora está conectado.'
          : `⚠️ O programa da impressora não aparece desde ${dataHora(a.agente_visto_em)}.`)),
    h('p', null, 'Código do programa da impressora (coloque no computador do restaurante):'),
    h('p', { class: 'codigo' }, a.token_agente),
    h('button', {
      type: 'button',
      class: 'botao secundario pequeno',
      onclick: async () => {
        const ok = await confirmar('Gerar um código novo?', 'O programa da impressora vai parar até você colocar o código novo nele.', { sim: 'Sim, gerar' });
        if (ok && await tentar(() => api('POST', '/ajustes/novo-token'))) mostrar();
      },
    }, 'Gerar código novo'));

  const escolhaModo = h('div', { class: 'escolhas' });
  const desenharModo = () => {
    escolhaModo.replaceChildren(...[['desligada', '🚫 Sem impressora'], ['rede', '🌐 Impressora de rede'], ['agente', '💻 Por um computador']].map(([v, t]) =>
      h('button', { type: 'button', class: 'escolha', 'aria-pressed': String(modo === v), onclick: () => { modo = v; desenharModo(); } }, t)));
    detalhesRede.hidden = modo !== 'rede';
    detalhesAgente.hidden = modo !== 'agente';
    extras.hidden = modo === 'desligada';
  };
  const extras = h('div', null,
    h('label', { class: 'campo' }, h('span', null, 'Tamanho do papel'), largura),
    h('label', { class: 'campo' }, h('span', null, 'Acentos'), acentos),
    h('label', { class: 'campo' }, h('span', null, 'Número da tabela PC860 (só se escolher "com acento")'), codepage,
      h('small', null, 'Epson e a maioria: 3. Se sair caractere estranho, volte para "sem acento".')));
  desenharModo();

  async function salvar() {
    const r = await tentar(() => api('PUT', '/ajustes', {
      nome_estabelecimento: nome.value,
      mesas: Number(mesas.value || 0),
      impressora_modo: modo,
      impressora_host: host.value.trim(),
      impressora_porta: Number(porta.value || 9100),
      impressora_largura: largura.value,
      impressora_acentos: acentos.value,
      impressora_codepage: Number(codepage.value || 3),
    }));
    if (r) {
      estado.nome = r.nome_estabelecimento;
      avisar('✓ Ajustes salvos');
      return true;
    }
    return false;
  }

  async function testar() {
    if (!(await salvar())) return;
    const r = await tentar(() => api('POST', '/ajustes/teste-impressao'));
    if (r) avisarImpressao(r, r.status === 'pendente' ? 'Teste enviado — esperando o computador da impressora' : '✓ Teste impresso');
  }

  async function trocarSenha() {
    const atual = h('input', { type: 'password', autocomplete: 'current-password' });
    const nova = h('input', { type: 'password', autocomplete: 'new-password' });
    const r = await modal({
      titulo: 'Trocar senha',
      corpo: [h('label', { class: 'campo' }, h('span', null, 'Senha atual'), atual), h('label', { class: 'campo' }, h('span', null, 'Senha nova'), nova)],
      botoes: [{ texto: '✓ Trocar', valor: () => ({ atual: atual.value, nova: nova.value }) }, { texto: 'Cancelar', classe: 'secundario', valor: null }],
    });
    if (r && await tentar(() => api('POST', '/senha', r))) avisar('✓ Senha trocada. Outros celulares vão precisar entrar de novo.');
  }

  async function sair() {
    if (await confirmar('Sair deste celular?', 'Vai precisar da senha para entrar de novo.', { sim: 'Sim, sair' })) {
      await tentar(() => api('POST', '/sair'));
      telaLogin();
    }
  }

  return {
    titulo: 'Ajustes',
    voltar: '#/',
    limpar: () => document.removeEventListener('tamanho-letra', desenharTamanhos),
    conteudo: [
      h('h2', { style: 'margin-top:0' }, '🔠 Tamanho da letra'),
      h('div', { class: 'cartao' }, tamanhos, h('p', { class: 'suave' }, 'Também dá para mudar a qualquer hora nos botões A− e A+ lá em cima.')),
      h('h2', null, '🏠 Estabelecimento'),
      h('div', { class: 'cartao' },
        h('label', { class: 'campo' }, h('span', null, 'Nome'), nome),
        h('label', { class: 'campo' }, h('span', null, 'Quantas mesas?'), mesas, h('small', null, 'Aparecem como botões na hora de começar um pedido. Coloque 0 para esconder.'))),
      h('h2', null, '🖨️ Impressora da cozinha'),
      h('div', { class: 'cartao' },
        h('div', { class: 'campo' }, h('span', null, 'Como a impressora está ligada?'), escolhaModo),
        detalhesRede, detalhesAgente, extras),
      h('div', { class: 'pilha' },
        h('button', { type: 'button', class: 'botao', onclick: salvar }, '✓ Salvar ajustes'),
        h('button', { type: 'button', class: 'botao azul', onclick: testar }, '🖨️ Salvar e imprimir teste'),
        h('a', { class: 'botao secundario', href: '#/impressoes' }, '📄 Ver impressões')),
      h('h2', null, '🔒 Segurança'),
      h('div', { class: 'pilha', style: 'margin-top:0' },
        h('button', { type: 'button', class: 'botao secundario', onclick: trocarSenha }, 'Trocar senha'),
        h('button', { type: 'button', class: 'botao perigo-leve', onclick: sair }, 'Sair deste celular')),
    ],
  };
}

// ================= começo =================

async function iniciar() {
  try {
    const e = await api('GET', '/estado');
    estado.nome = e.nome;
    if (!e.configurado) return telaPrimeiroAcesso();
    if (!e.logado) return telaLogin();
    return mostrar();
  } catch (erro) {
    $('#tela').replaceChildren(
      h('div', { class: 'alerta' }, h('span', null, erro.message)),
      h('button', { class: 'botao', type: 'button', onclick: iniciar }, '↻ Tentar de novo'));
    return undefined;
  }
}

iniciar();
