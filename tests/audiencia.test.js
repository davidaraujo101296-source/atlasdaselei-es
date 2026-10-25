'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const handler=require('../api/audiencia');
const A=require('../lib/audiencia');
const {RedisFalso}=require('./helpers/redis-falso.cjs');
const {simular}=require('../scripts/audiencia/simular-consumo.cjs');

// Upstash simulado na camada HTTP (protocolo de pipeline), com relógio controlado.
function ambiente(extra={}){return{AUDIENCIA_ATIVA:'1',UPSTASH_REDIS_REST_URL:'https://simulado.upstash.io',UPSTASH_REDIS_REST_TOKEN:'token-de-teste',AUDIENCIA_SEGREDO:'segredo-de-teste',...extra}}
function cenario(extra){
 let agora=Date.parse('2026-10-25T20:00:00-03:00');
 const relogio=()=>agora;const redis=new RedisFalso(relogio);let http=0;
 global.fetch=async(url,opts)=>{
  http++;
  if(redis.falhar)throw new Error('rede');
  assert.equal(url,'https://simulado.upstash.io/pipeline');assert.equal(opts.headers.Authorization,'Bearer token-de-teste');
  const r=JSON.parse(opts.body).map(c=>redis.run(c));
  return {ok:true,status:200,json:async()=>r.map(result=>({result}))};
 };
 handler.redefinir();
 const env=ambiente(extra);
 const resp=()=>({statusCode:0,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},end(t){this.corpo=t?JSON.parse(t):undefined}});
 return {
  redis,get http(){return http},
  avancar(ms){agora+=ms},
  async sinal(tipo,vid,{passo=0,n=1,ua='Mozilla/5.0 (Windows NT 10.0) Chrome/130',origin='https://atlasdaselei-es.vercel.app',site='same-origin'}={}){
   const r=resp();await handler({method:'POST',headers:{host:'atlasdaselei-es.vercel.app',origin,'sec-fetch-site':site,'user-agent':ua,'x-forwarded-for':`200.1.${n>>8&255}.${n&255}`},body:{tipo,vid,passo}},r,env,relogio);return r;
  },
  async ler(){agora+=31000;const r=resp();await handler({method:'GET',headers:{}},r,env,relogio);return r},
 };
}
// Identificadores com fração conhecida (hash FNV-1a), para testar a amostragem no servidor.
function vidCom(cond,inicio=0){for(let i=inicio;;i++){const v='visitante-anonimo-'+String(i).padStart(5,'0');if(cond(A.fracao(v)))return v}}
const vid=i=>vidCom(()=>true,i);

test('desligado por padrão: não toca no armazenamento e não mostra números',async()=>{
 let chamadas=0;global.fetch=async()=>{chamadas++;throw new Error('não deveria chamar')};
 handler.redefinir();
 const r={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},end(t){this.corpo=t?JSON.parse(t):undefined}};
 await handler({method:'GET',headers:{}},r,{});
 assert.deepEqual(r.corpo,{ok:true,disponivel:false,motivo:'desativado'});
 const p={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},end(){}};
 await handler({method:'POST',headers:{},body:{tipo:'pv',vid:vid(1),passo:0}},p,{AUDIENCIA_ATIVA:'1'});
 assert.equal(p.statusCode,204);assert.equal(p.headers['x-audiencia-coleta'],'0');assert.equal(chamadas,0);
});

test('visitante novo aparece online imediatamente, sem esperar o primeiro sinal de presença',async()=>{
 const c=cenario();
 const r=await c.sinal('pv',vid(1));
 assert.equal(r.statusCode,204);assert.equal(r.headers['x-audiencia-coleta'],'1');
 const l=await c.ler();
 assert.equal(l.corpo.online,1);assert.equal(l.corpo.unicosHoje,1);assert.equal(l.corpo.visualizacoesHoje,1);assert.equal(l.corpo.picoHoje,1);
 assert.equal(l.corpo.estimativa,false);assert.match(l.headers['cache-control'],/s-maxage=30/);
});

test('saída e expiração da presença; reentrada não duplica o visitante',async()=>{
 const c=cenario();
 const v=vid(3);
 await c.sinal('pv',v);
 c.avancar(6*60000);assert.equal((await c.ler()).corpo.online,1,'dentro da janela de 7 min');
 c.avancar(2*60000);assert.equal((await c.ler()).corpo.online,0,'saiu');
 await c.sinal('pv',v);
 const r=await c.ler();
 assert.equal(r.corpo.online,1);assert.equal(r.corpo.unicosHoje,1);
});

