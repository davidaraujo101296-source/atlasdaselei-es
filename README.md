# Atlas Eleitoral — Histórico + Apuração ao Vivo

Site independente para acompanhar a **apuração oficial do 2º turno, em 25/10/2026**, com dados publicados pelo TSE. Projeto simples, **sem banco de dados, sem chaves e sem bibliotecas externas para a API**, preparado para conectar a um repositório GitHub e publicar na **Vercel**.

## Conteúdo do pacote

- `index.html` — página inicial com resultados históricos (2018, 2022, 2024 e 2026), mapa e comparação nacional/estadual.
- `atlas.html` — rota histórica alternativa que mantém links antigos funcionando.
- `ao-vivo.html` — painel da apuração ao vivo (presidente nacional/UF e governador nos estados com segundo turno).
- `api/apuracao.js` — consulta por cargo e abrangência no TSE, usando função Node da Vercel.
- `api/mapa.js` — consolida a situação da apuração presidencial nas 27 unidades da Federação, com concorrência limitada.
- `lib/tse.js` — validação, endereços oficiais e leitura do JSON EA20.
- `tests/tse.test.js` — testes locais, executáveis com `npm test`.
- `vercel.json` — configuração de limites de execução.

## Revisar no computador (sem publicação)

Com Node.js 20 ou mais novo, abra um terminal na pasta do projeto:

```bash
npm test
npm run dev
```

Não é necessário instalar dependências. Abra **http://127.0.0.1:3000** para o
Atlas Histórico, **http://127.0.0.1:3000/atlas.html** para a rota alternativa e
**http://127.0.0.1:3000/ao-vivo.html** para a apuração. O servidor local reutiliza
os handlers de `api/`, incluindo as consultas ao TSE e as regras de pré-apuração.
Ele escuta apenas no próprio computador e não publica nem altera o projeto remoto.
Encerre com `Ctrl+C`. Se a porta estiver ocupada, use no PowerShell:
`$env:PORT=3001; npm run dev`.

Para revisar barras e resultados preenchidos, abra
**http://127.0.0.1:3000/ao-vivo.html?demo=1**. Esse modo mostra votos fictícios,
com aviso explícito de demonstração. Mapas geográficos e consultas oficiais
precisam de internet. A indisponibilidade de uma fonte não deve ser interpretada
como resultado eleitoral.

A identidade das três páginas está centralizada em `styles.css`. Os arquivos
`index.html` e `atlas.html` devem permanecer sincronizados. As cores dos candidatos
e partidos são independentes das cores de navegação.

## Como publicar (GitHub + Vercel)

