'use strict';
// Audiência real do Atlas: presença anônima, visitantes e visualizações do dia, pico e
// tempo de permanência estimado. Armazenamento compartilhado entre instâncias serverless
// (Upstash Redis via REST); nada fica em memória de função como fonte de verdade.
//
// O que é garantido pelo código:
// - Comandos Redis: todo comando é contabilizado (aud:cmd:<mês>); ao atingir o orçamento,
//   a instância abre um disjuntor e não envia comando algum por 5 minutos (escritas e
//   leituras). Excesso possível: só as requisições já em andamento no instante do corte.
// - Escritas por minuto: teto global (aud:min:<minuto>); acima dele, nada é gravado.
// O que NÃO é garantido pelo código: o número de execuções da função na Vercel. Cada POST
// que chega é uma execução, mesmo rejeitada. Isso é reduzido por amostragem decidida no
// servidor, pelo cabeçalho X-Audiencia-Coleta: 0 (o navegador para de enviar) e pelo cache
// da leitura. Corte absoluto só por regra "deny" no Firewall da Vercel (sem execução).
const crypto = require('node:crypto');

// Frações de navegadores na amostra. Com amostragem, números exibidos são estimativas (≈).
const PASSOS = [1, 0.2, 0.05, 0.01];
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python|node-fetch|axios|go-http|java\/|okhttp|libwww/i;
const VID = /^[A-Za-z0-9_-]{16,40}$/;
const DISJUNTOR_MS = 5 * 60000, DISJUNTOR_ERRO_MS = 60000;

function configuracao(env = process.env) {
  const n = (k, padrao) => { const v = Number(env[k]); return Number.isFinite(v) && v > 0 ? v : padrao; };
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '';
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '';
  return {
    ativo: env.AUDIENCIA_ATIVA === '1' && !!url && !!token,
    url, token,
    segredo: env.AUDIENCIA_SEGREDO || crypto.createHash('sha256').update('atlas-audiencia:' + token).digest('hex'),
    intervaloS: n('AUDIENCIA_INTERVALO_S', 180),       // sinal de presença a cada 3 min
    janelaS: n('AUDIENCIA_JANELA_S', 420),             // online = sinal nos últimos 7 min
    alvoPorMin: n('AUDIENCIA_ALVO_POR_MIN', 40),       // escritas/min que a amostragem busca
    maxPorMin: n('AUDIENCIA_MAX_POR_MIN', 120),        // teto global de escritas por minuto
    maxComandosMes: n('AUDIENCIA_MAX_COMANDOS_MES', 450000), // cota gratuita Upstash: 500 mil
    maxComandosDia: n('AUDIENCIA_MAX_COMANDOS_DIA', 220000),
    maxPorIpMin: n('AUDIENCIA_MAX_POR_IP_MIN', 20),
    maxPvPorVisitanteMin: n('AUDIENCIA_MAX_PV_POR_VISITANTE_MIN', 6),
    leituraMs: n('AUDIENCIA_LEITURA_MS', 20000),       // memória da leitura por instância
    timeoutMs: n('AUDIENCIA_TIMEOUT_MS', 1500),
  };
}

// Brasil sem horário de verão desde 2019: dia de Brasília = UTC-3.
const diaBR = ms => new Date(ms - 3 * 3600e3).toISOString().slice(0, 10);
const mesBR = ms => diaBR(ms).slice(0, 7);
const DOIS_DIAS = 172800, QUARENTA_DIAS = 3456000;

