/* Núcleo do comparador eleitoral: resume e compara os arquivos estáticos oficiais de
   dados/historico/. Sem DOM e sem rede: roda no navegador e nos testes (Node). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CompararCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
  const NOMES = { BR: 'Brasil inteiro', AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' };
  // Apenas resultados finais já consolidados. O 2º turno de 2026 fica de fora de propósito.
  const CENARIOS = [
    { id: '2018-1', ano: 2018, turno: 1, rotulo: '2018 · 1º turno' },
    { id: '2018-2', ano: 2018, turno: 2, rotulo: '2018 · 2º turno' },
    { id: '2022-1', ano: 2022, turno: 1, rotulo: '2022 · 1º turno' },
    { id: '2022-2', ano: 2022, turno: 2, rotulo: '2022 · 2º turno' },
    { id: '2026-1', ano: 2026, turno: 1, rotulo: '2026 · 1º turno' },
  ];
  const cenario = id => CENARIOS.find(c => c.id === id) || null;

  const razao = (parte, total) => (total > 0 ? Math.round((parte / total) * 10000) / 100 : null);
  // Identidade da pessoa: nome civil completo do TSE, sem acentos. O número de urna e o
  // partido mudam entre eleições (ex.: Jair Bolsonaro foi 17 em 2018 e 22 em 2022).
  const pessoa = c => String(c.nomeCompleto || c.nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

  /* Resumo de um cenário em um recorte (BR ou UF), a partir das contagens exatas. */
  function resumir(dados, area) {
    const r = dados && dados.resultados && dados.resultados[area];
    if (!r) return null;
    const t = r.totais;
    const candidatos = (dados.candidatos || [])
      .filter(c => Number.isInteger(r.votos[c.id]))
      .map(c => ({ id: c.id, numero: c.numero, nome: c.nome, nomeCompleto: c.nomeCompleto, partido: c.partido, pessoa: pessoa(c), votos: r.votos[c.id], pct: razao(r.votos[c.id], t.validos) }))
      .sort((a, b) => b.votos - a.votos);
    return {
      area, ano: dados.eleicao.ano, turno: dados.eleicao.turno, candidatos, totais: t,
      participacao: {
        aptos: t.aptos,
        comparecimento: { n: t.comparecimento, pct: razao(t.comparecimento, t.aptos) },
        abstencao: { n: t.abstencoes, pct: razao(t.abstencoes, t.aptos) },
        validos: { n: t.validos, pct: razao(t.validos, t.votos) },
        brancos: { n: t.brancos, pct: razao(t.brancos, t.votos) },
        nulos: { n: t.nulos, pct: razao(t.nulos, t.votos) },
      },
      fonte: dados.fonte, extraidoEm: dados.extraidoEm,
    };
  }

  const delta = (a, b) => (a == null || b == null ? null : Math.round((b - a) * 100) / 100);

  /* Compara dois resumos do mesmo recorte. Diferenças só entre cenários do mesmo turno:
     percentuais de 1º turno (vários candidatos) e de 2º turno (dois) não são comparáveis. */
  function comparar(a, b) {
    const mesmoTurno = !!a && !!b && a.turno === b.turno;
    const linha = (rotulo, base, ka, kb) => ({ rotulo, base, a: ka, b: kb, deltaPp: mesmoTurno ? delta(ka && ka.pct, kb && kb.pct) : null });
    const participacao = [
      linha('Comparecimento', 'sobre eleitores aptos', a && a.participacao.comparecimento, b && b.participacao.comparecimento),
      linha('Abstenção', 'sobre eleitores aptos', a && a.participacao.abstencao, b && b.participacao.abstencao),
      linha('Votos válidos', 'sobre o total de votos', a && a.participacao.validos, b && b.participacao.validos),
      linha('Votos brancos', 'sobre o total de votos', a && a.participacao.brancos, b && b.participacao.brancos),
      linha('Votos nulos', 'sobre o total de votos', a && a.participacao.nulos, b && b.participacao.nulos),
    ];
    // Mesma pessoa nos dois cenários, pelo nome civil completo.
    const emB = new Map((b ? b.candidatos : []).map(c => [c.pessoa, c]));
    const comuns = (a ? a.candidatos : []).filter(c => emB.has(c.pessoa)).map(c => {
      const cb = emB.get(c.pessoa);
      return { pessoa: c.pessoa, nome: cb.nome, a: c, b: cb, deltaPp: mesmoTurno ? delta(c.pct, cb.pct) : null, deltaVotos: mesmoTurno ? cb.votos - c.votos : null };
    });
    return { mesmoTurno, participacao, comuns };
  }

  /* Cor do estado no mapa: candidato com mais votos válidos; intensidade pela margem. */
  function corLider(resumo) {
    const top = resumo && resumo.candidatos;
    if (!top || !top.length || !(top[0].votos > 0)) return 'rgb(213,220,207)';
    const lider = top[0], margem = (lider.pct || 0) - ((top[1] && top[1].pct) || 0);
    const forca = Math.min(0.95, 0.3 + margem / 40);
    const base = /lula|haddad/i.test(lider.nome) ? [224, 90, 104] : /bolsonaro/i.test(lider.nome) ? [63, 143, 230] : /ciro/i.test(lider.nome) ? [226, 162, 59] : [154, 127, 209];
    const neutro = [213, 220, 207];
    return 'rgb(' + neutro.map((n, i) => Math.round(n * (1 - forca) + base[i] * forca)).join(',') + ')';
  }

  const fmtInt = n => (n == null ? '—' : new Intl.NumberFormat('pt-BR').format(n));
  const fmtPct = n => (n == null ? '—' : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + '%');
  const fmtPp = n => (n == null ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n)) + ' p.p.');

  return { UFS, NOMES, CENARIOS, cenario, pessoa, resumir, comparar, corLider, fmtInt, fmtPct, fmtPp };
});
