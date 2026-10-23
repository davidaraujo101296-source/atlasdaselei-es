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

## Documentação oficial

- [TSE: Informações técnicas para divulgação 2026](https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados)
- [TSE: Divulgação dos resultados 2026](https://www.tse.jus.br/eleicoes/eleicoes-2026-content/divulgacao-dos-resultados-das-eleicoes-2026)
- [TSE: API pública de arquivos oficiais (configuração)](https://resultados.tse.jus.br/oficial/comum/config/ele-c.json)
- [Vercel: Functions](https://vercel.com/docs/functions)

**Este site é independente e não tem vínculo institucional com o Tribunal Superior Eleitoral.**
