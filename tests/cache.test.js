'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../lib/tse');
const {readTSE,readOfficial,reply,START}=core;
const apuracao=require('../api/apuracao');
const mapa=require('../api/mapa');
test.beforeEach(()=>core.resetForTests());

function fixture(uf='SP'){
  return {
    ele:'6258',t:'2',cdabr:uf.toLowerCase(),and:'n',tf:'n',
    dg:'25/10/2026',hg:'17:30:00',
    s:{ts:'1200',st:'100'},
    v:{tv:'1000',vv:'920',vb:'30',tvn:'50'},
    carg:[{cd:'1',agr:[
      {par:[{sg:'PARTIDO A',cand:[{n:'13',nmu:'Candidato A',vap:'520',pvap:'56,52',e:'n'}]}]},
      {par:[{sg:'PARTIDO B',cand:[{n:'22',nmu:'Candidato B',vap:'400',pvap:'43,48',e:'n'}]}]}
    ]}]
  };
}
function mockResponse(){
 const headers={};
 return {
   statusCode:200,headers,
   setHeader(key,value){headers[key.toLowerCase()]=value},
   end(text){this.body=text?JSON.parse(text):undefined}
 };
}

test('GET de sucesso usa cache compartilhado da Vercel e fallback stale-if-error',()=>{
 const response=mockResponse();
 reply(response,200,{ok:true},20);
 assert.equal(response.statusCode,200);
 assert.match(response.headers['cache-control'],/s-maxage=20/);
 assert.match(response.headers['cache-control'],/stale-while-revalidate=/);
 assert.match(response.headers['cache-control'],/stale-if-error=300/);
 assert.match(response.headers['cache-control'],/max-age=0/);
 assert.equal(response.body.ok,true);
});
test('respostas de erro não são armazenadas',()=>{
 const response=mockResponse();
 reply(response,503,{ok:false,error:'Fonte indisponível'});
 assert.equal(response.headers['cache-control'],'no-store');
});
test('vinte consultas simultâneas à mesma UF usam só uma chamada por instância',async()=>{
 const previous=global.fetch;
 let total=0;
 global.fetch=async()=>{total++;await new Promise(resolve=>setTimeout(resolve,8));return {ok:true,json:async()=>fixture('SP')}};
 try{
   const results=await Promise.all(Array.from({length:20},()=>readTSE('presidente','SP')));
   assert.equal(total,1);
   assert.equal(results.length,20);
   assert.ok(results.every(result=>result.votes.valid===920));
 }finally{global.fetch=previous}
});
test('resposta 404 coloca somente a URL faltante em espera',async()=>{
 const previous=global.fetch;
 let total=0;
 global.fetch=async url=>{
  total++;
  if(url.includes('/dados/mg/'))return {ok:false,status:404};
  return {ok:true,json:async()=>fixture('BA')};
 };
 try{
   await assert.rejects(readTSE('presidente','MG'),/404/);
   await assert.rejects(readTSE('presidente','MG'),/espera após 404/);
   assert.equal(total,1);
   const ba=await readTSE('presidente','BA');
   assert.equal(ba.uf,'BA');
   assert.equal(total,2);
 }finally{global.fetch=previous}
});
test('HTTP 429 interrompe novas consultas externas na instância',async()=>{
 const previous=global.fetch;
 let total=0;
 global.fetch=async()=>{total++;return {ok:false,status:429}};
 try{
   await assert.rejects(readTSE('presidente','RJ'),/429/);
   await assert.rejects(readTSE('presidente','ES'),/limitado/);
   assert.equal(total,1);
 }finally{global.fetch=previous}
});

