'use strict';
// Audiência real do Atlas: presença anônima, visitantes e visualizações do dia, pico e
// tempo de permanência estimado. Armazenamento compartilhado entre instâncias serverless
// (Upstash Redis via REST); nada fica em memória de função como fonte de verdade.
//
// Proteções: desligada por padrão (AUDIENCIA_ATIVA=1 para ligar), chave de desligamento
// em tempo real (aud:desligado = 1 no Redis), orçamentos diário e mensal de escritas e de
// comandos, limite por IP (só o hash HMAC diário é usado, nunca o IP bruto), um sinal de
// presença por visitante por minuto e amostragem adaptativa quando há muita gente online.
const crypto = require('node:crypto');

// Frações de navegadores que participam da coleta. Com amostragem, os números exibidos
// são estimativas (contagem / fração) e a interface mostra "≈".
const PASSOS = [1, 0.25, 0.05];
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python|node-fetch|axios|go-http|java\/|okhttp|libwww/i;
const VID = /^[A-Za-z0-9_-]{16,40}$/;

function configuracao(env = process.env) {
  const n = (k, padrao) => { const v = Number(env[k]); return Number.isFinite(v) && v > 0 ? v : padrao; };
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '';
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '';
  return {
    ativo: env.AUDIENCIA_ATIVA === '1' && !!url && !!token,
    url, token,
    segredo: env.AUDIENCIA_SEGREDO || crypto.createHash('sha256').update('atlas-audiencia:' + token).digest('hex'),
    intervaloS: n('AUDIENCIA_INTERVALO_S', 180),   // sinal de presença a cada 3 min
    janelaS: n('AUDIENCIA_JANELA_S', 420),         // online = sinal nos últimos 7 min
    alvoPorMin: n('AUDIENCIA_ALVO_POR_MIN', 60),   // escritas por minuto que a amostragem busca
    maxEscritasDia: n('AUDIENCIA_MAX_ESCRITAS_DIA', 25000),
    maxEscritasMes: n('AUDIENCIA_MAX_ESCRITAS_MES', 60000),
    maxComandosMes: n('AUDIENCIA_MAX_COMANDOS_MES', 400000), // cota gratuita Upstash: 500 mil
    maxPorIpMin: n('AUDIENCIA_MAX_POR_IP_MIN', 20),
    maxPvPorVisitanteMin: n('AUDIENCIA_MAX_PV_POR_VISITANTE_MIN', 6),
    timeoutMs: n('AUDIENCIA_TIMEOUT_MS', 1500),
  };
}

// Brasil sem horário de verão desde 2019: dia de Brasília = UTC-3.
const diaBR = ms => new Date(ms - 3 * 3600e3).toISOString().slice(0, 10);
const mesBR = ms => diaBR(ms).slice(0, 7);
const DOIS_DIAS = 172800, QUARENTA_DIAS = 3456000;

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

