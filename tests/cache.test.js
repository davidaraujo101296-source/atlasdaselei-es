'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readTSE,reply}=require('../lib/tse');

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
   end(text){this.body=JSON.parse(text)}
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
