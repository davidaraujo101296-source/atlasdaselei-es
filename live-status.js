/* Estado visual do acesso à apuração, confirmado pela fonte oficial. */
(() => {
  const control = document.querySelector('.live-nav');
  if (!control) return;
  function show(stage) {
    control.dataset.liveState = stage;
    const descriptions = {
      counting: 'Apuração oficial em andamento', final: 'Totalização concluída',
      waiting: 'Aguardando divulgação oficial', unavailable: 'Situação oficial indisponível',
      demo: 'Demonstração: dados fictícios',
    };
    control.title = descriptions[stage];
    control.setAttribute('aria-label', 'Apuração ao vivo — ' + descriptions[stage]);
  }
  function officialStage(data) {
    return data?.ok && data.source === 'TSE' && ['counting', 'final'].includes(data.stage)
      ? data.stage : 'waiting';
  }
  const badge = document.getElementById('stage-badge');
  if (badge) {
    // Reutiliza os dados já consultados pela página, sem consultas duplicadas.
    const update = () => show(demo ? 'demo' : state.err ? 'unavailable' : officialStage(state.data));
    new MutationObserver(update).observe(badge, { childList: true, subtree: true, attributes: true });
    update();
  } else {
    async function update() {
      if (document.hidden) return;
      try {
        const response = await fetch('/api/apuracao?cargo=presidente&uf=BR', { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('Fonte indisponível');
        show(officialStage(await response.json()));
      } catch { show('unavailable'); }
    }
    show('waiting');
    update();
    setInterval(update, 90000);
    document.addEventListener('visibilitychange', update);
  }
})();