function criar({ cfg, armazenamento }) {
  const num = v => Number(v) || 0;
  let memoLeitura = null;

  /* Registra um sinal (pv = carregamento de página, hb = presença). */
  async function registrar(evento, contexto, agora) {
    const { tipo, vid, passo } = evento || {};
    if (!['pv', 'hb'].includes(tipo) || !VID.test(String(vid)) || !Number.isInteger(passo) || passo < 0 || passo >= PASSOS.length) return 'invalido';
    if (!contexto || BOT.test(contexto.ua || '') || !contexto.origemValida) return 'ignorado';
    const dia = diaBR(agora), mes = mesBR(agora), minuto = Math.floor(agora / 60000);
    const ipHash = crypto.createHmac('sha256', cfg.segredo).update(dia + '|' + (contexto.ip || '')).digest('hex').slice(0, 20);
    const chaveIp = `aud:ip:${ipHash}:${minuto}`;
    const p1 = [
      ['GET', 'aud:desligado'], ['GET', `aud:esc:${dia}`], ['GET', `aud:esc:${mes}`], ['INCRBY', `aud:cmd:${mes}`, 9],
      ['INCR', chaveIp], ['EXPIRE', chaveIp, 120],
      tipo === 'hb' ? ['SET', `aud:hb:${vid}`, '1', 'NX', 'EX', 60] : ['INCR', `aud:pvv:${vid}:${minuto}`],
      tipo === 'hb' ? ['EXPIRE', `aud:cmd:${mes}`, QUARENTA_DIAS] : ['EXPIRE', `aud:pvv:${vid}:${minuto}`, 120],
      ['EXPIRE', `aud:cmd:${mes}`, QUARENTA_DIAS],
    ];
    const [desl, escDia, escMes, cmdMes, porIp, , unico] = await armazenamento.exec(p1);
    if (desl === '1') return 'desligado';
    if (num(escDia) >= cfg.maxEscritasDia || num(escMes) >= cfg.maxEscritasMes || num(cmdMes) >= cfg.maxComandosMes) return 'limite';
    if (num(porIp) > cfg.maxPorIpMin) return 'excesso';
    if (tipo === 'hb' && unico !== 'OK') return 'repetido';          // outra aba já sinalizou neste minuto
    if (tipo === 'pv' && num(unico) > cfg.maxPvPorVisitanteMin) return 'excesso';
    const peso = 1 / PASSOS[passo];
    const p2 = [
      ['INCR', `aud:esc:${dia}`], ['EXPIRE', `aud:esc:${dia}`, DOIS_DIAS],
      ['INCR', `aud:esc:${mes}`], ['EXPIRE', `aud:esc:${mes}`, QUARENTA_DIAS],
      ['INCRBY', `aud:cmd:${mes}`, 11],
      ['ZADD', `aud:on:${passo}`, agora, vid], ['EXPIRE', `aud:on:${passo}`, cfg.janelaS * 2],
    ];
    if (tipo === 'pv') p2.push(['INCRBYFLOAT', `aud:pv:${dia}`, peso], ['EXPIRE', `aud:pv:${dia}`, DOIS_DIAS], ['PFADD', `aud:u:${dia}:${passo}`, vid], ['EXPIRE', `aud:u:${dia}:${passo}`, DOIS_DIAS]);
    else p2.push(['INCRBYFLOAT', `aud:t:${dia}`, cfg.intervaloS * peso], ['EXPIRE', `aud:t:${dia}`, DOIS_DIAS]);
    await armazenamento.exec(p2);
    return 'ok';
  }

  /* Lê as métricas do dia e ajusta a amostragem. Memória de 30 s por instância. */
  async function ler(agora) {
    if (memoLeitura && agora - memoLeitura.em < 30000) return memoLeitura.dados;
    const dia = diaBR(agora), mes = mesBR(agora), corte = agora - cfg.janelaS * 1000;
    const cmds = [['GET', 'aud:desligado'], ['GET', 'aud:passo'], ['GET', `aud:pv:${dia}`], ['GET', `aud:t:${dia}`], ['GET', `aud:pico:${dia}`],
      ['GET', `aud:esc:${dia}`], ['GET', `aud:esc:${mes}`], ['INCRBY', `aud:cmd:${mes}`, 7 + PASSOS.length * 3]];
    PASSOS.forEach((_, k) => cmds.push(['ZREMRANGEBYSCORE', `aud:on:${k}`, 0, corte], ['ZCARD', `aud:on:${k}`], ['PFCOUNT', `aud:u:${dia}:${k}`]));
    const r = await armazenamento.exec(cmds);
    const [desl, passoAtual, pv, t, picoSalvo, escDia, escMes, cmdMes] = r;
    let membros = 0, unicos = 0, amostrado = false;
    PASSOS.forEach((f, k) => {
      const z = num(r[8 + k * 3 + 1]), u = num(r[8 + k * 3 + 2]);
      membros += z / f; unicos += u / f;
      if (k > 0 && (z > 0 || u > 0)) amostrado = true;
    });
    const online = Math.round(membros), unicosHoje = Math.round(unicos);
    // Escolhe a maior fração que mantém as escritas perto do alvo por minuto.
    const esperadoPorMin = online * (60 / cfg.intervaloS) + 1;
    const desejada = cfg.alvoPorMin / esperadoPorMin;
    let passo = PASSOS.findIndex(f => f <= desejada);
    if (passo === -1) passo = PASSOS.length - 1;
    const pico = Math.max(online, num(picoSalvo));
    const ajustes = [];
    if (online > num(picoSalvo)) ajustes.push(['SET', `aud:pico:${dia}`, online, 'EX', DOIS_DIAS]);
    if (String(passo) !== String(passoAtual ?? '0')) ajustes.push(['SET', 'aud:passo', passo]);
    if (ajustes.length) await armazenamento.exec(ajustes.concat([['INCRBY', `aud:cmd:${mes}`, ajustes.length + 1]]));
    const coleta = desl !== '1' && num(escDia) < cfg.maxEscritasDia && num(escMes) < cfg.maxEscritasMes && num(cmdMes) < cfg.maxComandosMes;
    const dados = {
      ok: true, disponivel: true, coleta, passo, amostra: PASSOS[passo], intervaloS: cfg.intervaloS, janelaS: cfg.janelaS,
      estimativa: amostrado || passo > 0,
      online, unicosHoje, visualizacoesHoje: Math.round(num(pv)), picoHoje: pico,
      tempoHorasHoje: Math.round((num(t) / 3600) * 10) / 10,
      dia, atualizadoEm: new Date(agora).toISOString(),
    };
    memoLeitura = { em: agora, dados };
    return dados;
  }
  return { registrar, ler, limparMemo() { memoLeitura = null; } };
}

module.exports = { PASSOS, BOT, VID, configuracao, armazenamentoUpstash, criar, diaBR, mesBR };
