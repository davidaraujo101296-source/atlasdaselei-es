'use strict';

const fs = require('node:fs');
const path = require('node:path');
const auth = require('./auth');
const escpos = require('./escpos');
const { ErroUsuario } = require('./erros');
const { enviarParaImpressora } = require('./impressora');

const PASTA_PUBLICA = path.join(__dirname, '..', 'public');
const COOKIE = 'sessao';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// ---------- impressão ----------

function criarServicoImpressao(repo, enviar) {
  async function tentarDireto(id, ajustes) {
    try {
      await enviar({ host: ajustes.impressora_host, porta: ajustes.impressora_porta }, repo.impressao(id).dados);
      repo.marcarImpressao(id, 'impresso');
      return { status: 'impresso', id };
    } catch (e) {
      repo.marcarImpressao(id, 'erro', e.message);
      return { status: 'erro', id, erro: e.message };
    }
  }

  return {
    /** Guarda o trabalho e, se a impressora é de rede, já manda imprimir. */
    async imprimir(dados, descricao) {
      const ajustes = repo.ajustes();
      if (ajustes.impressora_modo === 'desligada') return { status: 'desligada' };
      const id = repo.criarImpressao(dados, descricao);
      if (ajustes.impressora_modo === 'rede') return tentarDireto(id, ajustes);
      return { status: 'pendente', id };
    },
    async reimprimir(id) {
      const ajustes = repo.ajustes();
      repo.impressao(id);
      if (ajustes.impressora_modo === 'rede') return tentarDireto(id, ajustes);
      if (ajustes.impressora_modo === 'desligada') throw new ErroUsuario('A impressora está desligada nos ajustes.');
      repo.marcarImpressao(id, 'pendente');
      return { status: 'pendente', id };
    },
  };
}

// ---------- HTTP ----------

function lerCorpo(req, limite = 100_000) {
  return new Promise((resolver, rejeitar) => {
    const partes = [];
    let tamanho = 0;
    req.on('data', (p) => {
      tamanho += p.length;
      if (tamanho > limite) {
        rejeitar(new ErroUsuario('Dados grandes demais.', 413));
        req.destroy();
      } else partes.push(p);
    });
    req.on('end', () => {
      if (!partes.length) return resolver({});
      try {
        const corpo = JSON.parse(Buffer.concat(partes).toString('utf8'));
        resolver(corpo && typeof corpo === 'object' ? corpo : {});
      } catch {
        rejeitar(new ErroUsuario('Dados inválidos.'));
      }
    });
    req.on('error', rejeitar);
  });
}

function responderJson(res, status, dados) {
  const corpo = JSON.stringify(dados ?? null);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(corpo);
}

function servirArquivo(req, res) {
  let caminho = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (caminho === '/' || !path.extname(caminho)) caminho = '/index.html';
  const arquivo = path.normalize(path.join(PASTA_PUBLICA, caminho));
  if (!arquivo.startsWith(PASTA_PUBLICA + path.sep)) {
    res.writeHead(404).end();
    return;
  }
  fs.readFile(arquivo, (erro, conteudo) => {
    if (erro) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(arquivo)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(conteudo);
  });
}

