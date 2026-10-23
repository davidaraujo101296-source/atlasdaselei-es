// Importa, transforma e valida os resultados presidenciais oficiais do TSE para
// arquivos JSON estáticos em dados/historico/. Executar durante a preparação dos
// dados, nunca durante a navegação do visitante:
//
//   node scripts/historico/importar-presidente.cjs            (usa dados-brutos/ se existir)
//   node scripts/historico/importar-presidente.cjs --atualizar (baixa novamente: retificações)
//
// Fontes oficiais:
// - 2018 e 2022: Portal de Dados Abertos do TSE (votacao_candidato_munzona e
//   detalhe_votacao_munzona). Só a entrada *_BR.csv (cargo Presidente, todas as UFs
//   e o exterior "ZZ") é lida do ZIP, por HTTP Range.
// - 2026, 1º turno: arquivos de divulgação do TSE (ele2026/6257), um por UF, BR e ZZ.
//
// Os votos são agregados pelo identificador oficial do candidato (SQ_CANDIDATO /
// sqcand), nunca pela posição em listas. Percentuais são calculados a partir dos
// votos absolutos exatos; nenhum voto é derivado de percentual arredondado.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { listar, extrair } = require('./zip-remoto.cjs');

const ROOT = path.resolve(__dirname, '../..');
const RAW = path.join(ROOT, 'dados-brutos');
const OUT = path.join(ROOT, 'dados', 'historico');
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const AREAS = [...UFS, 'ZZ'];
const ODSELE = 'https://cdn.tse.jus.br/estatistica/sead/odsele';
const ELEICOES = {
  '2018-1': { codigo: 295, data: '07/10/2018', tipo: 'csv' },
  '2018-2': { codigo: 296, data: '28/10/2018', tipo: 'csv' },
  '2022-1': { codigo: 544, data: '02/10/2022', tipo: 'csv' },
  '2022-2': { codigo: 545, data: '30/10/2022', tipo: 'csv' },
  '2026-1': { codigo: 6257, data: '04/10/2026', tipo: 'json' },
};
const atualizar = process.argv.includes('--atualizar');
const pausa = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentual = (parte, total) => (total > 0 ? Math.round((parte / total) * 10000) / 100 : null);

// ---------- download com cache local ----------
async function csvDoZip(conjunto, ano) {
  const nome = `${conjunto}_${ano}_BR.csv`, destino = path.join(RAW, nome);
  const url = `${ODSELE}/${conjunto}/${conjunto}_${ano}.zip`;
  if (atualizar || !fs.existsSync(destino)) {
    const entrada = (await listar(url)).find(e => e.name === nome);
    if (!entrada) throw new Error(`${nome} não encontrado em ${url}`);
    fs.mkdirSync(RAW, { recursive: true });
    fs.writeFileSync(destino, await extrair(url, entrada));
    console.log(`baixado ${nome}`);
  }
  return { url, entrada: nome, texto: fs.readFileSync(destino).toString('latin1') };
}

async function jsonTSE(url, arquivo) {
  const destino = path.join(RAW, arquivo);
  if (atualizar || !fs.existsSync(destino)) {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`TSE respondeu ${res.status} para ${url}`);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, Buffer.from(await res.arrayBuffer()));
    console.log(`baixado ${arquivo}`);
    await pausa(400); // ritmo moderado: preparação de dados, não teste de carga
  }
  return JSON.parse(fs.readFileSync(destino, 'utf8'));
}

