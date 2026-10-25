/* Comparador eleitoral: dois cenários presidenciais lado a lado, a partir dos arquivos
   estáticos oficiais de dados/historico/. Nenhuma consulta ao TSE ou a APIs. */
(() => {
  'use strict';
  const C = window.CompararCore;
  const $ = id => document.getElementById(id);
  const safe = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const params = new URLSearchParams(location.search);
  const valido = id => (C.cenario(id) ? id : null);
  const estado = {
    a: valido(params.get('a')) || '2022-1',
    b: valido(params.get('b')) || '2026-1',
    uf: C.UFS.includes(params.get('uf')) ? params.get('uf') : 'BR',
  };
  const arquivos = new Map();
  let mapa = null;

  // Cada arquivo é baixado uma vez e reaproveitado.
  function carregar(id) {
    if (!arquivos.has(id)) {
      arquivos.set(id, fetch(`/dados/historico/presidente-${id}.json`, { cache: 'default' }).then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).catch(e => { arquivos.delete(id); throw e; }));
    }
    return arquivos.get(id);
  }

  async function montarMapas() {
    const geo = await (await fetch('assets/transmissao-estados.json', { cache: 'default' })).json();
    const caminhos = Object.entries(geo.estados).map(([uf, e]) => `<path class="cmp-uf" data-uf="${uf}" tabindex="0" role="button" aria-label="${safe(C.NOMES[uf])}" d="${e.d}"></path>`).join('')
      + Object.entries(geo.estados).map(([uf, e]) => `<text class="cmp-sigla" x="${e.rotulo[0]}" y="${e.rotulo[1]}">${uf}</text>`).join('');
    for (const lado of ['a', 'b']) {
      const svg = $('mapa-' + lado);
      svg.setAttribute('viewBox', geo.viewBox.join(' '));
      svg.innerHTML = caminhos;
      svg.querySelectorAll('[data-uf]').forEach(p => {
        p.addEventListener('click', () => escolherUF(p.dataset.uf));
        p.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); escolherUF(p.dataset.uf); } });
      });
    }
    mapa = geo;
  }

  function escolherUF(uf) {
    estado.uf = estado.uf === uf ? 'BR' : uf; // segundo clique no mesmo estado volta ao Brasil
    render();
  }

  function segmentos(lado) {
    $('cen-' + lado).innerHTML = C.CENARIOS.map(c => `<button type="button" class="seg ${estado[lado] === c.id ? 'active' : ''}" aria-pressed="${estado[lado] === c.id}" data-id="${c.id}">${c.rotulo.replace(' · ', ' · ')}</button>`).join('');
    $('cen-' + lado).querySelectorAll('button').forEach(b => b.addEventListener('click', () => { estado[lado] = b.dataset.id; render(); }));
  }

  function pintar(lado, dados) {
    const svg = $('mapa-' + lado);
    if (!mapa) return;
    svg.querySelectorAll('path[data-uf]').forEach(p => {
      p.style.fill = C.corLider(C.resumir(dados, p.dataset.uf));
      p.classList.toggle('sel', p.dataset.uf === estado.uf);
    });
    svg.classList.toggle('com-sel', estado.uf !== 'BR');
  }

  function listaCandidatos(r) {
    return r.candidatos.map(c => `<li><span class="cmp-cand"><strong>${safe(c.nome)}</strong><small>${safe(c.partido)} · Nº ${safe(c.numero)}</small></span>
      <span class="cmp-num"><strong>${C.fmtPct(c.pct)}</strong><small>${C.fmtInt(c.votos)} votos</small></span></li>`).join('');
  }

  function cabecalhoMapa(lado, r) {
    const c = C.cenario(estado[lado]), lider = r.candidatos[0];
    $('tit-' + lado).textContent = c.rotulo;
    $('sub-' + lado).textContent = `${C.NOMES[estado.uf]} · mais votado: ${lider ? `${lider.nome} (${C.fmtPct(lider.pct)})` : '—'}`;
    $('cands-' + lado).innerHTML = `<h3>${safe(c.rotulo)} · ${safe(C.NOMES[estado.uf])}</h3><ol>${listaCandidatos(r)}</ol>
      <p class="cmp-fonte">Percentuais sobre votos válidos. Fonte: ${safe(r.fonte?.descricao || 'TSE')}.</p>`;
  }

  function tabela(ra, rb, cmp) {
    const ca = C.cenario(estado.a), cb = C.cenario(estado.b);
    const linhas = [`<tr><th scope="row">Eleitores aptos</th><td>${C.fmtInt(ra.participacao.aptos)}</td><td>${C.fmtInt(rb.participacao.aptos)}</td><td class="cmp-delta">—</td></tr>`]
      .concat(cmp.participacao.map(l => `<tr><th scope="row">${l.rotulo}<small>${l.base}</small></th>
        <td>${C.fmtPct(l.a.pct)}<small>${C.fmtInt(l.a.n)}</small></td>
        <td>${C.fmtPct(l.b.pct)}<small>${C.fmtInt(l.b.n)}</small></td>
        <td class="cmp-delta">${C.fmtPp(l.deltaPp)}</td></tr>`));
    $('tabela').innerHTML = `<thead><tr><th scope="col">Indicador · ${safe(C.NOMES[estado.uf])}</th><th scope="col">${ca.rotulo}</th><th scope="col">${cb.rotulo}</th><th scope="col">Diferença</th></tr></thead><tbody>${linhas.join('')}</tbody>`;
    $('aviso-turno').hidden = cmp.mesmoTurno;
    $('aviso-turno').textContent = cmp.mesmoTurno ? '' : 'Cenários de turnos diferentes: os valores aparecem lado a lado, mas as diferenças não são calculadas, porque 1º e 2º turnos têm composições de candidaturas distintas.';
    const comuns = cmp.comuns;
    $('comuns').innerHTML = comuns.length
      ? `<table class="cmp-tabela"><thead><tr><th scope="col">Candidatura (mesma pessoa)</th><th scope="col">${ca.rotulo}</th><th scope="col">${cb.rotulo}</th><th scope="col">Diferença</th></tr></thead><tbody>${comuns.map(c => `<tr><th scope="row">${safe(c.nome)}<small>${safe(c.a.partido)} ${safe(c.a.numero)} → ${safe(c.b.partido)} ${safe(c.b.numero)}</small></th>
        <td>${C.fmtPct(c.a.pct)}<small>${C.fmtInt(c.a.votos)} votos</small></td><td>${C.fmtPct(c.b.pct)}<small>${C.fmtInt(c.b.votos)} votos</small></td>
        <td class="cmp-delta">${C.fmtPp(c.deltaPp)}${c.deltaVotos != null ? `<small>${c.deltaVotos > 0 ? '+' : c.deltaVotos < 0 ? '−' : ''}${C.fmtInt(Math.abs(c.deltaVotos))} votos</small>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<p class="cmp-vazio">Nenhuma pessoa disputou os dois cenários escolhidos.</p>';
  }

  let pedido = 0;
  async function render() {
    const id = ++pedido;
    segmentos('a'); segmentos('b');
    $('recorte').value = estado.uf;
    $('voltar-br').hidden = estado.uf === 'BR';
    history.replaceState(null, '', `?a=${estado.a}&b=${estado.b}&uf=${estado.uf}`);
    let da, db;
    try { [da, db] = await Promise.all([carregar(estado.a), carregar(estado.b)]); }
    catch (e) { if (id === pedido) $('erro').hidden = false; return; }
    if (id !== pedido) return;
    $('erro').hidden = true;
    const ra = C.resumir(da, estado.uf), rb = C.resumir(db, estado.uf);
    if (!ra || !rb) { $('erro').hidden = false; return; }
    const cmp = C.comparar(ra, rb);
    pintar('a', da); pintar('b', db);
    cabecalhoMapa('a', ra); cabecalhoMapa('b', rb);
    tabela(ra, rb, cmp);
    $('fontes').innerHTML = [[estado.a, da], [estado.b, db]].filter((x, i, l) => l.findIndex(y => y[0] === x[0]) === i)
      .map(([cid, d]) => `<li><strong>${C.cenario(cid).rotulo}:</strong> ${safe(d.fonte?.descricao)} · extraído e validado em ${new Date(d.extraidoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.</li>`).join('');
  }

  $('recorte').innerHTML = ['BR', ...C.UFS].map(uf => `<option value="${uf}">${safe(C.NOMES[uf])}${uf === 'BR' ? '' : ' · ' + uf}</option>`).join('');
  $('recorte').addEventListener('change', e => { estado.uf = e.target.value; render(); });
  $('voltar-br').addEventListener('click', () => { estado.uf = 'BR'; render(); });
  $('trocar').addEventListener('click', () => { [estado.a, estado.b] = [estado.b, estado.a]; render(); });
  render();
  montarMapas().then(render).catch(() => { document.querySelectorAll('.cmp-mapa').forEach(s => { s.outerHTML = '<p class="cmp-vazio">Mapa indisponível; os resultados seguem abaixo.</p>'; }); });
})();
