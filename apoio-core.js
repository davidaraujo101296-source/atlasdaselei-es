/* Regras dos pedidos de apoio do Atlas (sem DOM; testável no Node).
   - Tempo de navegação ativa: soma só enquanto alguma página do Atlas está visível. Cada
     aba visível soma o intervalo desde o último registro de QUALQUER aba (guardado no
     armazenamento local), então duas abas abertas não contam o tempo em dobro. Intervalos
     maiores que PASSO_MAX (aba oculta, site fechado) não contam.
   - Pedido 1 aos 3 min e pedido 2 aos 30 min de navegação ativa, cada um no máximo uma vez
     por ciclo de 24 h contado do início da navegação. Depois de 24 h, tudo recomeça.
   - "Não mostrar hoje" ou clicar em apoiar encerra os pedidos até o fim do ciclo. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.AtlasApoioCore = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CICLO_MS = 24 * 3600e3;
  const PEDIDO_1_MS = 3 * 60e3;
  const PEDIDO_2_MS = 30 * 60e3;
  const PASSO_MAX = 2500; // o registro roda a cada 1 s; folga para atrasos do navegador

  const novo = agora => ({ v: 1, inicio: agora, ativoMs: 0, ultimoRegistro: 0, pedido1: 0, pedido2: 0, dispensado: 0, apoiou: 0 });

  // Estado salvo inválido, de outro ciclo ou do futuro (relógio alterado): recomeça.
  function normalizar(e, agora) {
    const ok = e && e.v === 1 && Number.isFinite(e.inicio) && Number.isFinite(e.ativoMs) && e.inicio <= agora && agora - e.inicio < CICLO_MS;
    return ok ? { ...novo(e.inicio), ...e } : novo(agora);
  }

  function registrar(e, agora) {
    const passo = agora - (e.ultimoRegistro || 0);
    const ativoMs = passo > 0 && passo <= PASSO_MAX ? e.ativoMs + passo : e.ativoMs;
    return { ...e, ativoMs, ultimoRegistro: Math.max(agora, e.ultimoRegistro || 0) };
  }

  // Qual pedido deve aparecer agora (0 = nenhum). Nunca os dois: o 2 só depois do 1.
  function pedidoDevido(e) {
    if (e.dispensado || e.apoiou) return 0;
    if (!e.pedido1 && e.ativoMs >= PEDIDO_1_MS) return 1;
    if (e.pedido1 && !e.pedido2 && e.ativoMs >= PEDIDO_2_MS) return 2;
    return 0;
  }

  const marcarExibido = (e, n, agora) => ({ ...e, ['pedido' + n]: agora });
  const dispensar = (e, agora) => ({ ...e, dispensado: agora });
  const apoiar = (e, agora) => ({ ...e, apoiou: agora });

  return { CICLO_MS, PEDIDO_1_MS, PEDIDO_2_MS, PASSO_MAX, novo, normalizar, registrar, pedidoDevido, marcarExibido, dispensar, apoiar };
});
