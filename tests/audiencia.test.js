'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const handler=require('../api/audiencia');
const A=require('../lib/audiencia');

// Redis simulado no protocolo REST de pipeline do Upstash, com relógio controlado.
class RedisFalso{
 constructor(relogio){this.relogio=relogio;this.kv=new Map();this.exp=new Map();this.comandos=0;this.falhar=false}
 vivo(k){const e=this.exp.get(k);if(e!==undefined&&e<=this.relogio()){this.kv.delete(k);this.exp.delete(k)}return this.kv.has(k)}
 get(k){return this.vivo(k)?this.kv.get(k):undefined}
 run([cmd,k,...a]){
  this.comandos++;
  switch(cmd){
   case 'GET':{const v=this.get(k);return v===undefined?null:String(v)}
   case 'SET':{if(a.includes('NX')&&this.vivo(k))return null;this.kv.set(k,String(a[0]));const i=a.indexOf('EX');if(i>=0)this.exp.set(k,this.relogio()+Number(a[i+1])*1000);else this.exp.delete(k);return 'OK'}
   case 'INCR':case 'INCRBY':{const v=Number(this.get(k)||0)+(cmd==='INCR'?1:Number(a[0]));this.kv.set(k,String(v));return v}
   case 'INCRBYFLOAT':{const v=Number(this.get(k)||0)+Number(a[0]);this.kv.set(k,String(v));return String(v)}
   case 'EXPIRE':{if(!this.vivo(k))return 0;this.exp.set(k,this.relogio()+Number(a[0])*1000);return 1}
   case 'ZADD':{const z=this.get(k)||new Map();z.set(a[1],Number(a[0]));this.kv.set(k,z);return 1}
   case 'ZREMRANGEBYSCORE':{const z=this.get(k);if(!z)return 0;let n=0;for(const [m,s] of z)if(s>=Number(a[0])&&s<=Number(a[1])){z.delete(m);n++}return n}
   case 'ZCARD':{const z=this.get(k);return z?z.size:0}
   case 'PFADD':{const s=this.get(k)||new Set();const antes=s.size;s.add(a[0]);this.kv.set(k,s);return s.size>antes?1:0}
   case 'PFCOUNT':{const s=this.get(k);return s?s.size:0}
   default:throw new Error('comando não simulado: '+cmd);
  }
 }
}
function ambiente(extra={}){return{AUDIENCIA_ATIVA:'1',UPSTASH_REDIS_REST_URL:'https://simulado.upstash.io',UPSTASH_REDIS_REST_TOKEN:'token-de-teste',AUDIENCIA_SEGREDO:'segredo-de-teste',...extra}}
function cenario(extra){
 let agora=Date.parse('2026-10-25T20:00:00-03:00');
 const relogio=()=>agora;const redis=new RedisFalso(relogio);const chamadas=[];
 global.fetch=async(url,opts)=>{
  chamadas.push(url);
  if(redis.falhar)throw new Error('rede');
  assert.equal(url,'https://simulado.upstash.io/pipeline');assert.equal(opts.headers.Authorization,'Bearer token-de-teste');
  const r=JSON.parse(opts.body).map(c=>redis.run(c));
  return {ok:true,status:200,json:async()=>r.map(result=>({result}))};
 };
 handler.redefinir();
 const env=ambiente(extra);
 const resp=()=>({statusCode:0,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},end(t){this.corpo=t?JSON.parse(t):undefined}});
 const ip=n=>`200.1.2.${n}`;
 return {
  redis,chamadas,
  avancar(ms){agora+=ms},
  async sinal(tipo,vid,{passo=0,n=1,ua='Mozilla/5.0 (Windows NT 10.0) Chrome/130',origin='https://atlasdaselei-es.vercel.app',site='same-origin'}={}){
   const r=resp();await handler({method:'POST',headers:{host:'atlasdaselei-es.vercel.app',origin,'sec-fetch-site':site,'user-agent':ua,'x-forwarded-for':ip(n)},body:{tipo,vid,passo}},r,env,relogio);return r;
  },
  async ler(){agora+=31000;const r=resp();await handler({method:'GET',headers:{}},r,env,relogio);return r},
 };
}
const vid=i=>'visitante-anonimo-'+String(i).padStart(4,'0');