// Relógio controlado: os testes abaixo nunca chamam o TSE real.
function withClock(start,fn){
 const prevNow=Date.now,prevFetch=global.fetch;let now=Date.parse(start);
 Date.now=()=>now;
 const clock={advance(ms){now+=ms}};
 return Promise.resolve().then(()=>fn(clock)).finally(()=>{Date.now=prevNow;global.fetch=prevFetch});
}
const ok=(uf='BR')=>({ok:true,headers:{get:()=>null},json:async()=>fixture(uf)});
const fail=(status,retry=null)=>({ok:false,status,headers:{get:k=>k==='retry-after'?retry:null}});
test('instância reaproveita o arquivo válido por 12s durante a apuração',()=>withClock('2026-10-25T19:00:00-03:00',async clock=>{
 let total=0;global.fetch=async()=>{total++;return ok()};
 await readTSE('presidente','BR');clock.advance(5000);await readTSE('presidente','BR');
 assert.equal(total,1);
 clock.advance(8000);await readTSE('presidente','BR');
 assert.equal(total,2);
}));
test('falha do TSE devolve o último arquivo autêntico marcado como desatualizado',()=>withClock('2026-10-25T19:00:00-03:00',async clock=>{
 let total=0,mode='ok';global.fetch=async()=>{total++;return mode==='ok'?ok():fail(503)};
 const first=await readOfficial('presidente','BR');
 assert.equal(first.stale,undefined);
 mode='erro';clock.advance(20000);
 const stale=await readOfficial('presidente','BR');
 assert.equal(stale.stale,true);assert.equal(stale.votes.valid,920);assert.equal(stale.fetchedAt,first.fetchedAt);
 assert.match(stale.staleReason,/último arquivo válido/);
 await readOfficial('presidente','BR');
 assert.equal(total,2,'espera de 15s após 5xx evita nova consulta');
 clock.advance(31*60*1000);
 await assert.rejects(readOfficial('presidente','BR'),/503/);
}));
test('sem arquivo anterior, erro do TSE não vira resultado',()=>withClock('2026-10-25T19:00:00-03:00',async()=>{
 global.fetch=async()=>{throw Object.assign(new Error('timeout'),{name:'TimeoutError'})};
 await assert.rejects(readOfficial('presidente','SP'),/timeout/);
 const r=mockResponse();await apuracao({method:'GET',url:'/api/apuracao?cargo=presidente&uf=SP',query:{cargo:'presidente',uf:'SP'}},r);
 assert.equal(r.statusCode,503);assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.body.ok,false);
}));
test('JSON inválido do TSE é tratado como falha, com espera curta',()=>withClock('2026-10-25T19:00:00-03:00',async clock=>{
 let total=0;global.fetch=async()=>{total++;return {ok:true,headers:{get:()=>null},json:async()=>{throw new SyntaxError('HTML de manutenção')}}};
 await assert.rejects(readTSE('presidente','BA'),/manutenção/);
 await assert.rejects(readTSE('presidente','BA'),/espera/);
 assert.equal(total,1);
 clock.advance(16000);await assert.rejects(readTSE('presidente','BA'),/manutenção/);
 assert.equal(total,2);
}));
test('HTTP 429 respeita Retry-After e volta a consultar depois',()=>withClock('2026-10-25T19:00:00-03:00',async clock=>{
 let total=0,mode='429';global.fetch=async()=>{total++;return mode==='429'?fail(429,'60'):ok('PE')};
 await assert.rejects(readTSE('presidente','PE'),/429/);
 clock.advance(59000);await assert.rejects(readTSE('presidente','PE'),/limitado/);
 assert.equal(total,1);
 mode='ok';clock.advance(2000);
 assert.equal((await readTSE('presidente','PE')).uf,'PE');
 assert.equal(total,2);
}));
test('HTTP 429 sem Retry-After aumenta a espera progressivamente',()=>withClock('2026-10-25T19:00:00-03:00',async clock=>{
 let total=0;global.fetch=async()=>{total++;return fail(429)};
 await assert.rejects(readTSE('presidente','RS'),/429/);
 clock.advance(2*60*1000+1);await assert.rejects(readTSE('presidente','RS'),/429/);
 clock.advance(2*60*1000+1);await assert.rejects(readTSE('presidente','RS'),/limitado/);
 assert.equal(total,2);
}));
test('variações de query string redirecionam para a chave canônica sem consultar o TSE',()=>withClock('2026-10-25T19:00:00-03:00',async()=>{
 let total=0;global.fetch=async()=>{total++;return ok()};
 for(const url of ['/api/apuracao?uf=BR&cargo=presidente','/api/apuracao?cargo=presidente&uf=BR&x=1','/api/apuracao?cargo=presidente&uf=br','/api/apuracao']){
  const u=new URL(url,'http://x'),r=mockResponse();
  await apuracao({method:'GET',url,query:Object.fromEntries(u.searchParams)},r);
  assert.equal(r.statusCode,308,url);assert.equal(r.headers.location,'/api/apuracao?cargo=presidente&uf=BR');
 }
 const m=mockResponse();await mapa({method:'GET',url:'/api/mapa?t=123',query:{t:'123'}},m);
 assert.equal(m.statusCode,308);assert.equal(m.headers.location,'/api/mapa');
 assert.equal(total,0);
 const r=mockResponse();await apuracao({method:'GET',url:'/api/apuracao?cargo=presidente&uf=BR',query:{cargo:'presidente',uf:'BR'}},r);
 assert.equal(r.statusCode,200);assert.equal(total,1);
}));
test('cache anterior ao início não atravessa o horário de divulgação',()=>withClock(new Date(START-45000).toISOString(),async()=>{
 global.fetch=async()=>ok();
 const r=mockResponse();await apuracao({method:'GET',query:{cargo:'presidente',uf:'BR'}},r);
 assert.match(r.headers['cache-control'],/s-maxage=45,/);
 const g=mockResponse();await apuracao({method:'GET',query:{cargo:'governador',uf:'AC'}},g);
 assert.match(g.headers['cache-control'],/s-maxage=45,/);
}));
test('resposta desatualizada tem cache curto e identificação',()=>withClock('2026-10-25T19:00:00-03:00',async clock=>{
 let mode='ok';global.fetch=async()=>mode==='ok'?ok():fail(502);
 await readTSE('presidente','BR');mode='erro';clock.advance(13000);
 const r=mockResponse();await apuracao({method:'GET',query:{cargo:'presidente',uf:'BR'}},r);
 assert.equal(r.statusCode,200);assert.equal(r.body.stale,true);assert.match(r.headers['cache-control'],/s-maxage=10,/);
}));
test('mapa respeita prazo total e devolve estados parciais identificados',()=>withClock('2026-10-25T19:00:00-03:00',async clock=>{
 let calls=0;
 global.fetch=async u=>{calls++;clock.advance(3000);const uf=(u.match(/\/dados\/([a-z]{2})\//)||[])[1]?.toUpperCase();return ok(uf)};
 const r=mockResponse();await mapa({method:'GET',query:{}},r);
 assert.equal(r.statusCode,200);
 assert.ok(r.body.states.length<27&&r.body.states.length>0);
 assert.equal(r.body.errors,27-r.body.states.length);
 assert.match(r.headers['cache-control'],/s-maxage=20,/);
 assert.ok(calls<28);
}));
