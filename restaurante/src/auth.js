'use strict';

const crypto = require('node:crypto');

function gerarHashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, sal, 32);
  return `${sal.toString('hex')}:${hash.toString('hex')}`;
}

function conferirSenha(senha, guardado) {
  if (!guardado || typeof senha !== 'string') return false;
  const [sal, hash] = guardado.split(':');
  const calculado = crypto.scryptSync(senha, Buffer.from(sal, 'hex'), 32);
  const esperado = Buffer.from(hash, 'hex');
  return esperado.length === calculado.length && crypto.timingSafeEqual(calculado, esperado);
}

const novoToken = () => crypto.randomBytes(32).toString('hex');
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

function iguais(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function lerCookies(cabecalho = '') {
  const cookies = {};
  for (const parte of cabecalho.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0) cookies[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return cookies;
}

/** Limita tentativas de senha errada por endereço (5 erros = espera 1 minuto). */
function criarLimitador({ maximo = 5, esperaMs = 60_000 } = {}) {
  const falhas = new Map();
  return {
    bloqueado(chave) {
      const f = falhas.get(chave);
      if (!f) return false;
      if (f.ate && f.ate > Date.now()) return true;
      if (f.ate) falhas.delete(chave);
      return false;
    },
    falhou(chave) {
      const f = falhas.get(chave) || { n: 0, ate: 0 };
      f.n += 1;
      if (f.n >= maximo) { f.ate = Date.now() + esperaMs; f.n = 0; }
      falhas.set(chave, f);
    },
    acertou(chave) { falhas.delete(chave); },
  };
}

module.exports = { gerarHashSenha, conferirSenha, novoToken, hashToken, iguais, lerCookies, criarLimitador };
