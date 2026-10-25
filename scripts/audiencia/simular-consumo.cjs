// Simula o consumo do contador de audiência (execuções da função e comandos Redis) em
// cenários de tráfego, com Redis em memória. Não acessa nenhum serviço real.
//   node scripts/audiencia/simular-consumo.cjs
'use strict';
const crypto = require('node:crypto');
const A = require('../../lib/audiencia');
const { RedisFalso } = require('../../tests/helpers/redis-falso.cjs');

/* Cenário: `simultaneos` visitantes mantidos online por `minutos`, cada visita durando
   `visitaMin` minutos (ao sair, entra outro). `chegadaInicialS`: em quantos segundos os
   primeiros chegam (pico de entrada). Leitura pública com cache de CDN (30 s / 120 s). */
async function simular({ simultaneos, minutos, visitaMin = 15, chegadaInicialS = 60, env = {} }) {
  let agora = Date.parse('2026-10-25T18:00:00-03:00');
  const redis = new RedisFalso(() => agora);
  const cfg = A.configuracao({ AUDIENCIA_ATIVA: '1', KV_REST_API_URL: 'x', KV_REST_API_TOKEN: 'y', ...env });
  const aud = A.criar({ cfg, armazenamento: redis.armazenamento() });
  const ctx = i => ({ ip: '10.' + (i % 250) + '.' + ((i / 250) | 0) % 250 + '.1', ua: 'Mozilla/5.0 Chrome/130', origemValida: true });
  let invocacoes = 0, leiturasNaFuncao = 0, gravados = 0;
  let cache = null, cacheAte = 0;
  async function lerPublico() {
    if (cache && agora < cacheAte) return cache;
    invocacoes++; leiturasNaFuncao++;
    try { cache = await aud.ler(agora); } catch (e) { cache = { disponivel: false, coleta: false }; }
    cacheAte = agora + (cache.coleta ? 30000 : 120000);
    return cache;
  }
  const visitantes = [];
  let seq = 0;
  const novo = (t) => ({ vid: crypto.randomBytes(16).toString('base64url'), i: seq++, chega: t, sai: t + visitaMin * 60000, proxHb: null, pausaAte: 0, pv: false });
  for (let i = 0; i < simultaneos; i++) visitantes.push(novo(agora + Math.floor((i / simultaneos) * chegadaInicialS * 1000)));
  const fim = agora + minutos * 60000;
  async function enviar(v, tipo, d) {
    if (!d.coleta || agora < v.pausaAte || A.fracao(v.vid) >= A.PASSOS[d.passo]) return;
    invocacoes++;
    const st = await aud.registrar({ tipo, vid: v.vid, passo: d.passo }, ctx(v.i), agora).catch(() => 'indisponivel');
    if (st === 'ok') gravados++;
    if (A.PARAR.has(st)) v.pausaAte = agora + 600000;
  }
  for (; agora < fim; agora += 1000) {
    for (let k = 0; k < visitantes.length; k++) {
      const v = visitantes[k];
      if (agora < v.chega) continue;
      if (agora >= v.sai) { visitantes[k] = novo(agora); continue; }
      if (!v.pv) { v.pv = true; const d = await lerPublico(); await enviar(v, 'pv', d); v.proxHb = agora + 180000; continue; }
      if (agora >= v.proxHb) { v.proxHb = agora + 180000; const d = await lerPublico(); await enviar(v, 'hb', d); }
    }
  }
  const final = await aud.ler(agora + 61000).catch(() => null);
  return { simultaneos, minutos, invocacoes, leiturasNaFuncao, gravados, comandosRedis: redis.comandos, requisicoesRedis: redis.requisicoes, onlineEstimado: final ? final.online : null, coletaAoFinal: final ? final.coleta : null };
}

async function main() {
  const cenarios = [
    { nome: '50 simultâneos, 1 h', simultaneos: 50, minutos: 60 },
    { nome: '500 simultâneos, 1 h', simultaneos: 500, minutos: 60 },
    { nome: '5.000 simultâneos, 1 h (chegam em 2 min)', simultaneos: 5000, minutos: 60, chegadaInicialS: 120 },
    { nome: '20.000 simultâneos, 1 h (chegam em 3 min)', simultaneos: 20000, minutos: 60, chegadaInicialS: 180 },
    { nome: 'Noite eleitoral: 2.000 simultâneos por 6 h', simultaneos: 2000, minutos: 360, chegadaInicialS: 120 },
    { nome: 'Noite eleitoral: 10.000 simultâneos por 6 h', simultaneos: 10000, minutos: 360, chegadaInicialS: 180 },
  ];
  console.log('| Cenário | Execuções da função | Comandos Redis | Online estimado | Coleta ao final |');
  console.log('|---|---|---|---|---|');
  for (const c of cenarios) {
    const r = await simular(c);
    console.log(`| ${c.nome} | ${r.invocacoes.toLocaleString('pt-BR')} | ${r.comandosRedis.toLocaleString('pt-BR')} | ${r.onlineEstimado ?? '—'} | ${r.coletaAoFinal ? 'sim' : 'não'} |`);
  }
}
if (require.main === module) main();
module.exports = { simular };
