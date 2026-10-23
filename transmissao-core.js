/* Núcleo da transmissão: comparação de dados oficiais, detecção de novas parciais e
   diretor de cenas. Sem DOM e sem relógio próprio: roda no navegador e nos testes (Node). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TransmissaoCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
  const NOMES = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' };
  const REGIOES = { AC: 'N', AP: 'N', AM: 'N', PA: 'N', RO: 'N', RR: 'N', TO: 'N', AL: 'NE', BA: 'NE', CE: 'NE', MA: 'NE', PB: 'NE', PE: 'NE', PI: 'NE', RN: 'NE', SE: 'NE', DF: 'CO', GO: 'CO', MT: 'CO', MS: 'CO', ES: 'SE', MG: 'SE', RJ: 'SE', SP: 'SE', PR: 'S', RS: 'S', SC: 'S' };
  // Ordem de desempate da rotação: alterna regiões, sem critério de candidato ou partido.
  // Nenhuma região se repete em posições vizinhas.
  const ORDEM_ROTACAO = ['SP', 'BA', 'RS', 'PA', 'PE', 'GO', 'MG', 'CE', 'PR', 'AM', 'MA', 'DF', 'RJ', 'PB', 'SC', 'TO', 'RN', 'MT', 'ES', 'PI', 'RO', 'AL', 'AC', 'MS', 'AP', 'SE', 'RR'];
  const INICIO = Date.parse('2026-10-25T17:00:00-03:00');

  // Tempos em milissegundos; podem ser alterados pela URL (ver transmissao.js).
  const CONFIG = {
    nacionalMs: 20000,
    estadoMs: 15000,
    parcialMs: 15000,
    seloParcialMs: 6000,
    nacionalEntreParciaisMs: 12000, // visão nacional mais curta quando há fila de parciais
    filaMax: 6,
    recargaUfMs: 4 * 60000, // mesma UF não volta como nova parcial antes disso
    consultaNacionalMs: 30000,
    consultaMapaMs: 60000,
    consultaPreMapaMs: 120000,
    repetirMinMs: 15000,
    repetirMaxMs: 120000,
  };

  const RANK = { scheduled: 0, waiting: 1, counting: 2, final: 3 };
  const votosTotais = s => (s && Array.isArray(s.candidates) ? s.candidates.reduce((t, c) => t + (Number(c.votes) || 0), 0) : 0);
  const secoes = s => Number(s && s.sections && s.sections.counted) || 0;

  /* Ordena duas fotografias oficiais do mesmo recorte: 1 se b é mais recente que a,
     -1 se é mais antiga, 0 se é a mesma divulgação. fetchedAt é ignorado de propósito:
     uma nova consulta do mesmo arquivo do TSE não é uma nova parcial. */
  function compararFotografias(a, b) {
    if (!a) return b ? 1 : 0;
    if (!b) return -1;
    const ra = RANK[a.stage] ?? 0, rb = RANK[b.stage] ?? 0;
    if (ra !== rb) return rb > ra ? 1 : -1;
    const sa = secoes(a), sb = secoes(b);
    if (sa !== sb) return sb > sa ? 1 : -1;
    const va = votosTotais(a), vb = votosTotais(b);
    if (va !== vb) return vb > va ? 1 : -1;
    const pa = Date.parse(a.publishedAt) || 0, pb = Date.parse(b.publishedAt) || 0;
    if (pa !== pb) return pb > pa ? 1 : -1;
    return 0;
  }

  const temVotos = s => !!s && (secoes(s) > 0 || votosTotais(s) > 0);

  /* Incorpora a resposta de /api/mapa ao estado conhecido. Mantém, por UF, a fotografia
     mais recente (respostas fora de ordem são ignoradas) e preserva UFs ausentes de uma
     resposta parcial. Só aponta nova parcial quando já havia uma fotografia anterior da
     UF e a nova é mais recente, oficial (não stale) e com votos. */
  function incorporarMapa(conhecidos, resposta, agora) {
    const estados = new Map(conhecidos);
    const novidades = [];
    let ignoradas = 0;
    const recebidas = new Set();
    for (const s of (resposta && resposta.states) || []) {
      if (!s || !UFS.includes(s.uf)) continue;
      recebidas.add(s.uf);
      const anterior = conhecidos.get(s.uf);
      const ordem = compararFotografias(anterior && anterior.dados, s);
      if (ordem < 0) { ignoradas++; continue; }
      if (ordem === 0 && anterior) { estados.set(s.uf, { ...anterior, ausente: false, stale: !!s.stale }); continue; }
      estados.set(s.uf, { dados: s, recebidoEm: agora, ausente: false, stale: !!s.stale });
      // Fotografia restaurada após recarga da página não serve de base para "nova parcial".
      if (anterior && !anterior.restaurado && !s.stale && temVotos(s)) {
        const antes = Number(anterior.dados.sections && anterior.dados.sections.percentage) || 0;
        const depois = Number(s.sections && s.sections.percentage) || 0;
        novidades.push({ uf: s.uf, deltaSecoes: Math.round((depois - antes) * 100) / 100, secoes: depois, em: agora });
      }
    }
    for (const [uf, item] of estados) if (!recebidas.has(uf)) estados.set(uf, { ...item, ausente: true });
    return { estados, novidades, ignoradas, ausentes: UFS.filter(uf => !recebidas.has(uf)) };
  }

  /* Diretor de cenas. Cenas: 'pre' (antes dos votos), 'nacional', 'estado' (rotação) e
     'parcial' (estado com nova parcial). Nova parcial entra após a cena atual, sempre
     intercalada com a visão nacional. */
  class Diretor {
    constructor(config, agora) {
      this.c = { ...CONFIG, ...(config || {}) };
      this.fila = [];
      this.ultimaExibicao = new Map();
      this.ultimaParcial = new Map();
      this.ultimaRegiao = null;
      this.seq = 0;
      this.cena = this._nova('nacional', null, agora, this.c.nacionalMs);
    }
    _nova(tipo, uf, agora, duracao, extra) {
      return { id: ++this.seq, tipo, uf, inicio: agora, fim: agora + duracao, ...(extra || {}) };
    }
    enfileirar(novidades, agora) {
      for (const n of novidades || []) {
        if (agora - (this.ultimaParcial.get(n.uf) || -Infinity) < this.c.recargaUfMs) continue;
        const relevancia = Math.max(0, n.deltaSecoes || 0);
        const existente = this.fila.find(f => f.uf === n.uf);
        // Nova atualização de UF já na fila: soma o avanço e preserva o tempo de espera.
        if (existente) existente.relevancia += relevancia;
        else this.fila.push({ uf: n.uf, relevancia, em: n.em ?? agora });
      }
      this._ordenar(agora);
      if (this.fila.length > this.c.filaMax) this.fila.length = this.c.filaMax;
    }
    // Prioridade: avanço de seções (p.p.) + 1 ponto por minuto na fila + 0,5 ponto por
    // minuto sem a UF aparecer na tela (até 20 min). Assim UFs com avanços menores ou
    // há muito tempo fora do ar não ficam sempre para trás. Empate: a mais antiga.
    _ordenar(agora) {
      const semExibir = uf => { const v = this.ultimaExibicao.get(uf); return v == null ? 20 : Math.min(20, (agora - v) / 60000); };
      const pontos = f => f.relevancia + (agora - f.em) / 60000 + semExibir(f.uf) * 0.5;
      this.fila.sort((a, b) => pontos(b) - pontos(a) || a.em - b.em);
    }
    _proximaParcial(agora) {
      this._ordenar(agora);
      const elegiveis = this.fila.filter(f => agora - (this.ultimaParcial.get(f.uf) || -Infinity) >= this.c.recargaUfMs);
      if (!elegiveis.length) return null;
      // Evita repetir a mesma região em sequência quando houver alternativa.
      const escolhido = elegiveis.find(f => REGIOES[f.uf] !== this.ultimaRegiao) || elegiveis[0];
      this.fila = this.fila.filter(f => f !== escolhido);
      return escolhido;
    }
    _proximaRotacao(disponiveis) {
      const lista = ORDEM_ROTACAO.filter(uf => disponiveis.includes(uf));
      if (!lista.length) return null;
      const peso = uf => this.ultimaExibicao.get(uf) ?? -Infinity;
      lista.sort((a, b) => peso(a) - peso(b) || (REGIOES[a] === this.ultimaRegiao) - (REGIOES[b] === this.ultimaRegiao) || ORDEM_ROTACAO.indexOf(a) - ORDEM_ROTACAO.indexOf(b));
      return lista[0];
    }
    /* contexto: { modo: 'pre' | 'apuracao', disponiveis: [UFs com dados exibíveis] } */
    avancar(agora, contexto) {
      const ctx = contexto || {};
      if (ctx.modo === 'pre') {
        if (this.cena.tipo !== 'pre') this.cena = this._nova('pre', null, agora, Infinity);
        return this.cena;
      }
      if (this.cena.tipo === 'pre') { this.cena = this._nova('nacional', null, agora, this.c.nacionalMs); return this.cena; }
      if (agora < this.cena.fim) return this.cena;
      const disponiveis = ctx.disponiveis || [];
      if (this.cena.tipo !== 'nacional') {
        const curta = this.fila.length > 0;
        this.cena = this._nova('nacional', null, agora, curta ? this.c.nacionalEntreParciaisMs : this.c.nacionalMs);
        return this.cena;
      }
      const parcial = this._proximaParcial(agora);
      if (parcial && disponiveis.includes(parcial.uf)) {
        this.ultimaParcial.set(parcial.uf, agora);
        return this._exibir('parcial', parcial.uf, agora, this.c.parcialMs, { deltaSecoes: parcial.relevancia });
      }
      const uf = this._proximaRotacao(disponiveis);
      if (!uf) { this.cena = this._nova('nacional', null, agora, this.c.nacionalMs); return this.cena; }
      return this._exibir('estado', uf, agora, this.c.estadoMs);
    }
    _exibir(tipo, uf, agora, duracao, extra) {
      this.ultimaExibicao.set(uf, agora);
      this.ultimaRegiao = REGIOES[uf];
      this.cena = this._nova(tipo, uf, agora, duracao, extra);
      return this.cena;
    }
  }

  /* Fase da transmissão a partir da resposta nacional oficial. */
  function fase(nacional) {
    if (!nacional || !nacional.ok) return 'pre';
    if (nacional.stage === 'final') return 'final';
    if (nacional.stage === 'counting' && temVotos(nacional)) return 'apuracao';
    return 'pre';
  }

  const fmtInt = n => new Intl.NumberFormat('pt-BR').format(Number(n) || 0);
  const fmtPct = n => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0) + '%';
  function horaBrasilia(iso, comSegundos) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', ...(comSegundos ? { second: '2-digit' } : {}) });
  }
  function contagem(ms) {
    if (ms <= 0) return '00:00:00';
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return [h, m, r].map(v => String(v).padStart(2, '0')).join(':');
  }

  return { UFS, NOMES, REGIOES, ORDEM_ROTACAO, INICIO, CONFIG, compararFotografias, incorporarMapa, temVotos, fase, Diretor, fmtInt, fmtPct, horaBrasilia, contagem };
});
