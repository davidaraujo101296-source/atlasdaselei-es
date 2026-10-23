// Lê entradas específicas de um ZIP remoto via HTTP Range, sem baixar o arquivo inteiro.
// Usado para extrair só o CSV nacional (_BR) dos pacotes do Portal de Dados Abertos do TSE.
'use strict';
const zlib = require('node:zlib');

async function range(url, start, end) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (res.status !== 206) throw new Error(`Range não suportado (${res.status}) em ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function listar(url) {
  const head = await fetch(url, { method: 'HEAD' });
  if (!head.ok) throw new Error(`HTTP ${head.status} em ${url}`);
  const size = Number(head.headers.get('content-length'));
  const tail = await range(url, Math.max(0, size - 65557), size - 1);
  let eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Fim do diretório central não encontrado');
  let cdSize = tail.readUInt32LE(eocd + 12), cdOffset = tail.readUInt32LE(eocd + 16);
  // ZIP64: tamanhos e deslocamentos em 0xFFFFFFFF apontam para o registro ZIP64.
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    const loc = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
    const z64 = Number(tail.readBigUInt64LE(loc + 8));
    const rec = await range(url, z64, z64 + 55);
    cdSize = Number(rec.readBigUInt64LE(40)); cdOffset = Number(rec.readBigUInt64LE(48));
  }
  const cd = await range(url, cdOffset, cdOffset + cdSize - 1);
  const entries = [];
  for (let p = 0; p < cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
    const method = cd.readUInt16LE(p + 10);
    let compressed = cd.readUInt32LE(p + 20), size = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
    let offset = cd.readUInt32LE(p + 42);
    const name = cd.toString('latin1', p + 46, p + 46 + nameLen);
    const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    for (let q = 0; q + 4 <= extra.length;) {
      const id = extra.readUInt16LE(q), len = extra.readUInt16LE(q + 2);
      if (id === 1) {
        let r = q + 4;
        if (size === 0xffffffff) { size = Number(extra.readBigUInt64LE(r)); r += 8; }
        if (compressed === 0xffffffff) { compressed = Number(extra.readBigUInt64LE(r)); r += 8; }
        if (offset === 0xffffffff) { offset = Number(extra.readBigUInt64LE(r)); }
      }
      q += 4 + len;
    }
    entries.push({ name, method, compressed, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function extrair(url, entry) {
  const local = await range(url, entry.offset, entry.offset + 29);
  const start = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  const data = await range(url, start, start + entry.compressed - 1);
  const out = entry.method === 0 ? data : zlib.inflateRawSync(data);
  if (out.length !== entry.size) throw new Error(`Tamanho inesperado em ${entry.name}`);
  return out;
}

module.exports = { listar, extrair };
