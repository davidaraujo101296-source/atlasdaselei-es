'use strict';
// GET  /api/audiencia  → métricas do dia (cache de 30 s no CDN; nunca inventa números)
// POST /api/audiencia  → sinal anônimo { tipo: 'pv' | 'hb', vid, passo } (sempre 204)
// Totalmente separado das APIs de apuração: falhas aqui não afetam /api/apuracao nem /api/mapa.
const { configuracao, armazenamentoUpstash, criar, PARAR } = require('../lib/audiencia');

let instancia = null;
function audiencia(cfg) {
  if (!instancia || instancia.url !== cfg.url) instancia = { url: cfg.url, api: criar({ cfg, armazenamento: armazenamentoUpstash(cfg.url, cfg.token, cfg.timeoutMs) }) };
  return instancia.api;
}

function responder(res, status, corpo, cacheS) {
  res.statusCode = status;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', cacheS ? `public, max-age=0, s-maxage=${cacheS}, stale-while-revalidate=${cacheS * 2}` : 'no-store');
  if (corpo === undefined) return res.end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(corpo));
}

// Corpo pequeno: sinais têm menos de 100 bytes; acima de 512 bytes é descartado.
async function lerCorpo(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  let texto = '';
  for await (const parte of req) { texto += parte; if (texto.length > 512) throw new Error('corpo grande'); }
  return JSON.parse(texto || '{}');
}

function contexto(req) {
  const h = req.headers || {};
  const host = String(h['x-forwarded-host'] || h.host || '');
  const origem = h.origin ? String(h.origin) : '';
  const site = h['sec-fetch-site'] ? String(h['sec-fetch-site']) : '';
  return {
    ip: String(h['x-forwarded-for'] || h['x-real-ip'] || req.socket?.remoteAddress || '').split(',')[0].trim(),
    ua: String(h['user-agent'] || ''),
    // Só aceita sinais enviados pelas próprias páginas do Atlas.
    origemValida: (!origem || origem === `https://${host}` || origem === `http://${host}`) && (!site || site === 'same-origin'),
  };
}

async function handler(req, res, ambiente = process.env, agora = Date.now) {
  const cfg = configuracao(ambiente);
  if (req.method === 'GET') {
    if (!cfg.ativo) return responder(res, 200, { ok: true, disponivel: false, motivo: 'desativado' }, 300);
    try {
      const dados = await audiencia(cfg).ler(agora());
      // Coleta fechada: cache mais longo para os navegadores pararem de enviar logo.
      return responder(res, 200, dados, dados.coleta ? 30 : 120);
    } catch (e) { return responder(res, 200, { ok: true, disponivel: false, motivo: 'servico-indisponivel' }, 60); }
  }
  if (req.method === 'POST') {
    let status = 'desativado';
    if (cfg.ativo) {
      try {
        const evento = await lerCorpo(req);
        status = await audiencia(cfg).registrar({ tipo: evento.tipo, vid: evento.vid, passo: evento.passo }, contexto(req), agora());
      } catch (e) { status = 'indisponivel'; /* sinal descartado: nunca derruba a página */ }
    }
    // Instrui o navegador a parar de enviar nesta página (amostra, limite, desligado, falha).
    res.setHeader('X-Audiencia-Coleta', status === 'desativado' || PARAR.has(status) ? '0' : '1');
    return responder(res, 204);
  }
  res.setHeader('Allow', 'GET, POST');
  return responder(res, 405, { ok: false, error: 'Método não permitido.' });
}

module.exports = handler;
module.exports.redefinir = () => { instancia = null; };
