// Gera os QR Codes estáticos do Atlas (SVG em assets/). Não roda no site nem no deploy.
//   npm install --no-save qrcode@1.5.4 && node scripts/apoio/gerar-qr.cjs
// - assets/pix-qr.svg: BR Code Pix estático (sem valor), o mesmo texto do Pix Copia e Cola;
// - assets/site-qr.svg: endereço oficial do site (compartilhamento; não é pagamento).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const QRCode = require(process.env.QRCODE_MODULE || 'qrcode');
const { CODIGO, ler } = require('../../pix.js');

const SITE = 'https://www.atlaseleitoral.org';
const raiz = path.resolve(__dirname, '../..');
const opcoes = { type: 'svg', errorCorrectionLevel: 'M', margin: 4, color: { dark: '#142F35', light: '#FFFFFF' } };

async function main() {
  if (!ler(CODIGO).ok) throw new Error('BR Code inválido; QR não gerado');
  for (const [arquivo, texto] of [['assets/pix-qr.svg', CODIGO], ['assets/site-qr.svg', SITE]]) {
    const svg = await QRCode.toString(texto, opcoes);
    fs.writeFileSync(path.join(raiz, arquivo), svg);
    console.log(arquivo, '←', texto);
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
