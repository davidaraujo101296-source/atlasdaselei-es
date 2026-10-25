/* Cards de divulgação da transmissão (OBS): doação via Pix e compartilhamento do Atlas.
   Ciclo fixo de 660 s, sempre recalculado a partir do relógio (fase = decorrido % 660 s),
   sem temporizadores acumulados:
     00:00–08:00 sem card · 08:00–10:00 doação (120 s) · 10:00–10:30 sem card
     10:30–11:00 compartilhamento (30 s) · 11:00 recomeça.
   Ciclo n mostra a Doação n e o Compartilhamento n (1 a 20); depois de 20 ciclos
   (220 min) as duas sequências recomeçam. Não interfere no diretor de cenas: o card ocupa
   uma faixa à direita do painel do mapa, que encolhe enquanto ele está na tela. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.TransmissaoCartoes = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CICLO_MS = 660e3;
  const FASES = [
    { de: 0, ate: 480e3, tipo: null },
    { de: 480e3, ate: 600e3, tipo: 'doacao' },
    { de: 600e3, ate: 630e3, tipo: null },
    { de: 630e3, ate: 660e3, tipo: 'compartilhar' },
  ];
  const SITE = 'www.atlaseleitoral.org';
  const CHAVE_PIX = 'atlaseleitoral.david@gmail.com';

  const DOACOES = [
    ['Esse mapa tem história. E muitas horas de trabalho.', 'Seu apoio ajuda a manter o Atlas gratuito e independente.'],
    ['Sem patrocinador. Com muita dedicação.', 'Se este projeto está te ajudando, um Pix de qualquer valor também me ajuda.'],
    ['Os votos são contados. As horas de trabalho também!', 'Foram muitas para criar o Atlas. Que tal dar uma força?'],
    ['Informação clara não deveria ser um labirinto.', 'Foi por isso que criei o Atlas. Sua contribuição ajuda essa ideia a continuar.'],
    ['Uma pequena ajuda pode fazer uma grande diferença.', 'Não importa o valor. Cada contribuição é recebida com muita gratidão.'],
    ['Você acompanha os resultados. Eu sigo melhorando o Atlas.', 'Se puder contribuir com esse projeto independente, muito obrigado!'],
    ['O Atlas não tem patrocinadores. Tem propósito.', 'Sua contribuição fortalece uma iniciativa criada por conta própria.'],
    ['O mapa é grande. O orçamento nem tanto!', 'Qualquer Pix é bem-vindo para ajudar a manter essa ideia funcionando.'],
    ['Por trás dessa tela existe uma pessoa.', 'Sou o David, criei o Atlas por iniciativa própria e seu apoio significa muito.'],
    ['Até o menor Pix tem seu lugar neste mapa!', 'Não existe valor mínimo. Contribua apenas se quiser e puder.'],
    ['Muito além de uma noite de eleição.', 'Quero que o Atlas continue útil depois da apuração. Você pode ajudar nisso.'],
    ['Gostou de explorar o Brasil por aqui?', 'Considere apoiar a continuidade deste projeto com qualquer valor.'],
    ['Uma ideia virou mapa. O mapa virou Atlas.', 'Se quiser participar do próximo capítulo, sua contribuição é bem-vinda.'],
    ['A apuração passa. A vontade de melhorar fica.', 'Ajude a construir o futuro deste projeto gratuito e independente.'],
    ['Esse QR Code não elege ninguém!', 'Ele só ajuda um criador independente a continuar desenvolvendo o Atlas.'],
    ['Obrigado por dedicar seu tempo ao Atlas.', 'Se o projeto foi útil, uma contribuição voluntária é uma forma de retribuir.'],
    ['Você não precisa doar para estar aqui.', 'O Atlas é gratuito. O Pix é apenas um convite para quem deseja apoiar.'],
    ['Toda grande ideia precisa de gente que acredita nela.', 'Se você acredita no Atlas, considere dar uma força para sua continuidade.'],
    ['Um pequeno gesto pode levar uma ideia mais longe.', 'Sua contribuição ajuda a manter o Atlas e incentiva novas melhorias.'],
    ['Se o Atlas te aproximou da informação, já valeu a pena.', 'E se puder ajudar esse projeto a continuar, obrigado de coração.'],
  ].map(([titulo, texto], i) => ({ id: 'doacao-' + String(i + 1).padStart(2, '0'), titulo, texto }));

  const COMPARTILHAMENTOS = [
    ['Informação boa merece circular!', 'Compartilhe o Atlas com alguém que também quer acompanhar as eleições.'],
    ['Seu grupo de WhatsApp já está falando da eleição?', 'Então manda um mapa para a conversa! Compartilhe o Atlas.'],
    ['Discussão sem números? Melhor com mapa!', 'Compartilhe o Atlas e ajude mais pessoas a consultar os resultados oficiais.'],
    ['Conhece alguém perdido entre tantas porcentagens?', 'Envie o Atlas e ajude essa pessoa a entender melhor a apuração.'],
    ['O Atlas é gratuito. Compartilhar também!', 'E uma simples indicação pode levar este projeto muito mais longe.'],
    ['Um clique seu pode trazer mais gente para o mapa.', 'Compartilhe este projeto independente com amigos e familiares.'],
    ['Informação boa não foi feita para ficar guardada.', 'Mande o Atlas para alguém que gosta de acompanhar as eleições.'],
    ['Aquele parente que ama falar de política...', 'Já recebeu um mapa para conferir os números? Envie o Atlas!'],
    ['Antes de repassar um boato, repasse dados.', 'Compartilhe o Atlas e incentive a consulta dos resultados oficiais.'],
    ['Não precisa concordar para consultar os mesmos números.', 'Compartilhe o Atlas até com quem pensa diferente de você.'],
    ['O Brasil inteiro cabe neste mapa.', 'Ajude mais pessoas a descobrir uma maneira simples de acompanhar a apuração.'],
    ['Se te ajudou, pode ajudar outra pessoa.', 'Compartilhe com alguém que também está tentando entender os resultados.'],
    ['Um mapa pode mudar uma conversa.', 'Envie o Atlas e deixe os números falarem por si.'],
    ['Da sua tela para milhares de possibilidades.', 'Uma simples indicação ajuda este projeto independente a alcançar mais pessoas.'],
    ['O grupo da família está pegando fogo?', 'Manda o Atlas! Melhor compartilhar um mapa do que mais uma discussão.'],
    ['Tem alguém ansioso pela apuração?', 'Compartilhe o Atlas para essa pessoa acompanhar os resultados em um só lugar.'],
    ['Não guarde esse achado só para você!', 'Compartilhe o Atlas com amigos, familiares e colegas.'],
    ['Uma indicação sua vale muito.', 'É assim que um projeto sem patrocinadores pode chegar a novas pessoas.'],
    ['Mais mapas, menos achismos!', 'Compartilhe o Atlas e ajude a levar informações oficiais mais longe.'],
    ['Você já faz parte dessa história.', 'Convide mais alguém a conhecer o Atlas Eleitoral!'],
  ].map(([titulo, texto], i) => ({ id: 'compartilhar-' + String(i + 1).padStart(2, '0'), titulo, texto }));

  /* Situação num instante: decorridoMs desde o início do primeiro ciclo. */
  function situacao(decorridoMs) {
    const d = Math.max(0, Math.floor(decorridoMs));
    const ciclo = Math.floor(d / CICLO_MS);
    const noCiclo = d - ciclo * CICLO_MS;
    const f = FASES.find(x => noCiclo >= x.de && noCiclo < x.ate);
    const indice = ciclo % 20;
    const mensagem = f.tipo === 'doacao' ? DOACOES[indice] : f.tipo === 'compartilhar' ? COMPARTILHAMENTOS[indice] : null;
    return { ciclo, noCicloMs: noCiclo, tipo: f.tipo, indice, mensagem, chave: f.tipo ? f.tipo + ':' + ciclo : 'nenhum:' + ciclo + ':' + f.de, restanteMs: f.ate - noCiclo };
  }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function html(s) {
    const m = s.mensagem;
    if (s.tipo === 'doacao') return `<div class="cartao-selo">Apoie o Atlas · Pix</div>
      <figure class="cartao-qr"><img src="assets/pix-qr.svg" alt="QR Code Pix do Atlas Eleitoral"><figcaption>QR Code Pix · sem valor definido</figcaption></figure>
      <h2>${esc(m.titulo)}</h2><p>${esc(m.texto)}</p>
      <div class="cartao-rodape"><b>Contribuição voluntária, qualquer valor</b><span>Chave Pix: ${CHAVE_PIX}</span></div>`;
    return `<div class="cartao-selo">Compartilhe o Atlas</div>
      <figure class="cartao-qr"><img src="assets/site-qr.svg" alt="QR Code para abrir o site do Atlas Eleitoral"><figcaption>QR Code do site · abre ${SITE}</figcaption></figure>
      <h2>${esc(m.titulo)}</h2><p>${esc(m.texto)}</p>
      <div class="cartao-rodape cartao-endereco"><b>${SITE}</b></div>`;
  }

  /* Liga os cards na página. Retorna { parar, situacao } para conferência. */
  function iniciar({ painel, inicioMs, agora = () => Date.now(), intervaloMs = 500 }) {
    const el = document.createElement('aside');
    el.className = 'cartao';
    el.setAttribute('aria-live', 'off');
    painel.appendChild(el);
    let atual = null;
    function quadro() {
      const s = situacao(agora() - inicioMs);
      if (atual && s.chave === atual.chave) return;
      const entrou = s.tipo && (!atual || !atual.tipo || atual.chave !== s.chave);
      atual = s;
      if (entrou) {
        el.innerHTML = html(s); // um único elemento reaproveitado: sem acúmulo de nós
        el.dataset.tipo = s.tipo;
        el.dataset.mensagem = s.mensagem.id;
        painel.classList.add('com-cartao');
        el.classList.add('visivel');
      } else if (!s.tipo) {
        el.classList.remove('visivel');
        painel.classList.remove('com-cartao');
        el.dataset.tipo = '';
      }
    }
    quadro();
    const timer = setInterval(quadro, intervaloMs);
    return { parar: () => clearInterval(timer), get situacao() { return atual; }, elemento: el };
  }

  return { CICLO_MS, FASES, DOACOES, COMPARTILHAMENTOS, SITE, CHAVE_PIX, situacao, html, iniciar };
});
