/* Apoio e compartilhamento do Atlas: pedidos de apoio (3 e 30 min de navegação ativa),
   card de compartilhamento perto dos resultados, botão compacto no celular e cópia do Pix.
   Sem cookies e sem rastreamento: só um registro local (localStorage) com os horários.
   Não é carregado na página da transmissão (transmissao.html). */
(() => {
  'use strict';
  const C = window.AtlasApoioCore;
  const SITE = 'https://www.atlaseleitoral.org';
  const CHAVE_ESTADO = 'atlas-apoio-v1';
  const TEXTO_SITE = 'Estou acompanhando as eleições pelo Atlas Eleitoral! Tem mapas interativos, resultados históricos, comparador e apuração ao vivo.\n\nÉ um projeto independente e gratuito.\n\nConfira:\n';
  const caminho = location.pathname.replace(/\/+$/, '') || '/';
  const NA_APOIO = /\/apoiar(\.html)?$/.test(caminho);
  const NO_COMPARADOR = /\/comparar(\.html)?$/.test(caminho);

  // ---------- armazenamento local (falha silenciosa: segue só nesta página) ----------
  let memoria = null;
  function lerEstado(agora) {
    let salvo = memoria;
    try { salvo = JSON.parse(localStorage.getItem(CHAVE_ESTADO) || 'null') || memoria; } catch (e) { /* bloqueado */ }
    return C.normalizar(salvo, agora);
  }
  function salvarEstado(e) {
    memoria = e;
    try { localStorage.setItem(CHAVE_ESTADO, JSON.stringify(e)); } catch (err) { /* bloqueado */ }
  }

  // ---------- cópia e compartilhamento ----------
  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); return true; } catch (e) { /* tenta o método antigo */ }
    const ta = document.createElement('textarea');
    ta.value = texto; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  const linkRecorte = () => SITE + '/comparar.html' + location.search;
  const whatsapp = (texto, url) => 'https://wa.me/?text=' + encodeURIComponent(texto + url);

  let avisoTimer = null;
  function avisar(msg, origem) {
    const local = origem && origem.closest('[data-aa-bloco]')?.querySelector('.aa-status');
    const alvo = local || aviso();
    alvo.textContent = msg;
    alvo.classList.add('visivel');
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(() => { alvo.classList.remove('visivel'); if (!local) alvo.textContent = ''; }, 3200);
  }
  let elAviso = null;
  function aviso() {
    if (!elAviso) {
      elAviso = document.createElement('div');
      elAviso.className = 'aa-toast'; elAviso.setAttribute('role', 'status'); elAviso.setAttribute('aria-live', 'polite');
      document.body.appendChild(elAviso);
    }
    return elAviso;
  }

  async function compartilhar(origem, recorte) {
    const url = recorte ? linkRecorte() : SITE;
    const texto = recorte ? 'Veja esta comparação no Atlas Eleitoral, um projeto independente e gratuito:\n' : TEXTO_SITE;
    if (navigator.share) {
      try { await navigator.share({ title: 'Atlas Eleitoral', text: texto.replace(/\n+[^\n]*:\n$/, '').trim(), url }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; /* sem suporte real: usa a alternativa */ }
    }
    abrirFolha(origem, texto, url);
  }

  // Alternativa ao compartilhamento nativo: painel com WhatsApp e cópia do link.
  let folha = null;
  function abrirFolha(origem, texto, url) {
    fecharPainel();
    folha = document.createElement('section');
    folha.className = 'aa-painel aa-folha';
    folha.setAttribute('role', 'dialog'); folha.setAttribute('aria-modal', 'false'); folha.setAttribute('aria-labelledby', 'aa-folha-titulo');
    folha.dataset.aaBloco = '';
    folha.innerHTML = `<button type="button" class="aa-fechar" data-aa-acao="fechar" aria-label="Fechar">×</button>
      <h2 id="aa-folha-titulo" tabindex="-1">Compartilhar o Atlas</h2>
      <p>Escolha como enviar o link.</p>
      <div class="aa-acoes">
        <a class="aa-btn aa-principal" href="${whatsapp(texto, url)}" target="_blank" rel="noopener">WhatsApp</a>
        <button type="button" class="aa-btn" data-aa-acao="copiar-url" data-url="${url}">Copiar link</button>
      </div>
      <p class="aa-status" role="status" aria-live="polite"></p>`;
    document.body.appendChild(folha);
    painelAberto(folha, origem);
  }

  // ---------- pedidos de apoio ----------
  const PEDIDOS = {
    1: {
      titulo: 'O Atlas nasceu de uma vontade simples.',
      texto: ['Eu queria uma forma mais clara de acompanhar as eleições. Então decidi criar o Atlas por conta própria, sem patrocinadores e sem ligação com partidos ou campanhas políticas.',
        'Foram muitas horas de dedicação para transformar essa ideia em um projeto gratuito e acessível para todos.',
        'Se o Atlas está sendo útil para você, qualquer contribuição, por menor que seja, me ajuda a manter esse projeto vivo e continuar melhorando.',
        'Obrigado de coração por estar aqui!'],
      apoiar: 'Quero apoiar o Atlas', depois: 'Continuar acompanhando',
    },
    2: {
      titulo: 'Que bom ter você por aqui!',
      texto: ['Obrigado por continuar acompanhando as eleições pelo Atlas!',
        'Esse projeto começou com uma ideia e muito trabalho. Hoje, já reúne mapas interativos, comparações e informações oficiais acessíveis gratuitamente para todos.',
        'Se você acredita que iniciativas independentes como esta merecem continuar, sua contribuição pode ajudar a fazer isso acontecer.',
        'Não importa o valor. Toda ajuda é bem-vinda!'],
      apoiar: 'Ajudar o Atlas a continuar', depois: 'Agora não',
    },
  };
  let painel = null, focoAnterior = null;
  // Painéis não bloqueiam a página. O foco vai para o painel quando ele foi pedido (origem)
  // ou quando ninguém está digitando/escolhendo algo; assim um pedido não rouba o foco.
  function painelAberto(el, origem) {
    painel = el;
    const ativo = document.activeElement;
    const livre = !ativo || ativo === document.body || !ativo.matches('input, select, textarea');
    focoAnterior = origem || (livre ? ativo : null);
    atualizarFlutuante();
    requestAnimationFrame(() => { el.classList.add('aberto'); if (origem || livre) el.querySelector('h2').focus({ preventScroll: true }); });
  }
  function fecharPainel() {
    if (!painel) return;
    const el = painel;
    painel = null; folha = null;
    el.classList.remove('aberto');
    setTimeout(() => el.remove(), 250);
    if (focoAnterior && document.contains(focoAnterior) && focoAnterior.focus) focoAnterior.focus({ preventScroll: true });
    focoAnterior = null;
    atualizarFlutuante();
  }
  function mostrarPedido(n) {
    const p = PEDIDOS[n];
    const el = document.createElement('section');
    el.className = 'aa-painel aa-pedido';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'false'); el.setAttribute('aria-labelledby', 'aa-pedido-titulo');
    el.dataset.aaBloco = ''; el.dataset.pedido = n;
    el.innerHTML = `<button type="button" class="aa-fechar" data-aa-acao="fechar" aria-label="Fechar">×</button>
      <span class="aa-selo">Apoie o Atlas</span>
      <h2 id="aa-pedido-titulo" tabindex="-1">${p.titulo}</h2>
      ${p.texto.map(t => `<p>${t}</p>`).join('')}
      <div class="aa-acoes">
        <a class="aa-btn aa-principal" href="/apoiar.html" data-aa-acao="apoiar">${p.apoiar}</a>
        <button type="button" class="aa-btn" data-aa-acao="compartilhar">Compartilhar com alguém</button>
        <button type="button" class="aa-btn aa-texto" data-aa-acao="fechar">${p.depois}</button>
      </div>
      <button type="button" class="aa-dispensar" data-aa-acao="dispensar">Não mostrar pedidos de apoio hoje</button>`;
    document.body.appendChild(el);
    painelAberto(el, null);
  }

  function registrarTempo() {
    if (document.visibilityState !== 'visible') return;
    const agora = Date.now();
    let e = C.registrar(lerEstado(agora), agora);
    const n = !NA_APOIO && !painel ? C.pedidoDevido(e) : 0;
    if (n) e = C.marcarExibido(e, n, agora); // marca antes de exibir: outra aba não repete
    salvarEstado(e);
    if (n) mostrarPedido(n);
  }

  // ---------- card de compartilhamento perto dos resultados ----------
  function cardCompartilhar() {
    const el = document.createElement('aside');
    el.className = 'aa-compartilhar';
    el.dataset.aaBloco = '';
    el.setAttribute('aria-label', 'Compartilhar o Atlas');
    el.innerHTML = `<div class="aa-compartilhar-texto"><strong>Ajude essa ideia a chegar mais longe!</strong>
        <p>Se o Atlas foi útil para você, compartilhe com alguém. Um simples compartilhamento já faz uma grande diferença!</p></div>
      <div class="aa-acoes">
        <button type="button" class="aa-btn aa-principal" data-aa-acao="compartilhar">Compartilhar Atlas</button>
        <a class="aa-btn" href="${whatsapp(TEXTO_SITE, SITE)}" target="_blank" rel="noopener">WhatsApp</a>
        <button type="button" class="aa-btn" data-aa-acao="copiar-url" data-url="${SITE}">Copiar link</button>
        ${NO_COMPARADOR ? '<button type="button" class="aa-btn" data-aa-acao="compartilhar-recorte">Compartilhar esta comparação</button>' : ''}
        <a class="aa-link" href="/apoiar.html">Apoie o Atlas →</a>
      </div>
      <p class="aa-status" role="status" aria-live="polite"></p>`;
    return el;
  }
  function inserirCard() {
    if (NA_APOIO || document.querySelector('.aa-compartilhar')) return;
    const ancora = document.querySelector('.cmp-mapa-rodape') || document.querySelector('.election-stage');
    if (ancora) ancora.insertAdjacentElement('afterend', cardCompartilhar());
  }

  // ---------- botão compacto no celular ----------
  // Some quando estaria sobre o mapa ou o placar, ou com um painel aberto.
  let flutuante = null, agendado = false;
  const SOBRE = '.map-panel, .map-box, .detail, .score, .cmp-mapas, .aa-compartilhar';
  function criarFlutuante() {
    if (NA_APOIO) return;
    flutuante = document.createElement('button');
    flutuante.type = 'button';
    flutuante.className = 'aa-flutuante';
    flutuante.dataset.aaAcao = 'compartilhar';
    flutuante.setAttribute('aria-label', 'Compartilhar o Atlas');
    flutuante.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a3 3 0 1 0-2.8-4M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm12 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8.6 13.5l6.8 4M15.4 6.5l-6.8 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Compartilhar</span>';
    document.body.appendChild(flutuante);
    addEventListener('scroll', atualizarFlutuante, { passive: true });
    addEventListener('resize', atualizarFlutuante);
    atualizarFlutuante();
  }
  function atualizarFlutuante() {
    if (!flutuante || agendado) return;
    agendado = true;
    requestAnimationFrame(() => {
      agendado = false;
      const r = flutuante.getBoundingClientRect();
      const faixa = { top: innerHeight - 90, bottom: innerHeight, left: r.left - 8, right: r.right + 8 };
      const cobre = [...document.querySelectorAll(SOBRE)].some(el => {
        const b = el.getBoundingClientRect();
        return b.bottom > faixa.top && b.top < faixa.bottom && b.right > faixa.left && b.left < faixa.right;
      });
      flutuante.classList.toggle('oculto', cobre || !!painel);
    });
  }

  // ---------- ações (delegação) ----------
  document.addEventListener('click', async ev => {
    const alvo = ev.target.closest('[data-aa-acao]');
    if (!alvo) return;
    const acao = alvo.dataset.aaAcao;
    if (acao === 'fechar') fecharPainel();
    else if (acao === 'dispensar') { salvarEstado(C.dispensar(lerEstado(Date.now()), Date.now())); fecharPainel(); avisar('Tudo bem! Não vamos mostrar pedidos de apoio hoje.'); }
    else if (acao === 'apoiar') salvarEstado(C.apoiar(lerEstado(Date.now()), Date.now())); // segue o link
    else if (acao === 'compartilhar') { if (alvo.closest('.aa-pedido')) fecharPainel(); compartilhar(alvo, false); }
    else if (acao === 'compartilhar-recorte') compartilhar(alvo, true);
    else if (acao === 'copiar-url') avisar(await copiar(alvo.dataset.url) ? 'Link copiado!' : 'Não foi possível copiar. Selecione o endereço: ' + alvo.dataset.url, alvo);
    else if (acao === 'copiar-chave' || acao === 'copiar-codigo') {
      const P = window.AtlasPix;
      const ok = P && await copiar(acao === 'copiar-chave' ? P.CHAVE : P.CODIGO);
      avisar(ok ? (acao === 'copiar-chave' ? 'Chave Pix copiada!' : 'Código Pix Copia e Cola copiado!') : 'Não foi possível copiar automaticamente. Selecione o texto e copie.', alvo);
    }
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && painel) fecharPainel(); });

  // ---------- início ----------
  inserirCard();
  criarFlutuante();
  registrarTempo();
  setInterval(registrarTempo, 1000);
  document.addEventListener('visibilitychange', registrarTempo);
  // Conferência nos testes automatizados.
  window.__atlasApoio = { lerEstado: () => lerEstado(Date.now()), constantes: { P1: C.PEDIDO_1_MS, P2: C.PEDIDO_2_MS, CICLO: C.CICLO_MS } };
})();
