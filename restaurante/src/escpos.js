'use strict';

// Monta os bytes que impressoras térmicas (padrão ESC/POS: Epson, Elgin,
// Bematech, Tanca, Knup, impressoras "genéricas" de 58/80mm...) entendem.

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

// Tabela PC860 (português). Só é usada se a opção "acentos" for "cp860".
const CP860 = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ã': 0x84, 'à': 0x85, 'Á': 0x86, 'ç': 0x87,
  'ê': 0x88, 'Ê': 0x89, 'è': 0x8a, 'Í': 0x8b, 'Ô': 0x8c, 'ì': 0x8d, 'Ã': 0x8e, 'Â': 0x8f,
  'É': 0x90, 'À': 0x91, 'È': 0x92, 'ô': 0x93, 'õ': 0x94, 'ò': 0x95, 'Ú': 0x96, 'ù': 0x97,
  'Ì': 0x98, 'Õ': 0x99, 'Ü': 0x9a, 'Ù': 0x9d, 'Ó': 0x9f, 'á': 0xa0, 'í': 0xa1, 'ó': 0xa2,
  'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7, 'Ò': 0xa9,
};

/** Converte texto em bytes que a impressora entende. Caracteres sem equivalente somem. */
function codificar(texto, acentos = 'remover') {
  const out = [];
  for (const ch of String(texto).normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (ch === '\n') out.push(LF);
    else if (c >= 0x20 && c < 0x7f) out.push(c);
    else if (acentos === 'cp860' && CP860[ch] !== undefined) out.push(CP860[ch]);
    else {
      for (const s of ch.normalize('NFD').replace(/[̀-ͯ]/g, '')) {
        const k = s.codePointAt(0);
        if (k >= 0x20 && k < 0x7f) out.push(k);
      }
    }
  }
  return out;
}

/** Quebra o texto em linhas de no máximo `largura` caracteres, sem cortar palavras quando dá. */
function quebrar(texto, largura) {
  const linhas = [];
  for (const paragrafo of String(texto).split('\n')) {
    let linha = '';
    for (let palavra of paragrafo.split(/\s+/).filter(Boolean)) {
      while (palavra.length > largura) {
        if (linha) { linhas.push(linha); linha = ''; }
        linhas.push(palavra.slice(0, largura));
        palavra = palavra.slice(largura);
      }
      if (!linha) linha = palavra;
      else if (linha.length + 1 + palavra.length <= largura) linha += ' ' + palavra;
      else { linhas.push(linha); linha = palavra; }
    }
    if (linha || !paragrafo.trim()) linhas.push(linha);
  }
  return linhas;
}

class Cupom {
  constructor({ largura = 48, acentos = 'remover', codepage = 3 } = {}) {
    this.largura = Number(largura) || 48;
    this.acentos = acentos;
    this.dobro = false;
    this.b = [ESC, 0x40]; // reinicia a impressora
    if (acentos === 'cp860') this.b.push(ESC, 0x74, Number(codepage) & 0xff);
  }

  get colunas() { return this.dobro ? Math.floor(this.largura / 2) : this.largura; }
  alinhar(lado) { this.b.push(ESC, 0x61, { esquerda: 0, centro: 1, direita: 2 }[lado]); return this; }
  negrito(sim) { this.b.push(ESC, 0x45, sim ? 1 : 0); return this; }
  grande(sim) { this.dobro = sim; this.b.push(GS, 0x21, sim ? 0x11 : 0x00); return this; }
  linha(texto = '') {
    for (const l of quebrar(texto, this.colunas)) this.b.push(...codificar(l, this.acentos), LF);
    return this;
  }
  separador(ch = '-') { this.b.push(...codificar(ch.repeat(this.colunas)), LF); return this; }
  avancar(n = 1) { this.b.push(ESC, 0x64, n); return this; }
  cortar() { this.avancar(4); this.b.push(GS, 0x56, 0x42, 0x00); return this; }
  bytes() { return Buffer.from(this.b); }
}

function opcoesCupom(ajustes) {
  return {
    largura: ajustes.impressora_largura,
    acentos: ajustes.impressora_acentos,
    codepage: ajustes.impressora_codepage,
  };
}

const hora = (quando) => `${quando.slice(8, 10)}/${quando.slice(5, 7)} ${quando.slice(11, 16)}`;

/**
 * Comanda da cozinha.
 * @param {object} p
 * @param {'novo'|'cancelar'} p.tipo
 * @param {{nome:string, quantidade:number, obs:string}[]} p.itens
 */
function comandaCozinha({ ajustes, pedidoId, identificacao, itens, tipo = 'novo', quando }) {
  const c = new Cupom(opcoesCupom(ajustes));
  c.alinhar('centro').negrito(true).grande(true);
  c.linha(tipo === 'cancelar' ? '*** CANCELAR ***' : 'COZINHA');
  c.grande(false).negrito(false);
  c.linha(`Pedido ${pedidoId} - ${hora(quando)}`);
  if (identificacao) c.negrito(true).grande(true).linha(identificacao.toUpperCase()).grande(false).negrito(false);
  c.alinhar('esquerda').separador();
  for (const item of itens) {
    c.negrito(true).grande(true).linha(`${item.quantidade}x ${item.nome}`).grande(false);
    if (item.obs) c.linha(`  >> ${item.obs}`);
    c.negrito(false).linha();
  }
  c.separador();
  if (tipo === 'cancelar') c.alinhar('centro').negrito(true).linha('NAO FAZER ESTES ITENS').negrito(false);
  return c.cortar().bytes();
}

function paginaTeste({ ajustes, quando }) {
  const c = new Cupom(opcoesCupom(ajustes));
  c.alinhar('centro').negrito(true).grande(true).linha('TESTE').grande(false).negrito(false);
  c.linha(ajustes.nome_estabelecimento);
  c.linha(hora(quando));
  c.separador();
  c.alinhar('esquerda').linha('Se você está lendo isto, a impressora está funcionando!');
  c.linha('Acentos: ação, pão, café, açúcar, maçã');
  c.linha(`Papel: ${ajustes.impressora_largura} colunas`);
  c.separador().linha('1234567890'.repeat(5).slice(0, c.largura));
  return c.cortar().bytes();
}

module.exports = { Cupom, codificar, quebrar, comandaCozinha, paginaTeste };
