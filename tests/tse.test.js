'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../lib/tse');
const race=require('../api/apuracao');
const mapa=require('../api/mapa');

// Contrato do EA20 de 2026: votos válidos = v.vv; votos nulos totais = v.tvn.
function sample({uf='BR',cargo='presidente',votes=0,counted=0}={}){
 const gov=cargo==='governador',id=gov?'6260':'6258';
 return {ele:id,t:'2',cdabr:uf.toLowerCase(),and:'n',tf:'n',dg:'15/10/2026',hg:'09:38:12',
  carg:[{cd:gov?'3':'1',agr:[
   {par:[{sg:'PT',cand:[{n:'13',nmu:'Candidato A',vap:String(votes),pvap:votes?'90,91':'0,00',e:'n'}]}]},
   {par:[{sg:'PL',cand:[{n:'22',nmu:'Candidato B',vap:String(votes?1000:0),pvap:votes?'9,09':'0,00',e:'n'}]}]}
  ]}],
  s:{ts:'499248',st:String(counted)},
  v:{tv:String(votes?votes+1140:0),vvc:String(votes?votes+1100:0),vv:String(votes?votes+1000:0),
    van:String(votes?100:0),vb:String(votes?10:0),tvn:String(votes?30:0),vn:String(votes?25:0),vnt:String(votes?5:0)}
 };
}
test.beforeEach(()=>core.resetForTests());
function response(){return{statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},end(x){this.data=JSON.parse(x)}}}
test('URLs oficiais do TSE para segundo turno',()=>{
 assert.equal(core.urlFor('presidente','BR'),'https://resultados.tse.jus.br/oficial/ele2026/6258/dados/br/br-c0001-e006258-u.json');
 assert.equal(core.urlFor('presidente','SP'),'https://resultados.tse.jus.br/oficial/ele2026/6258/dados/sp/sp-c0001-e006258-u.json');
 assert.equal(core.urlFor('governador','AC'),'https://resultados.tse.jus.br/oficial/ele2026/6260/dados/ac/ac-c0003-e006260-u.json');
});
test('Governadores somente onde haverá segundo turno',()=>{
 assert.deepEqual(core.GOV_2T,['AC','AM','DF','ES','RN','TO']);
 assert.throws(()=>core.validate('governador','RJ'),/Não há 2º turno/);
 assert.throws(()=>core.validate('presidente','ZZ'),/UF inválida/);
});
test('Pré-apuração não inventa votos e apresenta candidatos oficiais',()=>{
 const r=core.normalize(sample(),'presidente','BR','https://resultados.tse.jus.br/');
 assert.equal(r.stage,'waiting');assert.equal(r.candidates.length,2);
 assert.equal(r.candidates[0].votes,0);assert.equal(r.sections.counted,0);
 assert.equal(r.publishedAt,'2026-10-15T09:38:12-03:00');
});
test('EA20 distingue votos válidos dos votáveis e nulos totais',()=>{
 const r=core.normalize(sample({votes:10000,counted:250000}),'presidente','BR','source');
 assert.equal(r.stage,'counting');assert.equal(r.votes.valid,11000);
 assert.equal(r.votes.null,30);assert.equal(r.votes.blank,10);
 assert.equal(r.candidates[0].votes,10000);assert.equal(r.candidates[0].percentage,90.91);
 assert.equal(r.sections.counted,250000);assert.ok(r.sections.percentage>50);
});
test('Arquivo inválido ou incompleto é rejeitado, nunca transformado em votos zero',()=>{
 assert.throws(()=>core.normalize(sample(),'presidente','SP','source'),/não corresponde/);
 const s=sample();delete s.v;
 assert.throws(()=>core.normalize(s,'presidente','BR','source'),/EA20 incompleta/);
});
test('Seções totalizadas significam apuração em andamento mesmo sem votos válidos',()=>{
 assert.equal(core.normalize(sample({counted:3}),'presidente','BR','source').stage,'counting');
});
test('API valida parâmetros e recusa POST',async()=>{
 let r=response();await race({method:'GET',query:{cargo:'governador',uf:'RJ'}},r);
 assert.equal(r.statusCode,400);
 r=response();await mapa({method:'POST',query:{}},r);assert.equal(r.statusCode,405);
});
test('Antes da eleição não consulta arquivos estaduais e mapa do TSE',async()=>{
 const prev=Date.now,oldFetch=global.fetch;
 Date.now=()=>Date.parse('2026-10-23T10:00:00-03:00');
 global.fetch=async()=>{throw new Error('Consulta proibida antes da divulgação')};
 try{
  const r=response();await race({method:'GET',query:{cargo:'governador',uf:'AC'}},r);
  assert.equal(r.statusCode,200);assert.equal(r.data.stage,'scheduled');
  const m=response();await mapa({method:'GET',query:{}},m);
  assert.equal(m.statusCode,200);assert.deepEqual(m.data.states,[]);
 }finally{Date.now=prev;global.fetch=oldFetch}
});
test('Após início: API publica somente os votos fornecidos pelo TSE',async()=>{
 const prev=Date.now,oldFetch=global.fetch;let url;
 Date.now=()=>Date.parse('2026-10-25T19:00:00-03:00');
 global.fetch=async u=>{url=u;return {ok:true,json:async()=>sample({votes:10000,counted:250000})}};
 try{
  const r=response();await race({method:'GET',query:{cargo:'presidente',uf:'BR'}},r);
  assert.equal(r.statusCode,200);assert.equal(r.data.votes.valid,11000);
  assert.match(url,/e006258-u.json$/);assert.match(r.headers['Cache-Control'],/s-maxage=20/);
 }finally{Date.now=prev;global.fetch=oldFetch}
});
test('Mapa consulta 27 UFs após totalização começar, com fonte TSE',async()=>{
 const prev=Date.now,oldFetch=global.fetch;let calls=0;
 Date.now=()=>Date.parse('2026-10-25T19:00:00-03:00');
 global.fetch=async u=>{calls++;const uf=(u.match(/\/dados\/([a-z]{2})\//)||[])[1]?.toUpperCase()||'BR';return {ok:true,json:async()=>sample({uf,votes:10000,counted:250000})}};
 try{
  const r=response();await mapa({method:'GET',query:{}},r);
  assert.equal(r.statusCode,200);assert.equal(r.data.states.length,27);
  assert.equal(calls,28);assert.equal(new Set(r.data.states.map(s=>s.uf)).size,27);
 }finally{Date.now=prev;global.fetch=oldFetch}
});

test('EA20 sem campo vv não pode ser exibido como resultado válido',()=>{
 const data=sample({votes:5000});delete data.v.vv;
 assert.throws(()=>core.normalize(data,'presidente','BR','source'),/EA20 incompleta/);
});
