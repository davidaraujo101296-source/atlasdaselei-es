/* Os cards acionam os mesmos controles de ano existentes no Atlas. */
(() => {
  const controls = document.getElementById('years');
  const cards = document.querySelector('.election-cards');
  if (!controls || !cards) return;
  function sync() {
    const selected = controls.querySelector('[data-year][aria-pressed="true"]');
    for (const card of cards.querySelectorAll('[data-election-year]')) {
      const active = card.dataset.electionYear === selected?.dataset.year;
      card.setAttribute('aria-pressed', String(active));
    }
  }
  cards.addEventListener('click', event => {
    const card = event.target.closest('[data-election-year]');
    if (!card) return;
    const year = card.dataset.electionYear;
    const control = Array.from(controls.querySelectorAll('[data-year]')).find(button => button.dataset.year === year);
    if (!control || control.disabled) return;
    control.click();
    sync();
    document.querySelector('.filters')?.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'start',
    });
  });
  new MutationObserver(sync).observe(controls, { attributes: true, subtree: true, attributeFilter: ['aria-pressed'] });
  sync();
})();
