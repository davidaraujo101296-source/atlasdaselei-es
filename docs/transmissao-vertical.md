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

## OBS neste computador (25/10/2026)

- **OBS:** 33.0.0, perfil "Atlas Eleitoral", saída de 1920x1080 a 30 FPS, NVENC H.264 a 6.000 kbps para o YouTube.
- **GPU:** RTX 4050 Laptop, com NVENC H.264, HEVC e AV1. Na transmissão horizontal, o codificador ficou entre ~20% e 55% de uso.
- **Plugin Aitum Vertical:** **não instalado**. Nada foi instalado nem alterado.
- **Rede:** só Wi-Fi 5 GHz, sem cabo. A live de teste a 6 Mbps perdeu 0,1% dos quadros. A velocidade de **upload não foi medida**.

## Plano de conexão

### Opção recomendada: Aitum Vertical (gratuito, código aberto)

1. Instalar o plugin depois de conferir, na página oficial da Aitum, a versão compatível com o OBS 33.0.0.
2. No canvas vertical (1080x1920), criar a cena "ATLAS VERTICAL — REAL" com uma fonte Navegador de 1080x1920 e 30 FPS, apontando para `transmissao-vertical.html`, com as mesmas opções da horizontal.
3. Adicionar duas saídas de transmissão no canvas vertical, Instagram e Facebook, com o servidor RTMPS e a chave de cada uma. A cena horizontal e a saída do YouTube continuam como estão.

### Alternativa sem plugin

Abrir uma segunda instância do OBS (atalho com `--multi`), com um perfil vertical de 1080x1920. Ela gasta mais memória: são dois OBS e dois navegadores incorporados.

## Estimativa de consumo (não medida com as três saídas juntas)

| Item | Estimativa |
|---|---|
| Codificações | 1 horizontal + até 2 verticais = até **3 sessões NVENC**. A placa aceita várias sessões simultâneas; o limite prático é a carga do codificador. |
| Codificador da GPU | 60–100% com três saídas em 1080p30. **Risco de perder quadros.** Para aliviar: vertical em 720x1280, preset p4 e 3.500–4.500 kbps. |
| GPU (renderização) | +10–15% para a segunda página animada |
| CPU | Baixo; o OBS usou 1–3% |
| Upload | YouTube 6 + Instagram ~4 + Facebook ~4 + áudio ≈ **14–15 Mbps**. Com margem, é preciso **≥ 20 Mbps de upload estável**. |

## Plataformas

- **Instagram:** transmissão por chave só pelo **Live Producer** (instagram.com no computador → Criar → Ao vivo), em conta profissional elegível. A chave vale para uma live e expira.
- **Facebook:** Live Producer, que aceita vídeo vertical, com chave persistente ou por evento.
- **Valores das plataformas:** resolução, taxa e intervalo de quadro-chave devem ser conferidos no Live Producer de cada uma no momento da configuração. **Não foram verificados aqui.**
- **Áudio:** as duas plataformas exigem uma trilha AAC. O OBS envia uma trilha silenciosa mesmo sem fontes de áudio. Microfone e áudio do computador continuam desligados.
- **Quedas de conexão:** cada saída reconecta sozinha e uma queda não derruba as outras. Ainda assim, o comportamento do Instagram e do Facebook depois de uma queda longa **precisa ser testado**.

## Antes de ir ao ar (ação humana)

1. Medir o upload, por exemplo no speedtest ou no fast.com. Se ficar abaixo de ~20 Mbps, transmitir a vertical em uma plataforma só, ou em 720x1280.
2. Instalar o Aitum Vertical, ou preparar o segundo OBS, e fazer uma live **privada** de teste em cada plataforma. No Facebook, use o público "Somente eu".
3. Conferir num celular se nada importante fica sob os comentários.
4. **Não considerar as três transmissões prontas sem esse teste real.**
