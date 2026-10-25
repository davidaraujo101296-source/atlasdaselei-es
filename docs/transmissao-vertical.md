# Transmissão vertical (Instagram e Facebook)

A página `transmissao-vertical.html` (1080x1920, 9:16) usa o mesmo motor da horizontal: `transmissao-core.js`, `transmissao.js`, `transmissao-cartoes.js` e `transmissao-demo.js`. Só o HTML e o CSS (`transmissao-vertical.css`) são próprios.

As duas páginas consultam as mesmas URLs canônicas das APIs, com o mesmo cache, e mostram os mesmos cards no mesmo ciclo de 11 min.

## Endereços

| Uso | URL |
|---|---|
| Transmissão vertical | `https://atlasdaselei-es.vercel.app/transmissao-vertical.html` (depois do merge) |
| Ensaio com dados fictícios | `…/transmissao-vertical.html?demo=1` (nunca transmitir) |
| Guias de área segura | `…/transmissao-vertical.html?guias=1` (só para conferir o enquadramento; nunca transmitir) |
| Desligar os cards | `…/transmissao-vertical.html?cartoes=desligado` |

## Composição e áreas seguras

| Faixa (px) | Conteúdo |
|---|---|
| 0–190 | Livre: perfil, selo "ao vivo" e espectadores das plataformas |
| 190–322 | Cabeçalho: marca, situação, cargo e www.atlaseleitoral.org |
| 340–1480 | Recorte (Brasil ou estado), placar, mapa (maior bloco) e status da apuração |
| 1490–1550 | Rodapé: fonte, arquivo oficial, projeto independente e endereço |
| 1550–1920 | Só arte decorativa: é onde as plataformas mostram comentários e o campo de mensagem |

Os cards dividem o bloco do mapa (o mapa encolhe), sem cobrir números. Com o aviso "Dados desatualizados" na tela, o bloco principal desce, para o nome do recorte nunca ficar coberto.

As margens laterais são de 64 px. O **TikTok** tem botões na lateral direita que podem encostar no card do candidato à direita; ajustar antes de usar lá.

## OBS neste computador (configurado em 25/10/2026)

- **OBS:** 33.0.0. A horizontal não mudou: 1920x1080 a 30 FPS, NVENC H.264 a 6.000 kbps para o YouTube.
- **Aitum Vertical 1.6.6:** instalado a partir do pacote oficial (`windows-programdata.zip`, hash SHA-256 conferido, DLL assinada pela Aitum Ltd) em `C:ProgramDataobs-studiopluginsertical-canvas`. Carregou no OBS 33 sem erros.
- **Canvas vertical:** 1080x1920 a 30 FPS, com as cenas "ATLAS VERTICAL — TRANSMISSÃO REAL" (`transmissao-vertical.html`) e "ATLAS VERTICAL — DEMONSTRAÇÃO" (`?demo=1`).
- **Destinos verticais:** "Instagram" e "Facebook" (servidor `rtmps://live-api-s.facebook.com:443/rtmp/`), **desligados e sem chave**. O Backtrack (replay contínuo) foi desligado.
- **Upload medido:** 101–130 Mbps no teste da Cloudflare, por Wi-Fi 5 GHz.

## Medições (gravação simultânea horizontal + vertical, sem transmitir)

| Item | Resultado |
|---|---|
| Quadros perdidos | 0 (renderização e saída) |
| FPS | 30 fixos |
| Renderização | média de 1,19 ms, máximo de 1,76 ms |
| Codificador NVENC | 38–46% com duas codificações |
| GPU | 8–26%, 1,5–1,8 GB de memória, 58 °C |
| CPU | OBS 1–2,5%; sistema 8–38% |

**Codificações:** os dois destinos verticais **compartilham um único codificador**. Isso foi confirmado no log com dois destinos locais: `vertical_canvas_video_encoder` foi criado uma vez só (NVENC CBR, 4.500 kbps, 1080x1920). O total fica em **2 codificações**: YouTube + vertical.

**Taxas recomendadas:**
- YouTube: 6.000 kbps.
- Vertical (Instagram + Facebook): 4.500 kbps.
- Upload total: ~15,5 Mbps, folgado.

Se o Instagram recusar 1080x1920 (os guias citam 720x1280), defina 720x1280 só nesse destino. Isso cria uma terceira codificação, e o NVENC tem folga para ela.

## Plataformas

- **Instagram:** transmissão por chave só pelo **Live Producer** (instagram.com no computador → Criar → Ao vivo), em conta profissional elegível. A chave vale para uma live e expira.
- **Facebook:** Live Producer, que aceita vídeo vertical, com chave persistente ou por evento.
- **Valores das plataformas:** guias de terceiros indicam, para o Instagram, 720x1280, 2.250–6.000 kbps e áudio estéreo em 44,1 kHz. O OBS usa 48 kHz. **Confirmar na live privada de teste.**
- **Áudio:** as duas plataformas exigem uma trilha AAC. O OBS envia uma trilha silenciosa mesmo sem fontes de áudio. Microfone e áudio do computador continuam desligados.
- **Quedas de conexão:** cada saída reconecta sozinha e uma queda não derruba as outras. Ainda assim, o comportamento do Instagram e do Facebook depois de uma queda longa **precisa ser testado**.

## Antes de ir ao ar (ação humana)

1. Medir o upload, por exemplo no speedtest ou no fast.com. Se ficar abaixo de ~20 Mbps, transmitir a vertical em uma plataforma só, ou em 720x1280.
2. Instalar o Aitum Vertical, ou preparar o segundo OBS, e fazer uma live **privada** de teste em cada plataforma. No Facebook, use o público "Somente eu".
3. Conferir num celular se nada importante fica sob os comentários.
4. **Não considerar as três transmissões prontas sem esse teste real.**
