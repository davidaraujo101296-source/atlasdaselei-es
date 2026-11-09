#!/usr/bin/env node
'use strict';

/*
 * Agente de impressão do Comanda Fácil.
 *
 * Use quando o sistema está num servidor na internet e a impressora está
 * dentro do restaurante. Deixe este programa rodando num computador (ou
 * Raspberry Pi) do restaurante: ele busca os pedidos no servidor e manda
 * para a impressora. Não precisa instalar nada além do Node.js (versão 18+).
 *
 *   SERVIDOR=https://comanda.seudominio.com.br \
 *   TOKEN=codigo-que-aparece-nos-ajustes \
 *   IMPRESSORA=192.168.0.50:9100 \
 *   node agente-impressao.js
 *
 * IMPRESSORA pode ser:
 *   192.168.0.50 ou 192.168.0.50:9100   impressora de rede (cabo ou Wi-Fi)
 *   /dev/usb/lp0                        impressora USB no Linux / Raspberry Pi
 *   \\localhost\Cozinha                 impressora USB compartilhada no Windows
 */

const fs = require('node:fs');
const net = require('node:net');

const SERVIDOR = (process.env.SERVIDOR || '').replace(/\/+$/, '');
const TOKEN = process.env.TOKEN || '';
const IMPRESSORA = process.env.IMPRESSORA || '';
const INTERVALO = Number(process.env.INTERVALO_MS || 2000);

if (!SERVIDOR || !TOKEN || !IMPRESSORA) {
  console.error('Faltou configurar. Exemplo:');
  console.error('  SERVIDOR=https://comanda.exemplo.com TOKEN=abc123 IMPRESSORA=192.168.0.50 node agente-impressao.js');
  process.exit(1);
}

const hora = () => new Date().toLocaleTimeString('pt-BR');

function imprimirRede(destino, dados) {
  const [host, porta = '9100'] = destino.split(':');
  return new Promise((resolver, rejeitar) => {
    const conexao = net.createConnection({ host, port: Number(porta) });
    let fim = false;
    const terminar = (erro) => {
      if (fim) return;
      fim = true;
      conexao.destroy();
      if (erro) rejeitar(erro); else resolver();
    };
    conexao.setTimeout(8000, () => terminar(new Error('a impressora não respondeu')));
    conexao.on('error', (e) => terminar(new Error(`impressora: ${e.code || e.message}`)));
    conexao.on('connect', () => conexao.end(dados, () => terminar()));
  });
}

function imprimir(dados) {
  const ehArquivo = IMPRESSORA.startsWith('/') || IMPRESSORA.startsWith('\\\\');
  return ehArquivo ? fs.promises.writeFile(IMPRESSORA, dados) : imprimirRede(IMPRESSORA, dados);
}

async function chamar(caminho, opcoes = {}) {
  return fetch(`${SERVIDOR}/api${caminho}`, {
    ...opcoes,
    headers: { 'X-Agente-Token': TOKEN, 'Content-Type': 'application/json', ...(opcoes.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
}

let avisouErro = false;

async function rodada() {
  const r = await chamar('/agente/proxima');
  if (r.status === 401) throw new Error('TOKEN errado. Copie de novo o código que aparece em Ajustes > Impressora.');
  if (r.status === 204) return false;
  if (!r.ok) throw new Error(`servidor respondeu ${r.status}`);
  const trabalho = await r.json();
  let resultado = { ok: true };
  try {
    await imprimir(Buffer.from(trabalho.dados, 'base64'));
    console.log(`[${hora()}] ✓ impresso: ${trabalho.descricao}`);
  } catch (e) {
    resultado = { ok: false, erro: e.message };
    console.error(`[${hora()}] ✗ não imprimiu "${trabalho.descricao}": ${e.message}`);
  }
  await chamar(`/agente/${trabalho.id}/resultado`, { method: 'POST', body: JSON.stringify(resultado) });
  return resultado.ok;
}

async function laco() {
  for (;;) {
    let tinhaTrabalho = false;
    try {
      tinhaTrabalho = await rodada();
      if (avisouErro) console.log(`[${hora()}] conexão com o servidor voltou`);
      avisouErro = false;
    } catch (e) {
      if (!avisouErro) console.error(`[${hora()}] problema: ${e.message} (vou continuar tentando)`);
      avisouErro = true;
    }
    if (!tinhaTrabalho) await new Promise((r) => setTimeout(r, avisouErro ? INTERVALO * 3 : INTERVALO));
  }
}

console.log(`Agente de impressão ligado. Servidor: ${SERVIDOR} — Impressora: ${IMPRESSORA}`);
laco();
