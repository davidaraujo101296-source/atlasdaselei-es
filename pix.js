/* Pix do Atlas Eleitoral: chave aprovada e BR Code estático (Pix Copia e Cola), sem valor.
   Segue o padrão EMV/BR Code do Banco Central (Manual de Padrões para Iniciação do Pix):
   campos TLV (ID de 2 dígitos + tamanho de 2 dígitos + valor) e CRC16-CCITT (polinômio
   0x1021, valor inicial 0xFFFF) no campo 63. O nome e a cidade foram informados pelo
   titular; o app do banco mostra ao pagador o nome cadastrado na chave. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.AtlasPix = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CHAVE = 'atlaseleitoral.david@gmail.com';
  const NOME = 'DAVID DE ARAUJO LIMA'; // campo 59: até 25 caracteres, sem acento
  const CIDADE = 'SAO PAULO';          // campo 60: até 15 caracteres, sem acento

  const campo = (id, valor) => {
    const v = String(valor);
    if (v.length > 99) throw new Error('campo ' + id + ' longo demais');
    return id + String(v.length).padStart(2, '0') + v;
  };

  function crc16(texto) {
    let crc = 0xFFFF;
    for (let i = 0; i < texto.length; i++) {
      crc ^= texto.charCodeAt(i) << 8;
      for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  // Só caracteres aceitos nos campos de texto do BR Code (ASCII imprimível, sem acento).
  const ascii = s => /^[\x20-\x7E]*$/.test(s);

  function brCode({ chave = CHAVE, nome = NOME, cidade = CIDADE, txid = '***' } = {}) {
    if (!chave || !nome || !cidade) throw new Error('chave, nome e cidade são obrigatórios');
    if (nome.length > 25 || cidade.length > 15 || !ascii(nome) || !ascii(cidade)) throw new Error('nome ou cidade fora do padrão');
    const corpo = campo('00', '01')
      + campo('26', campo('00', 'br.gov.bcb.pix') + campo('01', chave))
      + campo('52', '0000')
      + campo('53', '986')
      + campo('58', 'BR')
      + campo('59', nome)
      + campo('60', cidade)
      + campo('62', campo('05', txid))
      + '6304';
    return corpo + crc16(corpo);
  }

  // Lê um BR Code em TLV e confere tamanhos e CRC. Devolve { ok, campos, erro }.
  function ler(codigo) {
    const campos = {};
    let i = 0;
    try {
      while (i < codigo.length) {
        const id = codigo.slice(i, i + 2), n = Number(codigo.slice(i + 2, i + 4));
        if (!/^\d{2}$/.test(id) || !Number.isInteger(n) || i + 4 + n > codigo.length) throw new Error('estrutura TLV inválida');
        campos[id] = codigo.slice(i + 4, i + 4 + n);
        i += 4 + n;
      }
      if (campos['63'] === undefined || !codigo.endsWith(campos['63'])) throw new Error('sem CRC no final');
      const esperado = crc16(codigo.slice(0, -4));
      if (campos['63'] !== esperado) throw new Error('CRC inválido');
      if (campos['26'] !== undefined) campos['26'] = ler.sub(campos['26']);
      if (campos['62'] !== undefined) campos['62'] = ler.sub(campos['62']);
      return { ok: true, campos };
    } catch (e) { return { ok: false, campos, erro: e.message }; }
  }
  ler.sub = s => { const o = {}; let i = 0; while (i < s.length) { const id = s.slice(i, i + 2), n = Number(s.slice(i + 2, i + 4)); o[id] = s.slice(i + 4, i + 4 + n); i += 4 + n; } return o; };

  return { CHAVE, NOME, CIDADE, crc16, brCode, ler, CODIGO: brCode() };
});
