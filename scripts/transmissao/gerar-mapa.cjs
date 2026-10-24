// Gera assets/transmissao-estados.json: contornos das 27 UFs já projetados em SVG,
// para a página de transmissão não depender de CDN externo durante a live.
// Fonte: malha territorial oficial do IBGE (API de malhas, qualidade mínima).
//   node scripts/transmissao/gerar-mapa.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const FONTE = 'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=UF';
const IBGE_UF = { 11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF' };
const LARGURA = 1000;
// Projeção equiretangular com correção de latitude média do país (~15° S).
const COS = Math.cos((15 * Math.PI) / 180);

function aneis(geometria) {
  if (geometria.type === 'Polygon') return geometria.coordinates;
  if (geometria.type === 'MultiPolygon') return geometria.coordinates.flat();
  throw new Error('Geometria inesperada: ' + geometria.type);
}
function areaCentroide(anel) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const f = anel[j][0] * anel[i][1] - anel[i][0] * anel[j][1];
    a += f; cx += (anel[j][0] + anel[i][0]) * f; cy += (anel[j][1] + anel[i][1]) * f;
  }
  return { area: Math.abs(a / 2), cx: cx / (3 * a), cy: cy / (3 * a) };
}

async function main() {
  const res = await fetch(FONTE);
  if (!res.ok) throw new Error('IBGE respondeu ' + res.status);
  const geo = await res.json();
  if (geo.features?.length !== 27) throw new Error('Esperava 27 UFs, recebi ' + geo.features?.length);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const brutos = geo.features.map(f => {
    const uf = IBGE_UF[f.properties.codarea];
    if (!uf) throw new Error('Código IBGE desconhecido: ' + f.properties.codarea);
    const rings = aneis(f.geometry).map(r => r.map(([lon, lat]) => [lon * COS, -lat]));
    for (const r of rings) for (const [x, y] of r) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    return { uf, rings };
  });
  const k = LARGURA / (maxX - minX), altura = Math.round((maxY - minY) * k);
  const p = ([x, y]) => [Math.round((x - minX) * k * 10) / 10, Math.round((y - minY) * k * 10) / 10];
  const estados = {};
  for (const { uf, rings } of brutos) {
    const proj = rings.map(r => r.map(p));
    const d = proj.map(r => 'M' + r.map(([x, y]) => x + ',' + y).join('L') + 'Z').join('');
    const xs = proj.flat().map(q => q[0]), ys = proj.flat().map(q => q[1]);
    // Rótulo no centroide do maior anel (evita ilhas e enclaves).
    const maior = proj.map(areaCentroide).sort((a, b) => b.area - a.area)[0];
    estados[uf] = {
      d,
      caixa: [Math.min(...xs), Math.min(...ys), Math.round((Math.max(...xs) - Math.min(...xs)) * 10) / 10, Math.round((Math.max(...ys) - Math.min(...ys)) * 10) / 10],
      rotulo: [Math.round(maior.cx * 10) / 10, Math.round(maior.cy * 10) / 10],
    };
  }
  const saida = {
    fonte: 'IBGE — API de malhas territoriais (qualidade mínima)',
    url: FONTE.replace('%2B', '+'),
    geradoEm: new Date().toISOString(),
    viewBox: [0, 0, LARGURA, altura],
    estados: Object.fromEntries(Object.keys(estados).sort().map(uf => [uf, estados[uf]])),
  };
  const destino = path.join(__dirname, '..', '..', 'assets', 'transmissao-estados.json');
  fs.writeFileSync(destino, JSON.stringify(saida) + '\n');
  console.log(`${path.relative(process.cwd(), destino)}: ${Object.keys(estados).length} UFs, viewBox ${saida.viewBox.join(' ')}, ${(fs.statSync(destino).size / 1024).toFixed(0)} KB`);
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