// ---------- CSV do TSE (latin1, ";" e campos entre aspas) ----------
function* linhasCSV(texto) {
  const linhas = texto.split(/\r?\n/);
  const cab = campos(linhas[0]);
  for (let i = 1; i < linhas.length; i++) {
    if (!linhas[i]) continue;
    const valores = campos(linhas[i]);
    if (valores.length !== cab.length) throw new Error(`Linha ${i + 1} com ${valores.length} colunas; esperado ${cab.length}`);
    yield Object.fromEntries(cab.map((c, j) => [c, valores[j]]));
  }
}
function campos(linha) {
  const out = []; let atual = '', aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (ch === '"') { if (aspas && linha[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas; }
    else if (ch === ';' && !aspas) { out.push(atual); atual = ''; }
    else atual += ch;
  }
  out.push(atual);
  return out;
}
const inteiro = (valor, campo) => {
  if (!/^-?\d+$/.test(String(valor))) throw new Error(`Valor não inteiro em ${campo}: ${valor}`);
  return Number(valor);
};

// ---------- 2018 e 2022: dados abertos ----------
function novaArea() {
  return { votos: {}, totais: { aptos: 0, comparecimento: 0, abstencoes: 0, eleitoresSecoesNaoInstaladas: 0, votos: 0, validos: 0, brancos: 0, nulos: 0, anulados: 0, anuladosApuracaoSeparada: 0 } };
}
async function importarCSV(ano) {
  const cand = await csvDoZip('votacao_candidato_munzona', ano);
  const det = await csvDoZip('detalhe_votacao_munzona', ano);
  const porTurno = {};
  const geracao = {};
  for (const r of linhasCSV(cand.texto)) {
    if (r.CD_CARGO !== '1') continue;
    const turno = r.NR_TURNO, uf = r.SG_UF;
    if (!AREAS.includes(uf)) throw new Error(`UF inesperada: ${uf}`);
    const t = (porTurno[turno] ??= { candidatos: new Map(), areas: {} });
    const id = r.SQ_CANDIDATO;
    if (!t.candidatos.has(id)) {
      t.candidatos.set(id, { id, numero: r.NR_CANDIDATO, nome: r.NM_URNA_CANDIDATO, nomeCompleto: r.NM_CANDIDATO, partido: r.SG_PARTIDO, situacao: r.DS_SIT_TOT_TURNO });
    }
    const votos = r.QT_VOTOS_NOMINAIS_VALIDOS != null
      ? inteiro(r.QT_VOTOS_NOMINAIS_VALIDOS, 'QT_VOTOS_NOMINAIS_VALIDOS')
      : (r.NM_TIPO_DESTINACAO_VOTOS === 'Válido' ? inteiro(r.QT_VOTOS_NOMINAIS, 'QT_VOTOS_NOMINAIS') : 0);
    const a = (t.areas[uf] ??= novaArea());
    a.votos[id] = (a.votos[id] || 0) + votos;
    geracao.candidatos = `${r.DT_GERACAO} ${r.HH_GERACAO}`;
  }
  for (const r of linhasCSV(det.texto)) {
    if (r.CD_CARGO !== '1') continue;
    const t = porTurno[r.NR_TURNO];
    if (!t) throw new Error(`Turno ${r.NR_TURNO} sem votação de candidatos`);
    const a = (t.areas[r.SG_UF] ??= novaArea()).totais;
    a.aptos += inteiro(r.QT_APTOS, 'QT_APTOS');
    a.comparecimento += inteiro(r.QT_COMPARECIMENTO, 'QT_COMPARECIMENTO');
    a.abstencoes += inteiro(r.QT_ABSTENCOES, 'QT_ABSTENCOES');
    a.eleitoresSecoesNaoInstaladas += inteiro(r.QT_ELEITORES_SECOES_NAO_INSTALADAS, 'QT_ELEITORES_SECOES_NAO_INSTALADAS');
    a.votos += inteiro(r.QT_VOTOS, 'QT_VOTOS');
    a.validos += inteiro(r.QT_TOTAL_VOTOS_VALIDOS, 'QT_TOTAL_VOTOS_VALIDOS');
    a.brancos += inteiro(r.QT_VOTOS_BRANCOS, 'QT_VOTOS_BRANCOS');
    a.nulos += inteiro(r.QT_TOTAL_VOTOS_NULOS, 'QT_TOTAL_VOTOS_NULOS');
    a.anulados += inteiro(r.QT_TOTAL_VOTOS_ANULADOS, 'QT_TOTAL_VOTOS_ANULADOS');
    a.anuladosApuracaoSeparada += inteiro(r.QT_VOTOS_ANULADOS_APU_SEP ?? '0', 'QT_VOTOS_ANULADOS_APU_SEP');
    geracao.detalhe = `${r.DT_GERACAO} ${r.HH_GERACAO}`;
  }
  const saida = {};
  for (const [turno, t] of Object.entries(porTurno)) {
    const key = `${ano}-${turno}`;
    const areas = { ...t.areas, BR: somar(t.areas) };
    saida[key] = montar(key, [...t.candidatos.values()], areas, {
      descricao: 'TSE — Portal de Dados Abertos (votação por município e zona)',
      arquivos: [`${cand.url}#${cand.entrada}`, `${det.url}#${det.entrada}`],
      geradoPeloTSE: geracao,
    });
  }
  return saida;
}
function somar(areas) {
  const br = novaArea();
  for (const uf of AREAS) {
    const a = areas[uf];
    if (!a) throw new Error(`Área ${uf} ausente`);
    for (const [id, v] of Object.entries(a.votos)) br.votos[id] = (br.votos[id] || 0) + v;
    for (const k of Object.keys(br.totais)) br.totais[k] += a.totais[k];
  }
  return br;
}

// ---------- 2026, 1º turno: divulgação oficial ----------
async function importarJSON2026(key) {
  const { codigo } = ELEICOES[key];
  const id = String(codigo), e6 = id.padStart(6, '0');
  const base = `https://resultados.tse.jus.br/oficial/ele2026/${id}/dados`;
  const candidatos = new Map(), areas = {}, publicados = {}, oficiais = {};
  for (const area of ['BR', ...AREAS]) {
    const c = area.toLowerCase();
    const j = await jsonTSE(`${base}/${c}/${c}-c0001-e${e6}-u.json`, `ele2026-${id}/${c}-c0001-e${e6}-u.json`);
    if (String(j.ele) !== id || String(j.cdabr).toUpperCase() !== area) throw new Error(`Arquivo de ${area} não corresponde à eleição ${id}`);
    if (String(j.tf).toLowerCase() !== 's') throw new Error(`${area}: totalização não está finalizada (tf=${j.tf})`);
    if (j.s.st !== j.s.ts) throw new Error(`${area}: seções totalizadas ${j.s.st} de ${j.s.ts}`);
    const n = x => inteiro(x, area);
    const a = novaArea();
    Object.assign(a.totais, { aptos: n(j.e.te), comparecimento: n(j.e.c), abstencoes: n(j.e.a), eleitoresSecoesNaoInstaladas: n(j.e.esni ?? 0), votos: n(j.v.tv), validos: n(j.v.vv), brancos: n(j.v.vb), nulos: n(j.v.tvn), anulados: n(j.v.van ?? 0) });
    const cargos = j.carg.filter(x => String(x.cd) === '1');
    if (cargos.length !== 1) throw new Error(`${area}: cargo Presidente não encontrado`);
    oficiais[area] = {};
    for (const agr of cargos[0].agr || []) for (const par of agr.par || []) for (const cd of par.cand || []) {
      if (!cd.sqcand) throw new Error(`${area}: candidato sem sqcand`);
      if (!candidatos.has(cd.sqcand)) candidatos.set(cd.sqcand, { id: cd.sqcand, numero: String(cd.n), nome: cd.nmu || cd.nm, nomeCompleto: cd.nm, partido: par.sg, situacao: area === 'BR' ? (cd.st || '') : '' });
      if (area === 'BR') candidatos.get(cd.sqcand).situacao = cd.st || '';
      a.votos[cd.sqcand] = n(cd.vap);
      oficiais[area][cd.sqcand] = Number(String(cd.pvap).replace(',', '.'));
    }
    areas[area] = a;
    publicados[area] = `${j.dg} ${j.hg}`;
  }
  // O arquivo BR é independente: confere que é igual à soma das UFs mais o exterior.
  const soma = somar(areas);
  for (const [id, v] of Object.entries(areas.BR.votos)) if (soma.votos[id] !== v) throw new Error(`BR: candidato ${id} tem ${v} votos; soma das UFs + ZZ = ${soma.votos[id]}`);
  for (const k of ['votos', 'validos', 'brancos', 'nulos', 'comparecimento', 'aptos']) if (soma.totais[k] !== areas.BR.totais[k]) throw new Error(`BR: ${k} = ${areas.BR.totais[k]}; soma das UFs + ZZ = ${soma.totais[k]}`);
  const out = montar(key, [...candidatos.values()], areas, {
    descricao: 'TSE — arquivos oficiais de divulgação de resultados (totalização final)',
    arquivos: [`${base}/{uf}/{uf}-c0001-e${e6}-u.json`],
    geradoPeloTSE: { BR: publicados.BR },
  });
  // Percentual calculado dos votos exatos deve coincidir com o pvap publicado pelo TSE.
  for (const [area, porId] of Object.entries(oficiais)) for (const [id, p] of Object.entries(porId)) {
    if (Math.abs(out.resultados[area].percentualCandidato[id] - p) > 0.011) throw new Error(`${area}: percentual de ${id} difere do TSE (${out.resultados[area].percentualCandidato[id]} x ${p})`);
  }
  return { [key]: out };
}

// ---------- montagem e validação comum ----------
function montar(key, candidatos, areas, fonte) {
  const [ano, turno] = key.split('-').map(Number);
  const verificacoes = [];
  const resultados = {};
  for (const area of ['BR', ...AREAS]) {
    const a = areas[area];
    if (!a) throw new Error(`${key}: área ${area} ausente`);
    const somaCand = Object.values(a.votos).reduce((s, v) => s + v, 0);
    if (somaCand !== a.totais.validos) throw new Error(`${key} ${area}: soma dos candidatos ${somaCand} ≠ votos válidos ${a.totais.validos}`);
    const composicao = a.totais.validos + a.totais.brancos + a.totais.nulos + a.totais.anulados + a.totais.anuladosApuracaoSeparada;
    if (composicao !== a.totais.votos) throw new Error(`${key} ${area}: válidos + brancos + nulos + anulados (inclusive em apuração separada) = ${composicao} ≠ votos ${a.totais.votos}`);
    if (a.totais.comparecimento + a.totais.abstencoes + a.totais.eleitoresSecoesNaoInstaladas !== a.totais.aptos) throw new Error(`${key} ${area}: comparecimento + abstenções + eleitores de seções não instaladas ≠ aptos`);
    const percentualCandidato = {};
    for (const [id, v] of Object.entries(a.votos)) percentualCandidato[id] = percentual(v, a.totais.validos);
    resultados[area] = {
      totais: a.totais,
      percentuais: { validos: percentual(a.totais.validos, a.totais.votos), brancos: percentual(a.totais.brancos, a.totais.votos), nulos: percentual(a.totais.nulos, a.totais.votos) },
      votos: a.votos,
      percentualCandidato,
    };
  }
  verificacoes.push(
    'Soma dos votos dos candidatos = votos válidos, em cada UF, no exterior e no Brasil',
    'Válidos + brancos + nulos + anulados (inclusive em apuração separada) = total de votos, em cada área',
    'Comparecimento + abstenções + eleitores de seções não instaladas = eleitores aptos, em cada área',
    'Brasil = 27 UFs + exterior (ZZ), por candidato e nos totais',
  );
  const agora = new Date().toISOString();
  return {
    schema: 1,
    eleicao: { ano, turno, cargo: 'presidente', codigoTSE: ELEICOES[key].codigo, data: ELEICOES[key].data },
    fonte,
    extraidoEm: agora,
    validacao: { validadoEm: agora, verificacoes },
    observacoes: 'Percentuais de candidatos sobre votos válidos; brancos e nulos (nulos + nulos técnicos) sobre o total de votos. Área ZZ = votos no exterior.',
    candidatos: candidatos.sort((x, y) => resultados.BR.votos[y.id] - resultados.BR.votos[x.id]),
    resultados,
  };
}

async function main() {
  const pedidos = process.argv.slice(2).filter(a => /^\d{4}-\d$/.test(a));
  const chaves = pedidos.length ? pedidos : Object.keys(ELEICOES);
  const resultado = {};
  for (const ano of [...new Set(chaves.filter(k => ELEICOES[k]?.tipo === 'csv').map(k => k.slice(0, 4)))]) Object.assign(resultado, await importarCSV(Number(ano)));
  for (const k of chaves.filter(k => ELEICOES[k]?.tipo === 'json')) Object.assign(resultado, await importarJSON2026(k));
  fs.mkdirSync(OUT, { recursive: true });
  for (const k of chaves) {
    if (!resultado[k]) throw new Error(`Sem dados para ${k}`);
    const arquivo = path.join(OUT, `presidente-${k}.json`);
    fs.writeFileSync(arquivo, JSON.stringify(resultado[k]) + '\n');
    const br = resultado[k].resultados.BR.totais;
    console.log(`${path.relative(ROOT, arquivo)}: ${resultado[k].candidatos.length} candidatos, ${br.validos} válidos, ${br.brancos} brancos, ${br.nulos} nulos`);
  }
}

if (require.main === module) main().catch(error => { console.error('ERRO:', error.message); process.exit(1); });
module.exports = { linhasCSV, campos, montar, somar };