test('desligado por padrão: não toca no armazenamento e não mostra números',async()=>{
 const chamadas=[];global.fetch=async u=>{chamadas.push(u);throw new Error('não deveria chamar')};
 handler.redefinir();
 const r={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},end(t){this.corpo=t?JSON.parse(t):undefined}};
 await handler({method:'GET',headers:{}},r,{});
 assert.deepEqual(r.corpo,{ok:true,disponivel:false,motivo:'desativado'});assert.equal(chamadas.length,0);
 const p={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},end(){}};
 await handler({method:'POST',headers:{},body:{tipo:'pv',vid:vid(1),passo:0}},p,{AUDIENCIA_ATIVA:'1'});
 assert.equal(p.statusCode,204);assert.equal(chamadas.length,0,'sem credenciais continua desligado');
});

test('uma pessoa acessando: online, visitante, visualização e cache da leitura',async()=>{
 const c=cenario();
 assert.equal((await c.sinal('pv',vid(1))).statusCode,204);
 const r=await c.ler();
 assert.equal(r.corpo.disponivel,true);assert.equal(r.corpo.online,1);assert.equal(r.corpo.unicosHoje,1);assert.equal(r.corpo.visualizacoesHoje,1);
 assert.equal(r.corpo.picoHoje,1);assert.equal(r.corpo.estimativa,false);assert.equal(r.corpo.coleta,true);
 assert.match(r.headers['cache-control'],/s-maxage=30/);
});

test('várias pessoas simultâneas e pico de simultâneos',async()=>{
 const c=cenario();
 for(let i=1;i<=5;i++)await c.sinal('pv',vid(i),{n:i});
 assert.equal((await c.ler()).corpo.online,5);
 c.avancar(8*60000); // os cinco saem; dois voltam a sinalizar
 for(let i=1;i<=2;i++)await c.sinal('hb',vid(i),{n:i});
 const r=await c.ler();
 assert.equal(r.corpo.online,2);assert.equal(r.corpo.picoHoje,5,'pico mantém o máximo registrado');
});

test('mesma pessoa com várias abas: conta uma vez online e um visitante',async()=>{
 const c=cenario();
 await c.sinal('pv',vid(7));await c.sinal('pv',vid(7));await c.sinal('pv',vid(7));
 await c.sinal('hb',vid(7));await c.sinal('hb',vid(7)); // segunda aba no mesmo minuto é descartada
 const r=await c.ler();
 assert.equal(r.corpo.online,1);assert.equal(r.corpo.unicosHoje,1);
 assert.equal(r.corpo.visualizacoesHoje,3,'cada carregamento de página é uma visualização');
 assert.equal(r.corpo.tempoHorasHoje,0.1,'só um sinal de presença conta tempo (180 s)');
});

test('visitante saindo deixa de contar após a janela; reentrada não duplica o visitante',async()=>{
 const c=cenario();
 await c.sinal('pv',vid(3));
 c.avancar(6*60000);assert.equal((await c.ler()).corpo.online,1,'ainda dentro da janela de 7 min');
 c.avancar(2*60000);assert.equal((await c.ler()).corpo.online,0,'saiu');
 await c.sinal('pv',vid(3));
 const r=await c.ler();
 assert.equal(r.corpo.online,1);assert.equal(r.corpo.unicosHoje,1);
});

test('falha do serviço: leitura indisponível, sem zeros; sinal não quebra a página',async()=>{
 const c=cenario();
 c.redis.falhar=true;
 const r=await c.ler();
 assert.deepEqual(r.corpo,{ok:true,disponivel:false,motivo:'servico-indisponivel'});
 assert.equal('online' in r.corpo,false);
 assert.equal((await c.sinal('pv',vid(1))).statusCode,204);
});

