'use strict';

const net = require('node:net');

/**
 * Manda bytes para uma impressora de rede (porta 9100, "RAW"/"JetDirect").
 * Funciona com qualquer impressora térmica ligada no cabo de rede ou Wi-Fi.
 */
function enviarParaImpressora({ host, porta = 9100 }, dados, tempoLimite = 6000) {
  return new Promise((resolver, rejeitar) => {
    if (!host) {
      rejeitar(new Error('O endereço (IP) da impressora não foi configurado.'));
      return;
    }
    const conexao = net.createConnection({ host, port: Number(porta) || 9100 });
    let terminou = false;
    const terminar = (erro) => {
      if (terminou) return;
      terminou = true;
      conexao.destroy();
      if (erro) rejeitar(erro);
      else resolver();
    };
    conexao.setTimeout(tempoLimite, () => terminar(new Error('A impressora não respondeu. Ela está ligada?')));
    conexao.on('error', (e) => terminar(new Error(`Não consegui falar com a impressora (${e.code || e.message}).`)));
    conexao.on('connect', () => conexao.end(dados, () => terminar()));
  });
}

module.exports = { enviarParaImpressora };