test('várias pessoas simultâneas e pico de simultâneos',async()=>{
 const c=cenario();
 for(let i=1;i<=5;i++)await c.sinal('pv',vid(i*10),{n:i});
 assert.equal((await c.ler()).corpo.online,5);
 c.avancar(8*60000);
 for(let i=1;i<=2;i++)await c.sinal('hb',vid(i*10),{n:i});
 const r=await c.ler();
 assert.equal(r.corpo.online,2);assert.equal(r.corpo.picoHoje,5);
});

test('várias abas do mesmo navegador: um online, um visitante, presença uma vez por minuto',async()=>{
 const c=cenario();
 const v=vid(7);
 await c.sinal('pv',v);await c.sinal('pv',v);await c.sinal('pv',v);
 await c.sinal('hb',v);await c.sinal('hb',v);
 const r=await c.ler();
 assert.equal(r.corpo.online,1);assert.equal(r.corpo.unicosHoje,1);assert.equal(r.corpo.visualizacoesHoje,3);
 assert.equal(r.corpo.tempoHorasHoje,0.1,'só um sinal de presença conta tempo (180 s)');
});

test('contabilidade exata: todo comando Redis enviado entra no orçamento, inclusive rejeitados',async()=>{
 const c=cenario({AUDIENCIA_MAX_POR_IP_MIN:'2'});
 for(let i=1;i<=6;i++)await c.sinal('pv',vid(i*3),{n:9});        // 4 rejeitados por IP
 await c.sinal('pv',vid(100),{ua:'Googlebot/2.1'});               // robô: nem chega ao Redis
 await c.ler();
 const mes=A.mesBR(Date.parse('2026-10-25T20:00:00-03:00')),dia=A.diaBR(Date.parse('2026-10-25T20:00:00-03:00'));
 assert.equal(Number(c.redis.get('aud:cmd:'+mes)),c.redis.comandos,'contador mensal = comandos reais');
 assert.equal(Number(c.redis.get('aud:cmd:'+dia)),c.redis.comandos,'contador diário = comandos reais');
});

test('orçamento atingido: disjuntor zera comandos Redis; leitura indisponível, sem números',async()=>{
 const c=cenario({AUDIENCIA_MAX_COMANDOS_DIA:'60'});
 for(let i=1;i<=6;i++)await c.sinal('pv',vid(i*5),{n:i});
 const r=await c.sinal('pv',vid(200),{n:50});
 assert.equal(r.headers['x-audiencia-coleta'],'0','navegador recebe ordem de parar');
 const antes=c.redis.comandos,http=c.http;
 for(let i=0;i<50;i++)await c.sinal('pv',vid(300+i),{n:60+i});
 assert.equal(c.redis.comandos,antes,'nenhum comando Redis com o disjuntor aberto');assert.equal(c.http,http);
 const l=await c.ler();
 assert.equal(l.corpo.disponivel,false);assert.equal('online' in l.corpo,false);assert.match(l.headers['cache-control'],/s-maxage=60|s-maxage=120/);
 c.avancar(5*60000);
 await c.sinal('pv',vid(400),{n:200});
 assert.ok(c.redis.comandos>antes,'após 5 min a instância volta a conferir o orçamento');
 assert.ok(c.redis.comandos-antes<=5,'conferência custa só a fase inicial');
});

test('coleta desativada em tempo real (aud:desligado): para em toda a instância',async()=>{
 const c=cenario();
 c.redis.run(['SET','aud:desligado','1']);
 const r=await c.sinal('pv',vid(1));
 assert.equal(r.headers['x-audiencia-coleta'],'0');
 const antes=c.redis.comandos;
 await c.sinal('pv',vid(2));await c.sinal('hb',vid(3));
 assert.equal(c.redis.comandos,antes);
 assert.equal((await c.ler()).corpo.disponivel,false);
});

test('Redis indisponível: leitura "indisponível", sinais param e não insistem por 1 minuto',async()=>{
 const c=cenario();
 c.redis.falhar=true;
 const l=await c.ler();
 assert.deepEqual(l.corpo,{ok:true,disponivel:false,motivo:'servico-indisponivel'});
 const r=await c.sinal('pv',vid(1));
 assert.equal(r.statusCode,204);assert.equal(r.headers['x-audiencia-coleta'],'0');
 const http=c.http;
 for(let i=0;i<20;i++)await c.sinal('pv',vid(10+i),{n:i});
 assert.equal(c.http,http,'disjuntor evita martelar o Redis fora do ar');
});