function criarApp({ repo, enviarImpressora = enviarParaImpressora, cookieSeguro = null } = {}) {
  const impressao = criarServicoImpressao(repo, enviarImpressora);
  const limitador = auth.criarLimitador();
  const rotas = [];

  /** acesso: 'sessao' (padrão), 'publico' ou 'agente' */
  function rota(metodo, padrao, acao, acesso = 'sessao') {
    const re = new RegExp(`^/api${padrao.replace(/:(\w+)/g, '(?<$1>\\d+)')}$`);
    rotas.push({ metodo, re, acao, acesso });
  }

  const configurado = () => !!repo.lerConfig('senha_hash');

  function sessaoValida(req) {
    const token = auth.lerCookies(req.headers.cookie)[COOKIE];
    return !!token && repo.sessaoExiste(auth.hashToken(token));
  }

  function agenteValido(req) {
    const token = req.headers['x-agente-token'];
    const certo = repo.lerConfig('token_agente');
    return !!token && !!certo && auth.iguais(token, certo);
  }

  function abrirSessao(req, res) {
    const token = auth.novoToken();
    repo.criarSessao(auth.hashToken(token));
    const seguro = cookieSeguro ?? req.headers['x-forwarded-proto'] === 'https';
    res.setHeader('Set-Cookie',
      `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${400 * 24 * 3600}${seguro ? '; Secure' : ''}`);
  }

  const validarSenha = (senha) => {
    if (typeof senha !== 'string' || senha.length < 4) throw new ErroUsuario('A senha precisa ter pelo menos 4 letras ou números.');
    if (senha.length > 100) throw new ErroUsuario('A senha está muito comprida.');
    return senha;
  };

  const id = (p) => Number(p.id);

  async function imprimirCozinha(pedido, itens, tipo) {
    if (!itens.length) return null;
    const ajustes = repo.ajustes();
    const dados = escpos.comandaCozinha({
      ajustes, pedidoId: pedido.id, identificacao: pedido.identificacao, itens, tipo, quando: repo.agora(),
    });
    const quem = pedido.identificacao ? ` (${pedido.identificacao})` : '';
    return impressao.imprimir(dados, `${tipo === 'cancelar' ? 'Cancelamento' : 'Pedido'} ${pedido.id}${quem}`);
  }

  // --- acesso ---
  rota('GET', '/estado', ({ req }) => ({
    configurado: configurado(),
    logado: sessaoValida(req),
    nome: repo.ajustes().nome_estabelecimento,
  }), 'publico');

  rota('POST', '/configurar', ({ req, res, corpo }) => {
    if (configurado()) throw new ErroUsuario('O sistema já foi configurado.', 409);
    const senha = validarSenha(corpo.senha);
    repo.transacao(() => {
      repo.gravarConfig('senha_hash', auth.gerarHashSenha(senha));
      repo.gravarConfig('token_agente', auth.novoToken().slice(0, 24));
      if (corpo.nome) repo.salvarAjustes({ nome_estabelecimento: corpo.nome });
    });
    abrirSessao(req, res);
    return { ok: true };
  }, 'publico');

  rota('POST', '/entrar', ({ req, res, corpo }) => {
    const ip = req.socket.remoteAddress;
    if (limitador.bloqueado(ip)) throw new ErroUsuario('Muitas tentativas erradas. Espere 1 minuto e tente de novo.', 429);
    if (!auth.conferirSenha(corpo.senha, repo.lerConfig('senha_hash'))) {
      limitador.falhou(ip);
      throw new ErroUsuario('Senha errada. Tente de novo.', 401);
    }
    limitador.acertou(ip);
    abrirSessao(req, res);
    return { ok: true };
  }, 'publico');

  rota('POST', '/sair', ({ req, res }) => {
    const token = auth.lerCookies(req.headers.cookie)[COOKIE];
    if (token) repo.apagarSessao(auth.hashToken(token));
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    return { ok: true };
  });

  rota('POST', '/senha', ({ req, res, corpo }) => {
    if (!auth.conferirSenha(corpo.atual, repo.lerConfig('senha_hash'))) throw new ErroUsuario('A senha atual está errada.');
    repo.gravarConfig('senha_hash', auth.gerarHashSenha(validarSenha(corpo.nova)));
    repo.apagarSessoes();
    abrirSessao(req, res);
    return { ok: true };
  });

  // --- início ---
  rota('GET', '/resumo', () => repo.resumo());

  // --- produtos ---
  rota('GET', '/produtos', ({ url }) => repo.listarProdutos({ incluirEscondidos: url.searchParams.get('todos') === '1' }));
  rota('POST', '/produtos', ({ corpo }) => repo.criarProduto(corpo));
  rota('GET', '/produtos/:id', ({ p }) => repo.produto(id(p)));
  rota('PUT', '/produtos/:id', ({ p, corpo }) => repo.atualizarProduto(id(p), corpo));

  // --- clientes / fiado ---
  rota('GET', '/clientes', () => repo.listarClientes());
  rota('POST', '/clientes', ({ corpo }) => repo.criarCliente(corpo));
  rota('GET', '/clientes/:id', ({ p }) => repo.cliente(id(p)));
  rota('PUT', '/clientes/:id', ({ p, corpo }) => repo.atualizarCliente(id(p), corpo));
  rota('DELETE', '/clientes/:id', ({ p }) => { repo.apagarCliente(id(p)); return { ok: true }; });
  rota('POST', '/clientes/:id/fiado', ({ p, corpo }) => repo.lancarMovimento(id(p), 'compra', corpo));
  rota('POST', '/clientes/:id/pagamento', ({ p, corpo }) => repo.lancarMovimento(id(p), 'pagamento', corpo));
  rota('DELETE', '/movimentos/:id', ({ p }) => repo.apagarMovimento(id(p)));

  // --- pedidos ---
  rota('GET', '/pedidos', () => repo.listarPedidosAbertos());
  rota('POST', '/pedidos', ({ corpo }) => repo.criarPedido(corpo));
  rota('GET', '/pedidos/:id', ({ p }) => repo.pedido(id(p)));
  rota('PUT', '/pedidos/:id', ({ p, corpo }) => repo.renomearPedido(id(p), corpo));
  rota('POST', '/pedidos/:id/itens', ({ p, corpo }) => repo.adicionarItem(id(p), corpo));

  async function alterarItem(itemId, dados) {
    const { pedido, cancelar } = repo.alterarItem(itemId, dados);
    const impresso = await imprimirCozinha(pedido, cancelar, 'cancelar');
    return { ...pedido, impressao: impresso };
  }
  rota('PUT', '/itens/:id', ({ p, corpo }) => alterarItem(id(p), corpo));
  rota('DELETE', '/itens/:id', ({ p }) => alterarItem(id(p), { quantidade: 0 }));

  rota('POST', '/pedidos/:id/enviar', async ({ p }) => {
    const { pedido, novos } = repo.marcarEnviados(id(p));
    if (!novos.length) throw new ErroUsuario('Não tem nada novo para mandar para a cozinha.');
    return { ...pedido, impressao: await imprimirCozinha(pedido, novos, 'novo') };
  });

  rota('POST', '/pedidos/:id/fechar', async ({ p, corpo }) => {
    // Confere tudo antes de mexer em qualquer coisa.
    const atual = repo.pedido(id(p));
    if (atual.status !== 'aberto') throw new ErroUsuario('Esse pedido já foi fechado.');
    if (!atual.itens.length) throw new ErroUsuario('O pedido está vazio. Adicione algum produto antes de fechar.');
    if (!['dinheiro', 'pix', 'cartao', 'fiado'].includes(corpo.forma)) throw new ErroUsuario('Escolha como o cliente pagou.');
    if (corpo.forma === 'fiado') {
      if (!Number.isInteger(corpo.cliente_id)) throw new ErroUsuario('Escolha quem vai ficar devendo.');
      repo.cliente(corpo.cliente_id);
    }
    // O que ainda não foi para a cozinha vai agora, antes de fechar a conta.
    const { pedido: aberto, novos } = repo.marcarEnviados(id(p));
    const impresso = await imprimirCozinha(aberto, novos, 'novo');
    return { ...repo.fecharPedido(id(p), corpo), impressao: impresso };
  });

  rota('POST', '/pedidos/:id/cancelar', async ({ p }) => {
    const { pedido, cancelar } = repo.cancelarPedido(id(p));
    return { ...pedido, impressao: await imprimirCozinha(pedido, cancelar, 'cancelar') };
  });

  // --- vendas ---
  rota('GET', '/vendas', ({ url }) => repo.vendas(url.searchParams.get('data') || repo.agora().slice(0, 10)));

  // --- ajustes e impressora ---
  function ajustesCompletos() {
    return {
      ...repo.ajustes(),
      token_agente: repo.lerConfig('token_agente') || '',
      agente_visto_em: repo.lerConfig('agente_visto_em') || null,
      agora: repo.agora(),
    };
  }
  rota('GET', '/ajustes', ajustesCompletos);
  rota('PUT', '/ajustes', ({ corpo }) => { repo.salvarAjustes(corpo); return ajustesCompletos(); });
  rota('POST', '/ajustes/novo-token', () => { repo.gravarConfig('token_agente', auth.novoToken().slice(0, 24)); return ajustesCompletos(); });
  rota('POST', '/ajustes/teste-impressao', async () => {
    const ajustes = repo.ajustes();
    if (ajustes.impressora_modo === 'desligada') throw new ErroUsuario('Escolha primeiro como a impressora está ligada.');
    return impressao.imprimir(escpos.paginaTeste({ ajustes, quando: repo.agora() }), 'Página de teste');
  });

  rota('GET', '/impressoes', () => ({ problemas: repo.problemasImpressao(), recentes: repo.listarImpressoes() }));
  rota('POST', '/impressoes/:id/reimprimir', ({ p }) => impressao.reimprimir(id(p)));
  rota('POST', '/impressoes/:id/descartar', ({ p }) => { repo.descartarImpressao(id(p)); return { ok: true }; });

  // --- agente de impressão (programinha que roda no computador do restaurante) ---
  rota('GET', '/agente/proxima', ({ res }) => {
    repo.gravarConfig('agente_visto_em', repo.agora());
    const trabalho = repo.ajustes().impressora_modo === 'agente' ? repo.proximaPendente() : null;
    if (!trabalho) {
      res.writeHead(204).end();
      return undefined;
    }
    return { id: trabalho.id, descricao: trabalho.descricao, dados: trabalho.dados.toString('base64') };
  }, 'agente');
  rota('POST', '/agente/:id/resultado', ({ p, corpo }) => {
    repo.marcarImpressao(id(p), corpo.ok ? 'impresso' : 'erro', corpo.ok ? '' : String(corpo.erro || 'Erro na impressora'));
    return { ok: true };
  }, 'agente');

  return async function tratar(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
      return servirArquivo(req, res);
    }
    try {
      const candidatas = rotas.filter((r) => r.re.test(url.pathname));
      const encontrada = candidatas.find((r) => r.metodo === req.method);
      if (!encontrada) throw new ErroUsuario('Não encontrado.', candidatas.length ? 405 : 404);
      if (encontrada.acesso === 'sessao' && !sessaoValida(req)) throw new ErroUsuario('Entre com a senha.', 401);
      if (encontrada.acesso === 'agente' && !agenteValido(req)) throw new ErroUsuario('Código do agente errado.', 401);
      if (req.method !== 'GET' && encontrada.acesso !== 'agente') {
        const tipo = req.headers['content-type'] || '';
        if (req.headers['content-length'] !== '0' && req.headers['content-length'] && !tipo.startsWith('application/json')) {
          throw new ErroUsuario('Formato não aceito.', 415);
        }
      }
      const corpo = req.method === 'GET' ? {} : await lerCorpo(req);
      const resultado = await encontrada.acao({ req, res, url, corpo, p: url.pathname.match(encontrada.re).groups || {} });
      if (!res.headersSent) responderJson(res, 200, resultado);
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof ErroUsuario) return responderJson(res, e.status, { erro: e.message });
      console.error(e);
      responderJson(res, 500, { erro: 'Aconteceu um erro no sistema. Tente de novo.' });
    }
  };
}

module.exports = { criarApp };
