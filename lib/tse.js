'use strict';
const UF=['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const GOV_2T=['AC','AM','DF','ES','RN','TO'];
const START=Date.parse('2026-10-25T17:00:00-03:00');
const ROOT='https://resultados.tse.jus.br/oficial/ele2026';
function num(x){if(typeof x==='number')return Number.isFinite(x)?x:0;return Number(String(x??'0').replace(/\./g,'').replace(',','.'))||0}
function pct(x){return Number(String(x??'0').replace(',','.'))||0}
function validate(cargo,rawUF){const uf=String(rawUF||'BR').toUpperCase();if(!['presidente','governador'].includes(cargo))throw Object.assign(new Error('Cargo inválido.'),{status:400});if(!['BR',...UF].includes(uf))throw Object.assign(new Error('UF inválida.'),{status:400});if(cargo==='governador'&&!GOV_2T.includes(uf))throw Object.assign(new Error('Não há 2º turno para governador nesta unidade da federação.'),{status:400});return {cargo,uf}}
function urlFor(cargo,uf){validate(cargo,uf);const id=cargo==='presidente'?'6258':'6260';const office=cargo==='presidente'?'0001':'0003';const c=uf.toLowerCase();return ROOT+'/'+id+'/dados/'+c+'/'+c+'-c'+office+'-e'+id.padStart(6,'0')+'-u.json'}
function stamp(d,h){if(!/^\d\d\/\d\d\/\d{4}$/.test(String(d))||!/^\d\d:\d\d:\d\d$/.test(String(h)))return null;const [day,m,y]=d.split('/');return y+'-'+m+'-'+day+'T'+h+'-03:00'}
function normalize(j,cargo,uf,url){const id=cargo==='presidente'?'6258':'6260',code=cargo==='presidente'?'1':'3';
if(!j||String(j.ele)!==id||String(j.t)!=='2'||String(j.cdabr).toUpperCase()!==uf)throw Object.assign(new Error('Arquivo não corresponde ao pleito solicitado.'),{status:502});
if(!j.s||!j.v||!Array.isArray(j.carg))throw Object.assign(new Error('Estrutura EA20 incompleta.'),{status:502});
const gr=j.carg.filter(x=>String(x.cd)===code);if(gr.length!==1)throw Object.assign(new Error('Cargo não encontrado.'),{status:502});
const candidates=[];for(const a of gr[0].agr||[])for(const p of a.par||[])for(const c of p.cand||[])candidates.push({number:String(c.n||''),name:String(c.nmu||c.nm||'Candidato'),party:String(p.sg||'—'),votes:Math.max(0,Math.round(num(c.vap))),percentage:Math.max(0,Math.min(100,pct(c.pvap))),elected:String(c.e).toLowerCase()==='s',status:String(c.st||'')});
candidates.sort((a,b)=>b.votes-a.votes||Number(a.number)-Number(b.number));const total=num(j.s?.ts),counted=num(j.s?.st);
const hasVotes=candidates.some(c=>c.votes>0)||num(j.v.tv)>0||counted>0,complete=String(j.and||'').toLowerCase()==='f'||String(j.tf||'').toLowerCase()==='s';
return {ok:true,source:'TSE',election:'2026-2',office:cargo,uf,publishedAt:stamp(j.dg,j.hg),fetchedAt:new Date().toISOString(),stage:complete?'final':hasVotes?'counting':'waiting',sections:{counted,total,percentage:total?Math.round(counted/total*10000)/100:0},votes:{total:num(j.v?.tv),valid:num(j.v.vv),blank:num(j.v?.vb),null:num(j.v.tvn)},candidates,sourceUrl:url,idg:String(j.idg||'')}}
async function readTSE(cargo,uf){const url=urlFor(cargo,uf);const res=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(6200)});if(!res.ok)throw Object.assign(new Error('TSE respondeu '+res.status),{status:502});return normalize(await res.json(),cargo,uf,url)}
function awaiting(cargo,uf){return {ok:true,source:'TSE',election:'2026-2',office:cargo,uf,stage:'scheduled',publishedAt:null,fetchedAt:new Date().toISOString(),sections:{counted:0,total:0,percentage:0},votes:{total:0,valid:0,blank:0,null:0},candidates:[],sourceUrl:urlFor(cargo,uf),idg:''}}
function reply(res,status,obj,sec=0){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control',sec?'public, s-maxage='+sec+', stale-while-revalidate=30':'no-store');res.end(JSON.stringify(obj))}
module.exports={UF,GOV_2T,START,validate,urlFor,readTSE,normalize,awaiting,reply};