test('amostragem decidida no servidor: fora da amostra não grava e recebe ordem de parar',async()=>{
 const c=cenario();
 c.redis.run(['SET','aud:passo','1']); // fração 0,2
 const dentro=vidCom(f=>f<0.2),fora=vidCom(f=>f>=0.2);
 const rf=await c.sinal('pv',fora,{passo:0,n:1});
 assert.equal(rf.headers['x-audiencia-coleta'],'0');
 await c.sinal('pv',dentro,{passo:1,n:2});
 const r=await c.ler();
 assert.equal(r.corpo.online,5,'participante com fração 0,2 representa 5 navegadores');assert.equal(r.corpo.estimativa,true);
});

test('pico de chegadas: teto global por minuto e fração reduzida rapidamente',async()=>{
 const c=cenario({AUDIENCIA_MAX_POR_MIN:'30',AUDIENCIA_ALVO_POR_MIN:'20'});
 for(let i=0;i<80;i++)await c.sinal('pv',vid(1000+i*7),{n:i});
 const mes=A.mesBR(Date.parse('2026-10-25T20:00:00-03:00'));
 const r=await c.ler();
 assert.ok(r.corpo.online<=30,'no máximo 30 gravações no minuto: '+r.corpo.online);
 assert.ok(r.corpo.passo>0,'fração cai após o pico');
 assert.ok(Number(c.redis.get('aud:cmd:'+mes))<80*20,'rejeições custam pouco');
});

test('muitos acessos simulados: 5.000 simultâneos chegando em 2 min respeitam o orçamento',async()=>{
 const r=await simular({simultaneos:5000,minutos:30,chegadaInicialS:120});
 assert.ok(r.comandosRedis<A.configuracao({}).maxComandosDia,'abaixo do orçamento diário');
 assert.ok(r.invocacoes<6000,'execuções: '+r.invocacoes);
 assert.ok(Math.abs(r.onlineEstimado-5000)/5000<0.25,'estimativa razoável: '+r.onlineEstimado);
});

test('após o limite: custo residual pequeno e limitado (conferência a cada 5 min por instância)',async()=>{
 const r=await simular({simultaneos:3000,minutos:120,chegadaInicialS:60,env:{AUDIENCIA_MAX_COMANDOS_DIA:'20000'}});
 assert.equal(r.coletaAoFinal,false,'coleta fechada');assert.equal(r.onlineEstimado,undefined,'leitura indisponível, sem números');
 assert.ok(r.comandosRedis<=20000+150,'excesso sobre o orçamento: '+(r.comandosRedis-20000));
});

test('limite por IP, bots, origem errada e corpo inválido',async()=>{
 const c=cenario({AUDIENCIA_MAX_POR_IP_MIN:'3'});
 for(let i=1;i<=6;i++)await c.sinal('pv',vid(i*11),{n:9});
 assert.equal((await c.ler()).corpo.online,3);
 await c.sinal('pv',vid(500),{ua:'Googlebot/2.1',n:50});
 await c.sinal('pv',vid(501),{origin:'https://site-falso.example',n:51});
 await c.sinal('pv',vid(502),{site:'cross-site',n:52});
 await c.sinal('pv','curto',{n:53});
 await c.sinal('xx',vid(503),{n:54});
 assert.equal((await c.ler()).corpo.online,3);
});

test('privacidade: IP bruto nunca é gravado',async()=>{
 const c=cenario();
 await c.sinal('pv',vid(1),{n:77});
 const chaves=[...c.redis.kv.keys()].join(' ');
 assert.doesNotMatch(chaves,/200\.1\.0\.77/);assert.match(chaves,/aud:ip:[0-9a-f]{20}:/);
});

test('mesmo hash de amostragem no navegador e no servidor',()=>{
 const cliente=fs.readFileSync(path.join(__dirname,'..','audiencia.js'),'utf8');
 assert.match(cliente,/const PASSOS = \[1, 0\.2, 0\.05, 0\.01\];/);assert.deepEqual(A.PASSOS,[1,0.2,0.05,0.01]);
 assert.match(cliente,/h \^= vid\.charCodeAt\(i\); h = Math\.imul\(h, 16777619\) >>> 0;/);
});

test('páginas públicas carregam o contador; OBS não; apuração independente; nenhum segredo no navegador',()=>{
 const ler=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
 for(const f of ['index.html','atlas.html','ao-vivo.html'])assert.match(ler(f),/<script src="audiencia\.js" defer><\/script>/,f);
 assert.doesNotMatch(ler('transmissao.html'),/audiencia\.js/);
 const cliente=ler('audiencia.js');
 assert.doesNotMatch(cliente,/UPSTASH|KV_REST|token|Bearer/i);assert.match(cliente,/Estatísticas indisponíveis/);
 assert.match(cliente,/X-Audiencia-Coleta/);
 assert.doesNotMatch(ler('api/apuracao.js')+ler('api/mapa.js')+ler('lib/tse.js'),/audiencia/);
});