test('limite por IP, excesso de visualizações e bots',async()=>{
 const c=cenario({AUDIENCIA_MAX_POR_IP_MIN:'3'});
 for(let i=1;i<=6;i++)await c.sinal('pv',vid(i),{n:9});
 assert.equal((await c.ler()).corpo.online,3,'somente 3 sinais por minuto do mesmo IP');
 await c.sinal('pv',vid(50),{ua:'Googlebot/2.1',n:50});
 await c.sinal('pv',vid(51),{origin:'https://site-falso.example',n:51});
 await c.sinal('pv',vid(52),{site:'cross-site',n:52});
 await c.sinal('pv','curto',{n:53});
 assert.equal((await c.ler()).corpo.online,3,'bots, outra origem e identificador inválido ignorados');
});

test('orçamento diário esgotado ou chave de desligamento: coleta para sem derrubar o site',async()=>{
 const c=cenario({AUDIENCIA_MAX_ESCRITAS_DIA:'2'});
 await c.sinal('pv',vid(1),{n:1});await c.sinal('pv',vid(2),{n:2});await c.sinal('pv',vid(3),{n:3});
 let r=await c.ler();
 assert.equal(r.corpo.online,2);assert.equal(r.corpo.coleta,false);assert.equal(r.corpo.disponivel,true);
 const d=cenario();
 d.redis.run(['SET','aud:desligado','1']);
 await d.sinal('pv',vid(1));
 r=await d.ler();
 assert.equal(r.corpo.coleta,false);assert.equal(r.corpo.online,0);
});

test('orçamento mensal de comandos protege a cota gratuita do Upstash',async()=>{
 const c=cenario({AUDIENCIA_MAX_COMANDOS_MES:'60'});
 for(let i=1;i<=10;i++)await c.sinal('pv',vid(i),{n:i});
 const r=await c.ler();
 assert.ok(r.corpo.online<10,'para de gravar ao atingir o orçamento');assert.equal(r.corpo.coleta,false);
});

test('amostragem: com muita gente online a fração cai e os números viram estimativa',async()=>{
 const c=cenario({AUDIENCIA_ALVO_POR_MIN:'10'});
 for(let i=1;i<=60;i++)await c.sinal('pv',vid(i),{n:i});
 let r=await c.ler();
 assert.equal(r.corpo.online,60);assert.ok(r.corpo.passo>0,'fração reduzida');assert.equal(r.corpo.estimativa,true);
 // Participante amostrado com fração 0,25 vale 4 navegadores.
 const d=cenario();
 await d.sinal('pv',vid(1),{passo:1});
 r=await d.ler();
 assert.equal(r.corpo.online,4);assert.equal(r.corpo.unicosHoje,4);assert.equal(r.corpo.visualizacoesHoje,4);assert.equal(r.corpo.estimativa,true);
});

test('privacidade: IP bruto nunca é gravado',async()=>{
 const c=cenario();
 await c.sinal('pv',vid(1),{n:77});
 const chaves=[...c.redis.kv.keys()].join(' ');
 assert.doesNotMatch(chaves,/200\.1\.2\.77/);
 assert.match(chaves,/aud:ip:[0-9a-f]{20}:/);
});

test('métodos não permitidos e corpo inválido',async()=>{
 const c=cenario();
 const r={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},end(t){this.corpo=t?JSON.parse(t):undefined}};
 await handler({method:'DELETE',headers:{}},r,ambiente());
 assert.equal(r.statusCode,405);
 assert.equal((await c.sinal('xx',vid(1))).statusCode,204);
 assert.equal((await c.ler()).corpo.online,0);
});

test('páginas públicas carregam o contador; transmissão do OBS não; nenhum segredo no navegador',()=>{
 const ler=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
 for(const f of ['index.html','atlas.html','ao-vivo.html'])assert.match(ler(f),/<script src="audiencia\.js" defer><\/script>/,f);
 assert.doesNotMatch(ler('transmissao.html'),/audiencia\.js/);
 const cliente=ler('audiencia.js');
 assert.doesNotMatch(cliente,/UPSTASH|KV_REST|token|Bearer/i);
 assert.match(cliente,/Estatísticas indisponíveis/);
 assert.doesNotMatch(ler('api/apuracao.js')+ler('api/mapa.js')+ler('lib/tse.js'),/audiencia/,'apuração não depende da audiência');
});
