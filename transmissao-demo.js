/* DEMONSTRAÇÃO — DADOS FICTÍCIOS. Carregado somente com ?demo=1.
   Simula as respostas de /api/apuracao e /api/mapa para testar a transmissão:
   avanço por estado, virada de liderança, falha de rede, mapa parcial, dado stale e
   resposta antiga fora de ordem. Nenhum número aqui é oficial. */
(function (root) {
  'use strict';
  const C = root.TransmissaoCore;
  const ESPERA_INICIAL = 25000; // tempo de "aguardando divulgação" antes da primeira parcial
  const PASSO = 20000;          // a cada passo simulado, algumas UFs recebem nova parcial
  const CANDIDATOS = [
    { number: '13', name: 'CANDIDATO A', party: 'PARTIDO A' },
    { number: '22', name: 'CANDIDATO B', party: 'PARTIDO B' },
  ];
  // Ciclo de incidentes simulados (em ms de demonstração, repetido a cada 10 minutos).
  const INCIDENTES = [
    { de: 150000, ate: 190000, tipo: 'rede' },
    { de: 240000, ate: 300000, tipo: 'mapa-parcial' },
    { de: 330000, ate: 365000, tipo: 'stale' },
    { de: 400000, ate: 430000, tipo: 'fora-de-ordem' },
  ];

  function aleatorio(semente) {
    let s = semente >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  const sorteio = aleatorio(20261025);
  const PERFIL = Object.fromEntries(C.UFS.map((uf, i) => {
    const grupoA = C.ORDEM_ROTACAO.indexOf(uf) % 2 === 0;
    return [uf, {
      secoes: 1500 + Math.round(sorteio() * 40000),
      // UFs do grupo A apuram mais cedo e favorecem o candidato A: provoca virada depois.
      fatiaA: grupoA ? 0.55 + sorteio() * 0.1 : 0.36 + sorteio() * 0.1,
      ritmoCedo: grupoA ? 0.5 : 0.12,
      ritmoTarde: 0.45,
      semente: 1000 + i * 7919,
    }];
  }));

  function progresso(uf, passo) {
    const p = PERFIL[uf], r = aleatorio(p.semente);
    let feito = 0;
    for (let k = 1; k <= passo && feito < 1; k++) {
      const chance = k <= 8 ? p.ritmoCedo : p.ritmoTarde;
      if (r() < chance) feito = Math.min(1, feito + 0.08 + r() * 0.17);
      else r();
    }
    return feito;
  }

  function criar(inicioReal, ritmo) {
    const velocidade = Math.max(1, Math.min(20, Number(ritmo) || 1));
    const relogio = () => (Date.now() - inicioReal) * velocidade;
    const passoEm = t => (t < ESPERA_INICIAL ? 0 : 1 + Math.floor((t - ESPERA_INICIAL) / PASSO));
    const incidente = t => (INCIDENTES.find(i => (t % 600000) >= i.de && (t % 600000) < i.ate) || {}).tipo;
    const quando = passo => new Date(inicioReal + (ESPERA_INICIAL + (passo - 1) * PASSO) / velocidade).toISOString();

    function estado(uf, passo) {
      const p = PERFIL[uf], feito = progresso(uf, passo);
      const contadas = Math.round(p.secoes * feito);
      const validos = Math.round(contadas * 276);
      const a = Math.round(validos * p.fatiaA);
      const candidatos = [
        { ...CANDIDATOS[0], votes: a },
        { ...CANDIDATOS[1], votes: validos - a },
      ].map(c => ({ ...c, percentage: validos ? Math.round((c.votes / validos) * 10000) / 100 : 0, elected: false, status: '' }))
        .sort((x, y) => y.votes - x.votes);
      return {
        uf, stage: feito >= 1 ? 'final' : contadas > 0 ? 'counting' : 'waiting',
        sections: { counted: contadas, total: p.secoes, percentage: Math.round((contadas / p.secoes) * 10000) / 100 },
        candidates: candidatos, publishedAt: contadas > 0 ? quando(passo) : null,
        votos: { valid: validos, total: Math.round(validos / 0.953) },
      };
    }

    function nacionalNoPasso(passo) {
      const estados = C.UFS.map(uf => estado(uf, passo));
      const soma = (f) => estados.reduce((t, e) => t + f(e), 0);
      const contadas = soma(e => e.sections.counted), total = soma(e => e.sections.total);
      const validos = soma(e => e.votos.valid), totalVotos = soma(e => e.votos.total);
      const brancos = Math.round(totalVotos * 0.018), nulos = totalVotos - validos - brancos;
      const porNumero = n => soma(e => e.candidates.find(c => c.number === n).votes);
      const final = estados.every(e => e.stage === 'final');
      const candidatos = CANDIDATOS.map(c => ({ ...c, votes: porNumero(c.number) }))
        .map(c => ({ ...c, percentage: validos ? Math.round((c.votes / validos) * 10000) / 100 : 0, elected: false, status: '' }))
        .sort((x, y) => y.votes - x.votes);
      const pct = n => (totalVotos ? Math.round((n / totalVotos) * 10000) / 100 : null);
      return {
        ok: true, source: 'DEMONSTRAÇÃO', demo: true, election: '2026-2', office: 'presidente', uf: 'BR',
        stage: final ? 'final' : contadas > 0 ? 'counting' : 'waiting',
        publishedAt: contadas > 0 ? quando(passo) : null, fetchedAt: new Date().toISOString(),
        sections: { counted: contadas, total, percentage: total ? Math.round((contadas / total) * 10000) / 100 : 0 },
        votes: { total: totalVotos, valid: validos, blank: brancos, null: nulos, validPercentage: pct(validos), blankPercentage: pct(brancos), nullPercentage: pct(nulos) },
        candidates: candidatos, sourceUrl: null,
      };
    }

    const atraso = () => new Promise(r => setTimeout(r, 120));
    return {
      demo: true,
      inicioApuracao: inicioReal + ESPERA_INICIAL / velocidade,
      async nacional() {
        await atraso();
        const t = relogio(), tipo = incidente(t), passo = passoEm(t);
        if (tipo === 'rede') throw new Error('Falha de rede simulada');
        if (tipo === 'stale' && passo > 1) return { ...nacionalNoPasso(passo - 1), stale: true };
        return nacionalNoPasso(passo);
      },
      async mapa() {
        await atraso();
        const t = relogio(), tipo = incidente(t), passo = passoEm(t);
        if (tipo === 'rede') throw new Error('Falha de rede simulada');
        if (passo === 0) return { ok: true, source: 'DEMONSTRAÇÃO', demo: true, stage: 'scheduled', states: [], errors: 0 };
        let estados = C.UFS.map(uf => {
          const e = estado(uf, passo);
          return { uf: e.uf, stage: e.stage, sections: e.sections, candidates: e.candidates, publishedAt: e.publishedAt };
        });
        if (tipo === 'fora-de-ordem' && passo > 2) {
          // Duas UFs voltam a uma fotografia antiga, sem marcação stale: deve ser ignorada.
          estados = estados.map(e => (['SP', 'BA'].includes(e.uf) ? { ...e, ...estado(e.uf, passo - 2), votos: undefined } : e));
        }
        const missing = tipo === 'mapa-parcial' ? ['RS', 'PE', 'AM', 'GO'] : [];
        estados = estados.filter(e => !missing.includes(e.uf));
        return { ok: true, source: 'DEMONSTRAÇÃO', demo: true, stage: 'counting', states: estados, errors: missing.length, partial: missing.length > 0, missing };
      },
    };
  }

  root.TransmissaoDemo = { criar };
})(typeof self !== 'undefined' ? self : this);
