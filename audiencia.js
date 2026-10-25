/* Contador de audiência do Atlas (anônimo). Lê métricas de /api/audiencia (cache no CDN)
   e, se a coleta estiver ativa e este navegador estiver na amostra, envia:
   - 'pv' uma vez por carregamento de página visível (já marca o visitante como online);
   - 'hb' a cada intervalo, só com a página visível e só por uma aba do navegador.
   Se o servidor responder X-Audiencia-Coleta: 0 (fora da amostra, limite, desligado ou
   falha), esta página para de enviar por 10 minutos.
   Sem dados confirmados, mostra "Estatísticas indisponíveis" — nunca zero inventado. */
(() => {
  'use strict';
  const PASSOS = [1, 0.2, 0.05, 0.01];
  const MAX_HB_POR_PAGINA = 80; // ~4 h de presença; depois a página para de sinalizar
  const CHAVE_ID = 'atlas-aud-id', CHAVE_LIDER = 'atlas-aud-lider';
  const fmt = n => new Intl.NumberFormat('pt-BR').format(n);
  const aba = Math.random().toString(36).slice(2);
  let dados = null, timerHb = null, pvEnviado = false, pausaAte = 0, hbEnviados = 0;

  // Identificador anônimo do navegador, renovado a cada dia (sem cookie, sem IP).
  function idDoDia() {
    const dia = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE_ID) || 'null');
      if (salvo && salvo.dia === dia && /^[A-Za-z0-9_-]{16,40}$/.test(salvo.id)) return salvo.id;
    } catch (e) { /* armazenamento bloqueado */ }
    const b = new Uint8Array(16); crypto.getRandomValues(b);
    const id = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    try { localStorage.setItem(CHAVE_ID, JSON.stringify({ dia, id })); } catch (e) { /* segue só nesta página */ }
    return id;
  }
  const vid = idDoDia();
  // Participação estável na amostra: hash do identificador comparado à fração atual.
  function fracaoDoId() {
    let h = 2166136261;
    for (let i = 0; i < vid.length; i++) { h ^= vid.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h / 4294967296;
  }
  const participa = () => !!dados && dados.coleta && fracaoDoId() < PASSOS[dados.passo];

  // Uma aba visível por navegador envia presença. A liderança dura 90 s e é renovada a cada
  // 30 s; aba que vai para segundo plano libera a liderança para outra aba visível.
  let lider = false;
  function liberarLideranca() {
    try { const l = JSON.parse(localStorage.getItem(CHAVE_LIDER) || 'null'); if (l && l.aba === aba) localStorage.removeItem(CHAVE_LIDER); } catch (e) { /* nada */ }
    lider = false;
  }
  function disputarLideranca() {
    if (document.visibilityState !== 'visible') { if (lider) liberarLideranca(); return; }
    try {
      const agora = Date.now(), l = JSON.parse(localStorage.getItem(CHAVE_LIDER) || 'null');
      lider = !l || l.ate < agora || l.aba === aba;
      if (lider) localStorage.setItem(CHAVE_LIDER, JSON.stringify({ aba, ate: agora + 90000 }));
    } catch (e) { lider = true; }
  }

  function enviar(tipo) {
    if (!participa() || document.visibilityState !== 'visible' || Date.now() < pausaAte) return;
    if (tipo === 'hb' && ++hbEnviados > MAX_HB_POR_PAGINA) return;
    fetch('/api/audiencia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, credentials: 'same-origin', body: JSON.stringify({ tipo, vid, passo: dados.passo }) })
      .then(r => { if (r.headers.get('X-Audiencia-Coleta') === '0') pausaAte = Date.now() + 600000; })
      .catch(() => { pausaAte = Date.now() + 600000; });
  }

  // ---------- painel ----------
  const el = document.createElement('div');
  el.className = 'audiencia';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const estilo = document.createElement('style');
  estilo.textContent = `.audiencia{display:flex;justify-content:flex-end;align-items:center;gap:6px 14px;flex-wrap:wrap;margin:8px 0 0;font:500 12px/1.4 "Segoe UI",system-ui,sans-serif;color:var(--muted,#586b67)}
.audiencia b{color:var(--ink,#142F35);font-weight:700;font-variant-numeric:tabular-nums}.audiencia .aud-ponto{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green,#075A48);margin-right:6px;vertical-align:1px}
.audiencia .aud-off{opacity:.8}@media (max-width:600px){.audiencia{justify-content:flex-start;font-size:11px;gap:4px 12px}.audiencia .aud-extra{display:none}}`;
  document.head.appendChild(estilo);
  const ancora = document.querySelector('header.top, header.header');
  if (ancora) ancora.insertAdjacentElement('afterend', el);

  function desenhar() {
    if (!dados || !dados.disponivel) { el.innerHTML = '<span class="aud-off">Estatísticas indisponíveis</span>'; el.title = ''; return; }
    const aprox = dados.estimativa ? '≈ ' : '';
    el.innerHTML = `<span><span class="aud-ponto" aria-hidden="true"></span><b>${aprox}${fmt(dados.online)}</b> online agora</span>
      <span><b>${aprox}${fmt(dados.unicosHoje)}</b> visitantes hoje</span>
      <span class="aud-extra"><b>${aprox}${fmt(dados.visualizacoesHoje)}</b> visualizações</span>
      <span class="aud-extra">pico <b>${aprox}${fmt(dados.picoHoje)}</b></span>
      <span class="aud-extra"><b>${aprox}${fmt(dados.tempoHorasHoje)} h</b> de permanência</span>`;
    el.title = 'Online: navegadores com página aberta e visível nos últimos ' + Math.round(dados.janelaS / 60) + ' minutos. '
      + 'Visitantes: navegadores distintos no dia (estimativa). Visualizações: carregamentos de páginas do Atlas. '
      + 'Pico: maior número de simultâneos registrado hoje. Permanência: tempo de páginas visíveis (estimativa).'
      + (dados.estimativa ? ' Com muitos acessos, os números são estimados por amostragem (≈).' : '');
  }

  async function atualizar() {
    if (document.visibilityState !== 'visible') return;
    try {
      const r = await fetch('/api/audiencia', { cache: 'default', credentials: 'same-origin' });
      const j = await r.json();
      dados = r.ok && j && j.ok && j.disponivel ? j : { disponivel: false };
    } catch (e) { dados = { disponivel: false }; }
    desenhar();
    if (!pvEnviado && participa()) { pvEnviado = true; enviar('pv'); }
    if (dados.disponivel && dados.coleta && !timerHb) {
      timerHb = setInterval(() => { disputarLideranca(); if (lider) enviar('hb'); }, Math.max(60, dados.intervaloS) * 1000);
    }
    if (!(dados.disponivel && dados.coleta) && timerHb) { clearInterval(timerHb); timerHb = null; }
  }

  disputarLideranca();
  setInterval(disputarLideranca, 30000);
  atualizar(); // o painel só aparece depois da primeira leitura
  setInterval(atualizar, 60000);
  document.addEventListener('visibilitychange', () => {
    disputarLideranca(); // oculta: libera; visível: pode assumir
    if (document.visibilityState === 'visible') atualizar();
  });
  addEventListener('pagehide', liberarLideranca);
})();
