'use strict';

const FUSO_PADRAO = process.env.FUSO || 'America/Sao_Paulo';

/** Data e hora no fuso do restaurante, no formato "AAAA-MM-DD HH:MM:SS". */
function agora(data = new Date(), fuso = FUSO_PADRAO) {
  const partes = {};
  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  for (const p of formato.formatToParts(data)) partes[p.type] = p.value;
  return `${partes.year}-${partes.month}-${partes.day} ${partes.hour}:${partes.minute}:${partes.second}`;
}

module.exports = { agora };