// Mesmo hash do navegador (FNV-1a 32 bits): participação estável e verificável no servidor.
function fracao(vid) {
  let h = 2166136261;
  for (let i = 0; i < vid.length; i++) { h ^= vid.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h / 4294967296;
}

/* Upstash Redis via REST (pipeline): várias operações em uma requisição. */
function armazenamentoUpstash(url, token, timeoutMs) {
  return {
    async exec(comandos) {
      const r = await fetch(url.replace(/\/$/, '') + '/pipeline', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(comandos), signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) throw new Error('Upstash respondeu ' + r.status);
      const corpo = await r.json();
      return corpo.map(x => { if (x.error) throw new Error(x.error); return x.result; });
    },
  };
}

// Status em que o navegador deve parar de enviar sinais nesta página.
const PARAR = new Set(['desligado', 'limite', 'fechado', 'fora-da-amostra', 'teto-minuto', 'indisponivel']);

function criar({ cfg, armazenamento }) {
  const num = v => Number(v) || 0;
  let memoLeitura = null;
  let fechadoAte = 0, motivoFechado = '';
  const fechar = (agora, motivo, ms) => { fechadoAte = agora + ms; motivoFechado = motivo; };
  // Toda fase inclui um INCRBY com o seu próprio tamanho: comandos rejeitados também contam.
  const fase = (mes, dia, cmds) => {
    const total = cmds.length + 2;
    return cmds.concat([['INCRBY', `aud:cmd:${mes}`, total], ['INCRBY', `aud:cmd:${dia}`, total]]);
  };
  async function exec(cmds, agora) {
    try { return await armazenamento.exec(cmds); }
    catch (e) { fechar(agora, 'indisponivel', DISJUNTOR_ERRO_MS); throw e; }
  }

  /* Registra um sinal (pv = carregamento de página visível, hb = presença). */
  async function registrar(evento, contexto, agora) {
    const { tipo, vid, passo } = evento || {};
    if (!['pv', 'hb'].includes(tipo) || !VID.test(String(vid)) || !Number.isInteger(passo) || passo < 0 || passo >= PASSOS.length) return 'invalido';
    if (!contexto || BOT.test(contexto.ua || '') || !contexto.origemValida) return 'ignorado';
    if (agora < fechadoAte) return 'fechado';                         // disjuntor: zero comandos
    const dia = diaBR(agora), mes = mesBR(agora), minuto = Math.floor(agora / 60000);

    // Fase 1 (5 comandos): estado, orçamento e teto global do minuto.
    const [estado, porMinuto] = await exec(fase(mes, dia, [
      ['MGET', 'aud:desligado', `aud:cmd:${mes}`, `aud:cmd:${dia}`, 'aud:passo'],
      ['INCR', `aud:min:${minuto}`], ['EXPIRE', `aud:min:${minuto}`, 120],
    ]), agora);
    const [desl, cmdMes, cmdDia, passoAtual] = estado;
    if (desl === '1') { fechar(agora, 'desligado', DISJUNTOR_MS); return 'desligado'; }
    if (num(cmdMes) >= cfg.maxComandosMes || num(cmdDia) >= cfg.maxComandosDia) { fechar(agora, 'limite', DISJUNTOR_MS); return 'limite'; }
    if (num(porMinuto) > cfg.maxPorMin) return 'teto-minuto';
    // Amostragem decidida no servidor: só grava quem está na fração atual.
    const p = Math.min(PASSOS.length - 1, Math.max(0, num(passoAtual)));
    if (fracao(vid) >= PASSOS[p]) return 'fora-da-amostra';

    // Fase 2 (4–5 comandos): limites por IP (hash HMAC diário) e por visitante.
    const ipHash = crypto.createHmac('sha256', cfg.segredo).update(dia + '|' + (contexto.ip || '')).digest('hex').slice(0, 20);
    const chaveIp = `aud:ip:${ipHash}:${minuto}`;
    const [porIp, , unico] = await exec(fase(mes, dia, [
      ['INCR', chaveIp], ['EXPIRE', chaveIp, 120],
      tipo === 'hb' ? ['SET', `aud:hb:${vid}`, '1', 'NX', 'EX', 60] : ['INCR', `aud:pvv:${vid}:${minuto}`],
      ...(tipo === 'pv' ? [['EXPIRE', `aud:pvv:${vid}:${minuto}`, 120]] : []),
    ]), agora);
    if (num(porIp) > cfg.maxPorIpMin) return 'excesso';
    if (tipo === 'hb' && unico !== 'OK') return 'repetido';          // outra aba já sinalizou neste minuto
    if (tipo === 'pv' && num(unico) > cfg.maxPvPorVisitanteMin) return 'excesso';

    // Fase 3 (6–8 comandos): presença imediata em pv e hb; visitantes, visualizações e tempo.
    const peso = 1 / PASSOS[p];
    const escritas = [['ZADD', `aud:on:${p}`, agora, vid], ['EXPIRE', `aud:on:${p}`, cfg.janelaS * 2]];
    if (tipo === 'pv') escritas.push(['INCRBYFLOAT', `aud:pv:${dia}`, peso], ['PFADD', `aud:u:${dia}:${p}`, vid], ['EXPIRE', `aud:u:${dia}:${p}`, DOIS_DIAS]);
    else escritas.push(['INCRBYFLOAT', `aud:t:${dia}`, cfg.intervaloS * peso]);
    await exec(fase(mes, dia, escritas), agora);
    return 'ok';
  }

  /* Lê as métricas do dia e ajusta a amostragem. Memória por instância (20 s).
     Coleta fechada (limite, desligamento ou falha): "indisponível" em vez de números
     congelados — o online envelheceria e pareceria um dado confirmado. */
  async function ler(agora) {
    if (agora < fechadoAte) return { ok: true, disponivel: false, coleta: false, motivo: motivoFechado };
    if (memoLeitura && agora - memoLeitura.em < cfg.leituraMs) return memoLeitura.dados;
    const dia = diaBR(agora), mes = mesBR(agora), corte = agora - cfg.janelaS * 1000, minuto = Math.floor(agora / 60000);
    // Depois de um fechamento por limite ou desligamento, confere primeiro só o estado
    // (3 comandos) antes de uma leitura completa: o custo residual fica mínimo.
    if (motivoFechado === 'limite' || motivoFechado === 'desligado') {
      const [[d, cm, cd]] = await exec(fase(mes, dia, [['MGET', 'aud:desligado', `aud:cmd:${mes}`, `aud:cmd:${dia}`]]), agora);
      if (d === '1' || num(cm) >= cfg.maxComandosMes || num(cd) >= cfg.maxComandosDia) {
        fechar(agora, d === '1' ? 'desligado' : 'limite', DISJUNTOR_MS);
        return { ok: true, disponivel: false, coleta: false, motivo: motivoFechado };
      }
      motivoFechado = '';
    }
    const cmds = [['MGET', 'aud:desligado', 'aud:passo', `aud:pv:${dia}`, `aud:t:${dia}`, `aud:pico:${dia}`, `aud:cmd:${mes}`, `aud:cmd:${dia}`, `aud:min:${minuto - 1}`, `aud:min:${minuto}`]];
    PASSOS.forEach((_, k) => cmds.push(['ZREMRANGEBYSCORE', `aud:on:${k}`, 0, corte], ['ZRANGE', `aud:on:${k}`, 0, -1], ['PFCOUNT', `aud:u:${dia}:${k}`]));
    const r = await exec(fase(mes, dia, cmds), agora);
    const [desl, passoAtual, pv, t, picoSalvo, cmdMes, cmdDia, minAnterior, minAtual] = r[0];
    // Online: membros distintos (de qualquer fração) que pertencem à fração atual, divididos
    // por ela. Evita somar duas vezes a mesma população quando a fração muda.
    const fAtual = PASSOS[Math.min(PASSOS.length - 1, num(passoAtual))];
    const presentes = new Set();
    let unicos = 0, amostrado = fAtual < 1;
    PASSOS.forEach((f, k) => {
      for (const v of r[1 + k * 3 + 1] || []) if (fracao(v) < fAtual) presentes.add(v);
      const u = num(r[1 + k * 3 + 2]);
      unicos += u / f;
      if (k > 0 && u > 0) amostrado = true;
    });
    const online = Math.round(presentes.size / fAtual), unicosHoje = Math.round(unicos);
    // Fração: pelo número online e pelas chegadas recentes (reage a picos em até ~1 min).
    const porMin = Math.max(online * (60 / cfg.intervaloS), num(minAnterior), num(minAtual)) + 1;
    let passo = PASSOS.findIndex(f => f * porMin <= cfg.alvoPorMin);
    if (passo === -1) passo = PASSOS.length - 1;
    // Não volta a uma fração maior enquanto o minuto atual ainda estiver acima do alvo.
    if (num(minAtual) > cfg.alvoPorMin) passo = Math.max(passo, Math.min(PASSOS.length - 1, num(passoAtual)));
    const pico = Math.max(online, num(picoSalvo));
    const ajustes = [];
    if (online > num(picoSalvo)) ajustes.push(['SET', `aud:pico:${dia}`, online, 'EX', DOIS_DIAS]);
    if (String(passo) !== String(passoAtual ?? '0')) ajustes.push(['SET', 'aud:passo', passo]);
    if (ajustes.length) await exec(fase(mes, dia, ajustes), agora);
    const limite = num(cmdMes) >= cfg.maxComandosMes || num(cmdDia) >= cfg.maxComandosDia;
    const coleta = desl !== '1' && !limite;
    const dados = {
      ok: true, disponivel: true, coleta, passo, amostra: PASSOS[passo], intervaloS: cfg.intervaloS, janelaS: cfg.janelaS,
      estimativa: amostrado || passo > 0,
      online, unicosHoje, visualizacoesHoje: Math.round(num(pv)), picoHoje: pico,
      tempoHorasHoje: Math.round((num(t) / 3600) * 10) / 10,
      dia, atualizadoEm: new Date(agora).toISOString(),
    };
    if (!coleta) {
      fechar(agora, desl === '1' ? 'desligado' : 'limite', DISJUNTOR_MS);
      return { ok: true, disponivel: false, coleta: false, motivo: motivoFechado };
    }
    memoLeitura = { em: agora, dados };
    return dados;
  }
  return { registrar, ler };
}

module.exports = { PASSOS, PARAR, BOT, VID, configuracao, armazenamentoUpstash, criar, diaBR, mesBR, fracao };
