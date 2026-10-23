/* Página de transmissão (OBS, 1920x1080). Consome somente as APIs públicas do Atlas na
   Vercel, nas URLs canônicas e sem quebra de cache, mesmo quando servida localmente. */
(() => {
  'use strict';
  const C = window.TransmissaoCore;
  const API = 'https://atlasdaselei-es.vercel.app';
  const URL_NACIONAL = API + '/api/apuracao?cargo=presidente&uf=BR';
  const URL_MAPA = API + '/api/mapa';
  const CHAVE_MEMORIA = 'atlas-transmissao-v1';
  const params = new URLSearchParams(location.search);
  // Demonstração só com pedido explícito; o modo real nunca cai nela automaticamente.
  const DEMO = params.get('demo') === '1';
  // Na demonstração, nada é rotulado como oficial.
  const ARQUIVO = DEMO ? 'Horário simulado' : 'Arquivo oficial do TSE';

  // Tempos de cena configuráveis pela URL, em segundos: ?nacional=20&estado=15&parcial=15
  const config = { ...C.CONFIG };
  for (const [param, chave] of [['nacional', 'nacionalMs'], ['estado', 'estadoMs'], ['parcial', 'parcialMs']]) {
    const s = Number(params.get(param));
    if (Number.isFinite(s) && s >= 5 && s <= 300) config[chave] = s * 1000;
  }

  const $ = id => document.getElementById(id);
  const safe = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const { fmtInt, fmtPct, horaBrasilia, NOMES } = C;

  const estado = {
    nacional: null,           // última fotografia nacional oficial válida
    estados: new Map(),       // UF -> { dados, recebidoEm, ausente, stale, restaurado }
    fonteIndisponivel: false, // a API sinalizou stale (TSE fora do ar)
    falhasNacional: 0, falhasMapa: 0,
    ultimaConsultaOk: 0,
    restaurado: false,
    ausentes: [],
    respostasAntigasIgnoradas: 0,
    versao: 0,
  };
  let fonte = null, inicioApuracao = C.INICIO, diretor = null, mapa = null;

  // ---------- fontes de dados ----------
  async function obter(url, limiteMs) {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), limiteMs);
    try {
      const r = await fetch(url, { signal: controle.signal, cache: 'default', credentials: 'omit' });
      const corpo = await r.json().catch(() => null);
      if (!r.ok || !corpo || corpo.ok !== true) throw new Error((corpo && corpo.error) || 'HTTP ' + r.status);
      return corpo;
    } finally { clearTimeout(timer); }
  }
  const fonteReal = {
    demo: false,
    nacional: () => obter(URL_NACIONAL, 12000),
    mapa: () => obter(URL_MAPA, 26000), // o /api/mapa pode levar até ~22s num MISS
  };

  // ---------- memória entre recargas (somente modo real) ----------
  function salvar() {
    if (DEMO || !estado.nacional) return;
    try {
      localStorage.setItem(CHAVE_MEMORIA, JSON.stringify({ salvoEm: Date.now(), nacional: estado.nacional, estados: [...estado.estados].map(([uf, e]) => [uf, e.dados]) }));
    } catch (e) { /* armazenamento indisponível: segue só em memória */ }
  }
  function restaurar() {
    if (DEMO) return;
    try {
      const m = JSON.parse(localStorage.getItem(CHAVE_MEMORIA) || 'null');
      if (!m || Date.now() - m.salvoEm > 12 * 3600000 || m.nacional?.election !== '2026-2' || m.nacional?.source !== 'TSE') return;
      estado.nacional = m.nacional;
      for (const [uf, dados] of m.estados || []) if (C.UFS.includes(uf)) estado.estados.set(uf, { dados, recebidoEm: m.salvoEm, ausente: false, stale: false, restaurado: true });
      estado.restaurado = true;
      estado.versao++;
    } catch (e) { /* memória corrompida ou bloqueada: ignora */ }
  }

  // ---------- incorporação dos dados ----------
  function aceitarNacional(d) {
    // stale: a API do Atlas devolveu o último arquivo válido porque o TSE falhou.
    estado.fonteIndisponivel = !!d.stale;
    const ordem = C.compararFotografias(estado.nacional, d);
    // Resposta mais antiga que a já exibida (outro nó do CDN, por exemplo) é descartada.
    if (ordem < 0) estado.respostasAntigasIgnoradas++;
    else if (ordem > 0 || estado.restaurado) { estado.nacional = d; estado.versao++; }
    estado.restaurado = false;
  }
  function aceitarMapa(r) {
    const res = C.incorporarMapa(estado.estados, r, Date.now());
    const comEstados = !!(r.states && r.states.length);
    // UFs confirmadas por uma consulta nova deixam de ser "restauradas".
    estado.estados = new Map([...res.estados].map(([uf, e]) => [uf, comEstados && !res.ausentes.includes(uf) ? { ...e, restaurado: false } : e]));
    estado.ausentes = comEstados ? res.ausentes : [];
    estado.respostasAntigasIgnoradas += res.ignoradas;
    if (diretor && res.novidades.length) diretor.enfileirar(res.novidades, Date.now());
    estado.versao++;
  }

  function agendar(fn, ms) { setTimeout(fn, ms); }
  const espera = falhas => Math.min(config.repetirMaxMs, config.repetirMinMs * 2 ** Math.max(0, falhas - 1));

  async function cicloNacional() {
    let proxima = config.consultaNacionalMs;
    try {
      const antes = C.fase(estado.nacional);
      aceitarNacional(await fonte.nacional());
      estado.falhasNacional = 0;
      estado.ultimaConsultaOk = Date.now();
      salvar();
      // Começo da apuração: busca o mapa imediatamente.
      if (antes === 'pre' && C.fase(estado.nacional) !== 'pre') cicloMapa(true);
    } catch (e) {
      estado.falhasNacional++;
      proxima = espera(estado.falhasNacional);
    } finally {
      estado.versao++;
      agendar(cicloNacional, proxima);
    }
  }
  let mapaEmCurso = false;
  async function cicloMapa(avulso) {
    if (mapaEmCurso) return;
    mapaEmCurso = true;
    let proxima = C.fase(estado.nacional) === 'pre' ? config.consultaPreMapaMs : config.consultaMapaMs;
    try {
      aceitarMapa(await fonte.mapa());
      estado.falhasMapa = 0;
      salvar();
    } catch (e) {
      estado.falhasMapa++;
      proxima = espera(estado.falhasMapa);
    } finally {
      mapaEmCurso = false;
      estado.versao++;
      if (!avulso) agendar(() => cicloMapa(false), proxima);
    }
  }

  // ---------- mapa ----------
  const COR = { '13': [224, 90, 104], '22': [63, 143, 230] };
  const OUTRAS = [[154, 127, 209], [226, 162, 59], [74, 163, 138]];
  const NEUTRO = [213, 220, 207];
  function corCandidato(c, i) { return COR[c?.number] || OUTRAS[(i || 0) % OUTRAS.length]; }
  const rgb = v => `rgb(${v.map(Math.round).join(',')})`;
  function corEstado(dados) {
    if (!dados || !C.temVotos(dados) || !dados.candidates?.length) return rgb(NEUTRO);
    const [a, b] = dados.candidates;
    const margem = (a.percentage || 0) - (b?.percentage || 0);
    const forca = Math.min(1, 0.38 + margem / 28);
    const base = corCandidato(a, 0);
    return rgb(NEUTRO.map((n, i) => n * (1 - forca) + base[i] * forca));
  }

  async function montarMapa() {
    const r = await fetch('assets/transmissao-estados.json', { cache: 'default' });
    const geo = await r.json();
    const [, , W, H] = geo.viewBox;
    const svg = $('mapa');
    svg.setAttribute('viewBox', geo.viewBox.join(' '));
    let html = '';
    for (const [uf, e] of Object.entries(geo.estados)) html += `<path class="uf" data-uf="${uf}" d="${e.d}"></path>`;
    for (const [uf, e] of Object.entries(geo.estados)) html += `<text class="sigla" data-uf="${uf}" x="${e.rotulo[0]}" y="${e.rotulo[1]}">${uf}</text>`;
    $('camera').innerHTML = html;
    mapa = { geo, W, H };
  }
  function enquadrar(uf) {
    if (!mapa) return;
    const cam = $('camera'), svg = $('mapa');
    if (!uf) {
      cam.style.transform = 'translate(0px,0px) scale(1)';
      svg.style.setProperty('--zoom', 1);
      svg.classList.remove('foco');
      return;
    }
    const [x, y, w, h] = mapa.geo.estados[uf].caixa;
    const s = Math.max(1, Math.min(3, 0.55 * Math.min(mapa.W / w, mapa.H / h)));
    const cx = x + w / 2, cy = y + h / 2;
    cam.style.transform = `translate(${mapa.W / 2}px,${mapa.H / 2}px) scale(${s}) translate(${-cx}px,${-cy}px)`;
    svg.style.setProperty('--zoom', s);
    svg.classList.add('foco');
  }
  function pintarMapa(cena) {
    if (!mapa) return;
    const ativo = cena.uf;
    for (const el of $('camera').querySelectorAll('[data-uf]')) {
      const uf = el.dataset.uf;
      el.classList.toggle('ativo', uf === ativo);
      if (el.tagName === 'path') el.style.fill = C.fase(estado.nacional) === 'pre' ? rgb(NEUTRO) : corEstado(estado.estados.get(uf)?.dados);
    }
  }

  // ---------- placar ----------
  function linhasCandidatos(lista, semValores) {
    return lista.map((c, i) => {
      const cor = rgb(corCandidato(c, i));
      const pct = semValores ? '—' : fmtPct(c.percentage);
      const votos = semValores ? 'Aguardando votos' : fmtInt(c.votes) + ' votos';
      const eleito = !semValores && c.elected && C.fase(estado.nacional) === 'final' ? '<em class="eleito">Eleito, segundo o TSE</em>' : '';
      return `<div class="cand" style="--cor:${cor}">
        <span class="cor"></span>
        <div class="nome"><strong>${safe(c.name)}</strong><small>${safe(c.party)} · ${safe(c.number)}</small>${eleito}</div>
        <div class="num"><strong>${pct}</strong><small>${votos}</small></div>
        <div class="trilho"><i style="width:${semValores ? 0 : Math.max(0, Math.min(100, c.percentage || 0))}%"></i></div>
      </div>`;
    }).join('');
  }
  function blocoSecoes(s, rotulo) {
    const pct = Math.max(0, Math.min(100, s?.percentage || 0));
    return `<div class="secoes"><div class="secoes-topo"><span>${rotulo}</span><strong>${fmtPct(pct)}</strong></div>
      <div class="trilho largo"><i style="width:${pct}%"></i></div>
      <small>${fmtInt(s?.counted)} de ${fmtInt(s?.total)} seções</small></div>`;
  }
  function placarPre() {
    const n = estado.nacional;
    const falta = inicioApuracao - Date.now();
    const candidatos = n?.candidates?.length ? `<div class="cands pre">${linhasCandidatos(n.candidates, true)}</div>` : '';
    const semConexao = !n ? `<p class="nota">${DEMO ? 'Carregando a simulação…' : 'Conectando à fonte oficial…'}</p>` : '';
    const t = DEMO
      ? { titulo: 'Aguardando início da simulação', contagem: 'Início da simulação em', iniciada: 'Simulação iniciada', primeiros: 'Aguardando os primeiros números simulados', nota: 'Demonstração com dados fictícios.' }
      : { titulo: 'Aguardando divulgação oficial', contagem: 'Divulgação a partir das 17h de Brasília', iniciada: 'Divulgação oficial iniciada', primeiros: 'Aguardando os primeiros números do TSE', nota: 'Nenhum número é exibido antes da divulgação oficial do TSE.' };
    return `<div class="eyebrow">Presidente · 2º turno · Brasil</div>
      <h1 class="aguardando">${t.titulo}</h1>
      <p class="data">Domingo, 25 de outubro de 2026</p>
      <div class="contagem">${falta > 0
        ? `<span>${t.contagem}</span><strong id="contagem">${C.contagem(falta)}</strong>`
        : `<span>${t.iniciada}</span><strong class="menor">${t.primeiros}</strong>`}</div>
      ${candidatos}${semConexao}
      <p class="nota">${t.nota}</p>`;
  }
  function placarNacional() {
    const n = estado.nacional, v = n.votes || {};
    const outros = [
      ['Válidos', v.valid, v.validPercentage], ['Brancos', v.blank, v.blankPercentage], ['Nulos', v.null, v.nullPercentage],
    ].map(([r, q, p]) => `<div><span>${r}</span><strong>${p == null ? '—' : fmtPct(p)}</strong><small>${fmtInt(q)}</small></div>`).join('');
    return `<div class="eyebrow">Presidente · 2º turno</div>
      <h1>Brasil</h1><p class="sub">Percentual de votos válidos · Brasil e exterior</p>
      <div class="cands">${linhasCandidatos(n.candidates || [], false)}</div>
      ${blocoSecoes(n.sections, 'Seções totalizadas no país')}
      <div class="outros">${outros}</div>
      <p class="arquivo">Brancos e nulos sobre o total de votos · ${ARQUIVO}: ${horaBrasilia(n.publishedAt, true)}</p>`;
  }
  function placarEstado(cena) {
    const item = estado.estados.get(cena.uf), d = item?.dados;
    if (!d) return placarNacional();
    const selo = cena.tipo === 'parcial'
      ? `<div class="selo-parcial" id="selo-parcial">Nova parcial${cena.deltaSecoes > 0 ? ` · +${fmtPct(cena.deltaSecoes).replace('%', '')} p.p. de seções` : ''}</div>` : '';
    const situacao = DEMO
      ? (d.stage === 'final' ? 'Simulação concluída no estado' : 'Simulação em andamento no estado')
      : (d.stage === 'final' ? 'Totalização concluída no estado' : 'Apuração em andamento no estado');
    const aviso = item.ausente || item.stale || item.restaurado
      ? '<p class="nota alerta">Sem atualização deste estado na última consulta — exibindo o último arquivo recebido.</p>' : '';
    return `${selo}<div class="eyebrow">${cena.tipo === 'parcial' ? 'Destaque' : 'Estado em destaque'} · Presidente · 2º turno</div>
      <h1>${safe(NOMES[cena.uf])} <span class="uf-tag">${cena.uf}</span></h1><p class="sub">${situacao}</p>
      <div class="cands">${linhasCandidatos(d.candidates || [], false)}</div>
      ${blocoSecoes(d.sections, 'Seções totalizadas no estado')}
      ${aviso}
      <p class="arquivo">${ARQUIVO} (${cena.uf}): ${horaBrasilia(d.publishedAt, true)}</p>`;
  }

  // ---------- status, avisos e rodapé ----------
  function situacao() {
    const n = estado.nacional, f = C.fase(n);
    const falhou = estado.falhasNacional > 0 || estado.falhasMapa > 0;
    let aviso = '';
    if (n && estado.fonteIndisponivel) aviso = DEMO
      ? `Dados desatualizados · falha simulada da fonte. Exibindo o último dado simulado de ${horaBrasilia(n.fetchedAt, true)}.`
      : `Dados desatualizados · fonte oficial temporariamente indisponível. Exibindo o último arquivo oficial obtido às ${horaBrasilia(n.fetchedAt, true)}.`;
    else if (n && estado.restaurado) aviso = 'Dados desatualizados · recuperados após reinício da página. Aguardando nova consulta.';
    else if (n && falhou) aviso = `Dados desatualizados · conexão instável. Exibindo a última consulta válida${estado.ultimaConsultaOk ? ' de ' + horaBrasilia(new Date(estado.ultimaConsultaOk).toISOString(), true) : ''}. Nova tentativa automática.`;
    else if (!n && falhou) aviso = DEMO ? 'Falha simulada antes do primeiro dado. Nova tentativa automática.' : 'Sem conexão com a fonte oficial. Nova tentativa automática.';
    let pill = 'conectando', texto = DEMO ? 'Carregando simulação' : 'Conectando à fonte oficial';
    if (n) {
      if (aviso) { pill = 'desatualizado'; texto = 'Dados desatualizados'; }
      else if (f === 'apuracao') { pill = 'apuracao'; texto = DEMO ? 'Simulação em andamento' : 'Apuração em andamento'; }
      else if (f === 'final') { pill = 'final'; texto = DEMO ? 'Simulação concluída' : 'Totalização concluída'; }
      else { pill = 'pre'; texto = DEMO ? 'Aguardando simulação' : 'Aguardando divulgação oficial'; }
    } else if (aviso) { pill = 'desatualizado'; texto = 'Sem conexão'; }
    return { aviso, pill, texto };
  }
  function atualizarMoldura() {
    const s = situacao();
    const st = $('status');
    st.dataset.estado = s.pill;
    $('status-texto').textContent = s.texto;
    $('aviso').hidden = !s.aviso;
    $('aviso').textContent = s.aviso;
    $('relogio').textContent = 'Brasília ' + new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('arquivo').textContent = ARQUIVO + ': ' + horaBrasilia(estado.nacional?.publishedAt, true);
    const c = $('contagem');
    if (c) c.textContent = C.contagem(inicioApuracao - Date.now());
    const selo = $('selo-parcial');
    if (selo && diretor && Date.now() - diretor.cena.inicio > config.seloParcialMs) selo.classList.add('saindo');
  }
  function atualizarLegenda() {
    const n = estado.nacional;
    $('legenda').innerHTML = (n?.candidates || []).map((c, i) => `<span><i style="background:${rgb(corCandidato(c, i))}"></i>${safe(c.name)}</span>`).join('')
      + `<span class="explica">Cor do estado: candidato com mais votos válidos já apurados — não indica resultado oficial.</span>`;
    const ausentes = estado.ausentes.length && C.fase(n) !== 'pre';
    $('mapa-nota').hidden = !ausentes;
    $('mapa-nota').textContent = ausentes ? `${estado.ausentes.length} UF(s) sem atualização na última consulta: ${estado.ausentes.join(', ')}. Exibindo os últimos dados recebidos.` : '';
  }

  // ---------- diretor e renderização ----------
  let cenaDesenhada = null, versaoDesenhada = -1;
  function disponiveis() {
    return C.UFS.filter(uf => { const e = estado.estados.get(uf); return e && C.temVotos(e.dados); });
  }
  function quadro() {
    const agora = Date.now();
    const f = C.fase(estado.nacional);
    const cena = diretor.avancar(agora, { modo: f === 'pre' ? 'pre' : 'apuracao', disponiveis: disponiveis() });
    if (!cenaDesenhada || cena.id !== cenaDesenhada.id || estado.versao !== versaoDesenhada) {
      const trocou = !cenaDesenhada || cena.id !== cenaDesenhada.id;
      const html = cena.tipo === 'pre' ? placarPre() : cena.tipo === 'nacional' ? placarNacional() : placarEstado(cena);
      const placar = $('placar');
      if (trocou) {
        placar.classList.remove('entrando');
        void placar.offsetWidth;
        placar.classList.add('entrando');
        enquadrar(cena.tipo === 'estado' || cena.tipo === 'parcial' ? cena.uf : null);
      }
      placar.innerHTML = html;
      placar.dataset.cena = cena.tipo;
      document.body.dataset.cena = cena.tipo;
      pintarMapa(cena);
      atualizarLegenda();
      cenaDesenhada = cena;
      versaoDesenhada = estado.versao;
    }
    atualizarMoldura();
  }

  // Escala a tela de 1920x1080 para caber em janelas de pré-visualização menores.
  function ajustarEscala() {
    const k = Math.min(innerWidth / 1920, innerHeight / 1080);
    $('tela').style.transform = k < 1 ? `scale(${k})` : '';
  }

  async function carregarDemo() {
    await new Promise((ok, erro) => {
      const s = document.createElement('script');
      s.src = 'transmissao-demo.js';
      s.onload = ok; s.onerror = () => erro(new Error('Demonstração indisponível'));
      document.head.appendChild(s);
    });
    return window.TransmissaoDemo.criar(Date.now(), params.get('ritmo'));
  }

  async function iniciar() {
    ajustarEscala();
    addEventListener('resize', ajustarEscala);
    if (DEMO) {
      document.body.classList.add('modo-demo');
      document.querySelector('.rodape .fonte').textContent = 'Fonte: simulação — dados fictícios, sem relação com o TSE';
      $('demo-faixa').hidden = false;
      fonte = await carregarDemo();
      inicioApuracao = fonte.inicioApuracao;
    } else {
      fonte = fonteReal;
      restaurar();
    }
    diretor = new C.Diretor(config, Date.now());
    try { await montarMapa(); } catch (e) { $('mapa-nota').hidden = false; $('mapa-nota').textContent = 'Mapa indisponível; resultados seguem no placar.'; }
    quadro();
    setInterval(quadro, 250);
    cicloNacional();
    cicloMapa(false);
    // Exposto para conferência no console e nos testes automatizados.
    window.__transmissao = { estado, config, get cena() { return diretor.cena; }, get fila() { return diretor.fila.slice(); }, demo: DEMO };
  }
  iniciar();
})();