1. Extraia o arquivo ZIP. Suba **o conteúdo completo da pasta**, não apenas o HTML, a um repositório GitHub.
2. Abra [vercel.com/new](https://vercel.com/new), importe o repositório e selecione **Other** (sem framework).
3. Deixe o diretório raiz na pasta onde estão `index.html`, `api`, `lib` e `vercel.json`. Se o repositório contiver a pasta `atlas-eleitoral-ao-vivo` dentro dele, selecione essa pasta como **Root Directory**.
4. Não é necessário `npm install`, build, banco de dados nem variáveis de ambiente. Publique com **Deploy**.
5. Teste primeiro `https://SEU-ENDERECO.vercel.app/api/apuracao?cargo=presidente&uf=BR` e depois o histórico `https://SEU-ENDERECO.vercel.app/` e o ao vivo `https://SEU-ENDERECO.vercel.app/ao-vivo.html`.
6. Para conferir o layout com números **fictícios e claramente identificados**, use `https://SEU-ENDERECO.vercel.app/ao-vivo.html?demo=1`. Nunca confunda esse modo com a apuração oficial.

**Importante:** use `npm run dev` para revisar o site localmente com estilos, links e API. Abrir `ao-vivo.html` diretamente como arquivo ativa o **modo demonstração**; a API requer o servidor local ou funções de servidor na hospedagem. Um hosting puramente estático (GitHub Pages, por exemplo) **não executa** a pasta `api/`.

## Funcionamento

- Fonte oficial: `https://resultados.tse.jus.br`, ambiente `oficial`, ciclo `ele2026`, pleito `3221`.
- Presidente: eleição **6258**, cargo `0001`, abrangência `BR` ou `UF`.
- Governador: eleição **6260**, cargo `0003`; segundo turno em **AC, AM, DF, ES, RN e TO**, conforme arquivo de configuração público do TSE consultado em outubro de 2026.
- Antes de **25/10/2026 17:00 BRT**, não são feitas consultas estaduais para o 2º turno; a presidência nacional permite consulta ao arquivo publicado previamente, normalmente com zero votos.
- A partir de 17h BRT, a página consulta automaticamente a corrida selecionada aproximadamente a cada **40 segundos** e o mapa estadual a cada **90 segundos**, enquanto a aba está ativa.
- O CDN da Vercel mantém cache de **20 segundos** para cada corrida e **55 segundos** para o panorama dos estados. Isso evita uma chamada ao TSE por visitante, embora não garanta um intervalo de entrega exato para todos.
- Caso o TSE esteja indisponível, a interface avisa e não substitui votos por resultados inventados.
- As barras são percentuais de candidatos fornecidos pelo TSE, e o painel mostra o estado da totalização conforme o dado publicado. **Estar numericamente à frente não é sinônimo de vitória oficial.**
- O mapa geográfico é obtido de uma biblioteca pública de GeoJSON; se não carregar, um contorno simplificado com estados selecionáveis continua disponível.

### Endpoints disponíveis

```text
/api/apuracao?cargo=presidente&uf=BR
/api/apuracao?cargo=presidente&uf=SP
/api/apuracao?cargo=governador&uf=AC
/api/mapa
```

`/api/apuracao?cargo=governador&uf=SP` responde erro de validação intencionalmente, pois não há segundo turno para governador de SP em 2026.

## Testes

No computador, com Node.js 20 ou mais novo:

```bash
npm test
```

Os testes unitários verificam o formato do endereço oficial, a validação de cargo e UF, a leitura do JSON EA20, o comportamento de **zero votos** antes de começar e a prevenção de consultas estaduais prematuras. **Esses testes não substituem um teste de ponta a ponta com os endpoints reais na Vercel.**

### Pontos de atenção antes de domingo

- Confirmar o **acesso de rede** da função Vercel ao domínio oficial do TSE, examinando uma resposta `/api/apuracao`.
- Verificar as diferenças de formatos efetivamente publicadas no dia, além de acesso aos arquivos para cada estado. O código segue a documentação e uma amostra real pré-apuração, mas não foi validado com votos do segundo turno (eles ainda não foram divulgados).
- Conferir carga e comportamento de cache na hospedagem escolhida. Consultas excessivas e 404 repetidos podem bloquear temporariamente o IP no TSE; a API evita buscar estados antes de 17h e restringe concorrência.
- Monitorar o site no horário de divulgação. O modo “ao vivo” é **atualização automática periódica**, não transmissão de vídeo ou push em tempo real.
- A Vercel Hobby é de **uso pessoal/não comercial**; caso o projeto passe a exibir anúncios ou operar comercialmente, reavaliar a hospedagem/plano.

## Histórico presidencial em arquivos estáticos

Os resultados presidenciais de **2018 (1º e 2º turnos), 2022 (1º e 2º turnos) e 2026 (1º turno)** ficam em `dados/historico/presidente-<ano>-<turno>.json`. O navegador carrega cada arquivo uma vez por sessão; a navegação não consulta o TSE para esses resultados.

Cada arquivo traz, para o Brasil, cada UF e o exterior (`ZZ`): votos por candidato (indexados pelo identificador oficial `SQ_CANDIDATO`/`sqcand`), percentuais sobre votos válidos, brancos e nulos com percentual sobre o total de votos, comparecimento, abstenções, fonte oficial e data de extração e validação.

- **Fontes:** 2018 e 2022 vêm do Portal de Dados Abertos do TSE (`votacao_candidato_munzona` e `detalhe_votacao_munzona`). O importador lê só a entrada `_BR.csv` dos ZIPs, via HTTP Range. 2026 (1º turno) vem dos arquivos oficiais de divulgação, com totalização final.
- **Validações (o importador falha se alguma não fechar):** soma dos candidatos = votos válidos em cada área; válidos + brancos + nulos + anulados = total de votos; comparecimento + abstenções + eleitores de seções não instaladas = aptos; Brasil = 27 UFs + exterior. Em 2026, o arquivo nacional do TSE é conferido contra a soma dos estaduais, e o percentual calculado contra o publicado (`pvap`).
- **Atualizar em caso de retificação oficial:** `node scripts/historico/importar-presidente.cjs --atualizar` e depois `npm test`. Os arquivos brutos ficam em `dados-brutos/`, fora do Git e do site.

**Ainda dependem de consulta externa pelo navegador:** governador, senador e deputados (2022 e 2026) e prefeito e vereador (2024). Esses cargos não foram migrados. Os arquivos JSON de divulgação de 2022 no `resultados.tse.jus.br` respondem 404 desde a verificação de 23/10/2026; para governador e senador de 2022, o site usa o CSV compilado pelo NOPolitica.

## Contador de audiência (desligado por padrão)

 mostra, perto da navegação, quantas pessoas estão online agora, os visitantes e as visualizações do dia, o pico de simultâneos e o tempo de permanência. Os dados vêm de , que guarda tudo num Redis gerenciado (Upstash) compartilhado entre as instâncias. Sem o serviço configurado, o painel mostra **"Estatísticas indisponíveis"**, nunca zero. A transmissão do OBS () não carrega o contador.

**Definições:**
- **Online:** navegador com página aberta e visível que enviou sinal nos últimos 7 minutos. Só uma aba por navegador envia.
- **Visitantes:** identificadores anônimos distintos do dia, renovados diariamente.
- **Visualizações:** carregamentos de página.
- **Pico:** maior número de simultâneos registrado no dia.
- **Permanência:** soma estimada do tempo de páginas visíveis.
- Com muitos acessos, só uma fração dos navegadores envia sinais e os números aparecem como estimativa (≈).

**Para ligar (ação humana):**
1. Na Vercel: projeto → **Storage** → **Upstash for Redis** → plano **Free** → conectar ao projeto. Isso cria as variáveis  e .
2. Em **Settings → Environment Variables** (Production):  e, de preferência,  com um texto aleatório longo.
3. Publicar de novo, com um novo deploy.

**Para desligar sem derrubar o site:**
- **Imediato:** no console do Upstash, . A coleta para em 1 a 2 minutos e as leituras continuam.
- **Completo:** remover  e publicar.

**Proteções:**
- orçamentos de escritas (25 mil/dia e 60 mil/mês) e de comandos Redis (400 mil/mês, abaixo dos 500 mil gratuitos);
- limite por IP (só um hash diário com segredo; o IP nunca é gravado);
- um sinal de presença por visitante por minuto e filtro de robôs;
- só aceita sinais da própria origem;
- leitura cacheada por 30 s no CDN e amostragem adaptativa.

Todos os limites podem ser ajustados pelas variáveis  (ver ).

## Transmissão automática (OBS + YouTube)

`transmissao.html` é uma tela de 1920x1080 para o OBS. Ela alterna sozinha entre a visão nacional, um estado em destaque e as novas parciais. Os dados vêm **sempre** das APIs públicas da Vercel (`/api/apuracao?cargo=presidente&uf=BR` e `/api/mapa`), nas URLs canônicas, mesmo com a página aberta em `127.0.0.1`. Ela não consulta o TSE diretamente.

**Configurar o OBS (Windows):**

1. Abra a página por um destes caminhos:
   - servidor local: `npm run dev` e mantenha o terminal aberto durante toda a live; a URL é `http://127.0.0.1:3000/transmissao.html`;
   - depois do merge na `main`: `https://atlasdaselei-es.vercel.app/transmissao.html`, sem servidor local.
2. Em **Configurações → Vídeo**, use resolução base e de saída **1920x1080** e **30 FPS**.
3. Adicione uma fonte **Navegador** com essa URL, largura **1920**, altura **1080** e FPS personalizado **30**. Deixe **desmarcados** "Desligar fonte quando não estiver visível" e "Atualizar navegador quando a cena se tornar ativa".
4. Em **Configurações → Transmissão**, escolha o serviço YouTube com a chave da live. Para 1080p30, use de 4.500 a 9.000 kbps.
5. Silencie o microfone no mixer: a transmissão é só visual.
6. Antes da live, teste com `?demo=1`, que mostra "DEMONSTRAÇÃO — DADOS FICTÍCIOS". **Nunca transmita com `?demo=1`.**
7. Se a página travar, clique com o botão direito na fonte → **Atualizar**. O último resultado válido volta na hora, marcado como recuperado.

**Tempos de cena** (opcionais, em segundos): `transmissao.html?nacional=20&estado=15&parcial=15`.

**Comportamento:**
- **Antes das 17h:** "Aguardando divulgação oficial", com contagem regressiva e sem números.
- **Com votos:** a visão nacional dura ~20 s e o estado em destaque ~15 s, com aproximação suave no mapa.
- **Nova parcial:** só conta quando as seções ou os votos oficiais de uma UF avançam. Não conta uma nova consulta do mesmo arquivo, `fetchedAt` diferente, resposta `stale` ou resposta antiga vinda do CDN. A parcial entra depois da cena atual, numa fila limitada, sem repetir a mesma UF antes de 4 minutos e alternando regiões.
- **Em falha:** a tela mantém o último resultado válido, com o aviso "Dados desatualizados", e volta sozinha quando a consulta seguinte funciona.
- **Indicador AO VIVO:** só pisca com a apuração oficial em andamento e com dados atualizados.

O mapa vem da malha oficial do IBGE e é gerado com `node scripts/transmissao/gerar-mapa.cjs`. O teste de tela em 1920x1080 está em `tests/e2e/transmissao.e2e.cjs` e usa Playwright e Chrome; ele não faz parte do `npm test`.

## Documentação oficial

- [TSE: Informações técnicas para divulgação 2026](https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados)
- [TSE: Divulgação dos resultados 2026](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/divulgacao-dos-resultados-das-eleicoes-2026)
- [TSE: API pública de arquivos oficiais (configuração)](https://resultados.tse.jus.br/oficial/comum/config/ele-c.json)
- [Vercel: Functions](https://vercel.com/docs/functions)

**Este site é independente e não tem vínculo institucional com o Tribunal Superior Eleitoral.**
