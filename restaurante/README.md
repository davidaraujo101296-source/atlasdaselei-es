# Comanda Fácil

Sistema simples para bar e restaurante, feito para ser usado no celular por qualquer pessoa.

- **Pedidos**: escolha a mesa (ou escreva um nome), toque nos produtos e mande para a cozinha. A comanda sai impressa na cozinha.
- **Fechar a conta**: dinheiro (com cálculo de troco), Pix, cartão ou fiado.
- **Caderninho de fiado**: clientes, quanto cada um deve, anotar fiado, receber pagamento, ligar ou mandar WhatsApp.
- **Produtos**: cadastre e mude preços quando quiser. Bebidas podem ficar marcadas para **não** imprimir na cozinha.
- **Vendas do dia**: total por forma de pagamento, fiado recebido e os produtos mais vendidos.
- **Letra grande**: botões **A−** e **A+** sempre no topo da tela, com 5 tamanhos. O celular guarda a escolha.

Não emite nota fiscal; é só para controle interno.

## O que precisa

- Um servidor (ou um computador sempre ligado) com **Node.js 22.13 ou mais novo**, ou com **Docker**.
- Não tem dependências para instalar: o banco de dados (SQLite) já vem dentro do Node.

## Como rodar

### Com Node.js

```bash
cd restaurante
npm start
```

Abra `http://IP-DO-SERVIDOR:3000` no celular. No primeiro acesso, o sistema pede o nome do bar e uma senha.

Configurações por variável de ambiente (todas opcionais):

| Variável        | Padrão                     | Para que serve                                   |
|-----------------|----------------------------|--------------------------------------------------|
| `PORT`          | `3000`                     | Porta do site                                    |
| `BANCO`         | `./dados/restaurante.db`   | Onde fica o arquivo do banco de dados            |
| `FUSO`          | `America/Sao_Paulo`        | Fuso horário usado nas datas e nas vendas do dia |
| `COOKIE_SEGURO` | automático                 | `1` força o login só por https                   |

Para deixar rodando sempre (Linux com systemd), crie `/etc/systemd/system/comanda.service`:

```ini
[Unit]
Description=Comanda Fácil
After=network.target

[Service]
WorkingDirectory=/opt/comanda/restaurante
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server.js
Environment=PORT=3000
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

Depois rode `sudo systemctl enable --now comanda`.

### Com Docker

```bash
cd restaurante
docker compose up -d --build
```

Os dados ficam no volume `dados`.

### Acesso pela internet (https)

Se o servidor estiver na internet, coloque um proxy com https na frente: Caddy, Nginx ou Cloudflare Tunnel. Com o Caddy, basta isto:

```
comanda.seudominio.com.br {
    reverse_proxy localhost:3000
}
```

O login dura 400 dias no celular. Sua mãe só digita a senha de novo se sair do sistema ou se a senha for trocada.

### Colocar na tela inicial do celular

No Chrome do Android: abra o site, toque no menu **⋮** e depois em **Adicionar à tela inicial**. O ícone abre o sistema como se fosse um aplicativo.

## Impressora da cozinha

Funciona com impressoras térmicas comuns de 58mm ou 80mm que entendem **ESC/POS**, como Epson, Elgin i7/i9, Bematech, Tanca, Knup e as "genéricas". A configuração fica em **Ajustes → Impressora da cozinha**, e o botão **Imprimir teste** mostra na hora se deu certo.

Só vai para a cozinha o que é novo. Se pedirem mais um lanche depois, sai uma comanda só com ele. Se tirarem um item que já foi para a cozinha, sai um papel **CANCELAR**. Se a impressora falhar, aparece um aviso vermelho na tela inicial com o botão **Imprimir de novo**.

Escolha um dos dois jeitos de ligar:

### 1. Impressora de rede (servidor e impressora na mesma rede)

Use se o servidor fica **dentro** do restaurante, ou se ele alcança a rede de lá por VPN. A impressora precisa estar no cabo de rede ou no Wi-Fi.

1. Descubra o IP da impressora. Na maioria delas, basta ligar segurando o botão **FEED** que sai uma folhinha com o endereço.
2. Em Ajustes, escolha **Impressora de rede**, coloque o IP e deixe a porta **9100**.

### 2. Por um computador no restaurante (servidor na internet)

Use se o servidor está **fora** do restaurante. Um computador velho, um notebook ou um Raspberry Pi dentro do restaurante roda o programinha `agente-impressao.js`. Ele busca os pedidos no servidor e manda para a impressora. Funciona com impressora de rede **ou USB**.

1. Em Ajustes, escolha **Por um computador** e copie o **código** que aparece.
2. No computador do restaurante, instale o Node.js 18 ou mais novo e copie o arquivo `agente-impressao.js`.
3. Rode o programa:

   ```bash
   SERVIDOR=https://comanda.seudominio.com.br \
   TOKEN=codigo-copiado-dos-ajustes \
   IMPRESSORA=192.168.0.50:9100 \
   node agente-impressao.js
   ```

   O valor de `IMPRESSORA` depende de como ela está ligada:
   - Impressora de rede: `192.168.0.50` ou `192.168.0.50:9100`.
   - USB no Linux ou Raspberry Pi: `/dev/usb/lp0`. O usuário precisa estar no grupo `lp`.
   - USB no Windows: compartilhe a impressora com o nome `Cozinha`, use o driver "Generic / Text Only" e coloque `\\localhost\Cozinha`.

   No Windows (PowerShell), o mesmo comando fica assim:

   ```powershell
   $env:SERVIDOR="https://comanda.seudominio.com.br"; $env:TOKEN="..."; $env:IMPRESSORA="\\localhost\Cozinha"; node agente-impressao.js
   ```

A tela de Ajustes mostra se o computador da impressora está conectado. Se ele ficar desligado por um tempo, os pedidos esperam e saem quando ele voltar.

**Acentos:** por padrão a comanda sai sem acento ("Porcao"), porque isso funciona em qualquer impressora. Se quiser acento, escolha **com acento (PC860)** e faça o teste. Se sair caractere estranho, volte para "sem acento".

## Cópia de segurança

Todos os dados ficam num arquivo só: `dados/restaurante.db`. Para fazer cópia com o sistema ligado, use:

```bash
sqlite3 dados/restaurante.db ".backup 'backup-$(date +%F).db'"
```

Também dá para parar o sistema e copiar a pasta `dados/` inteira.

## Desenvolvimento

```bash
npm test     # testes automáticos
npm start    # sobe o sistema em http://localhost:3000
```

Organização do código:

- `server.js`: liga o servidor.
- `src/db.js`: banco de dados e regras (pedidos, fiado, vendas).
- `src/app.js`: rotas da API, login e impressão.
- `src/escpos.js`: monta o papel da cozinha no padrão ESC/POS.
- `src/impressora.js`: envia para a impressora de rede (porta 9100).
- `public/`: as telas que aparecem no celular (HTML, CSS e JavaScript, sem framework).
- `agente-impressao.js`: programa da impressora para o computador do restaurante.
