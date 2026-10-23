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
if(!j.s||!j.v||!Array.isArray(j.carg)||!['ts','st'].every(k=>j.s[k]!=null)||!['tv','vv','vb','tvn'].every(k=>j.v[k]!=null))throw Object.assign(new Error('Estrutura EA20 incompleta.'),{status:502});
const gr=j.carg.filter(x=>String(x.cd)===code);if(gr.length!==1)throw Object.assign(new Error('Cargo não encontrado.'),{status:502});
const candidates=[];for(const a of gr[0].agr||[])for(const p of a.par||[])for(const c of p.cand||[])candidates.push({number:String(c.n||''),name:String(c.nmu||c.nm||'Candidato'),party:String(p.sg||'—'),votes:Math.max(0,Math.round(num(c.vap))),percentage:Math.max(0,Math.min(100,pct(c.pvap))),elected:String(c.e).toLowerCase()==='s',status:String(c.st||'')});
candidates.sort((a,b)=>b.votes-a.votes||Number(a.number)-Number(b.number));const total=num(j.s?.ts),counted=num(j.s?.st);
const hasVotes=candidates.some(c=>c.votes>0)||num(j.v.tv)>0||counted>0,complete=String(j.and||'').toLowerCase()==='f'||String(j.tf||'').toLowerCase()==='s';
return {ok:true,source:'TSE',election:'2026-2',office:cargo,uf,publishedAt:stamp(j.dg,j.hg),fetchedAt:new Date().toISOString(),stage:complete?'final':hasVotes?'counting':'waiting',sections:{counted,total,percentage:total?Math.round(counted/total*10000)/100:0},votes:{total:num(j.v?.tv),valid:num(j.v.vv),blank:num(j.v?.vb),null:num(j.v.tvn)},candidates,sourceUrl:url,idg:String(j.idg||'')}}
// Cache principal: Vercel CDN, compartilhado entre visitantes. Os controles abaixo
// valem por instância Node (não são um cache distribuído): agrupam consultas
// simultâneas, guardam o último arquivo válido e aplicam espera após erros do TSE.
const inFlight=new Map();
const lastGood=new Map();
const backoff=new Map();
let rateLimitedUntil=0,rateLimitHits=0;
const STALE_LIMIT=30*60*1000;
const freshFor=()=>Date.now()<START?120*1000:12*1000;
function retryAfterMs(res){const h=res.headers?.get?.('retry-after');if(!h)return 0;const s=Number(h);if(Number.isFinite(s))return s*1000;const d=Date.parse(h);return Number.isFinite(d)?d-Date.now():0}
async function readTSE(cargo,uf){
 const url=urlFor(cargo,uf),now=Date.now(),memo=lastGood.get(url);
 if(memo&&now-memo.at<freshFor())return memo.data;
 if(now<rateLimitedUntil)throw Object.assign(new Error('TSE temporariamente limitado.'),{status:503,upstreamStatus:429});
 const wait=backoff.get(url);
 if(wait&&now<wait.until)throw Object.assign(new Error('Arquivo do TSE em espera após '+wait.status+'.'),{status:503,upstreamStatus:wait.status});
 if(inFlight.has(url))return inFlight.get(url);
 const start=Date.now();
 const pending=(async()=>{
  try{
   const res=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(6200)});
   if(!res.ok){
    if(res.status===429){rateLimitHits++;rateLimitedUntil=Date.now()+Math.min(15*60*1000,Math.max(30*1000,retryAfterMs(res)||2*60*1000*2**(rateLimitHits-1)))}
    throw Object.assign(new Error('TSE respondeu '+res.status),{status:502,upstreamStatus:res.status});
   }
   const data=normalize(await res.json(),cargo,uf,url);
   rateLimitHits=0;backoff.delete(url);lastGood.set(url,{data,at:Date.now()});
   console.info(JSON.stringify({event:'tse_fetch',cargo,uf,outcome:'ok',durationMs:Date.now()-start,stage:data.stage}));
   return data;
  }catch(error){
   // 404: arquivo ainda não publicado. 5xx, timeout, rede ou JSON inválido: espera curta.
   if(error.upstreamStatus!==429)backoff.set(url,{until:Date.now()+(error.upstreamStatus===404?90:15)*1000,status:error.upstreamStatus||error.name||'erro'});
   console.warn(JSON.stringify({event:'tse_fetch',cargo,uf,outcome:'error',upstreamStatus:error.upstreamStatus||null,durationMs:Date.now()-start,errorName:error.name||'Error'}));
   throw error;
  }
 })();
 inFlight.set(url,pending);
 try{return await pending}finally{inFlight.delete(url)}
}
// Em falha, só devolve o último arquivo autêntico do TSE, marcado como desatualizado.
async function readOfficial(cargo,uf){
 try{return await readTSE(cargo,uf)}catch(error){
  const memo=lastGood.get(urlFor(cargo,uf));
  if(memo&&Date.now()-memo.at<STALE_LIMIT)return {...memo.data,stale:true,staleReason:'Fonte oficial temporariamente indisponível; exibindo o último arquivo válido obtido do TSE.'};
  throw error;
 }
}
function resetForTests(){inFlight.clear();lastGood.clear();backoff.clear();rateLimitedUntil=0;rateLimitHits=0}
function awaiting(cargo,uf){return {ok:true,source:'TSE',election:'2026-2',office:cargo,uf,stage:'scheduled',publishedAt:null,fetchedAt:new Date().toISOString(),sections:{counted:0,total:0,percentage:0},votes:{total:0,valid:0,blank:0,null:0},candidates:[],sourceUrl:urlFor(cargo,uf),idg:''}}
// Antes do início, o cache não pode atravessar o horário de divulgação do TSE.
function ttl(sec){const left=Math.ceil((START-Date.now())/1000);return left>0?Math.max(1,Math.min(sec,left)):sec}
// Cada variação de query string seria outra chave no CDN e outra consulta ao TSE.
function canonical(req,res,search){
 if(!req.url)return false;
 const url=new URL(req.url,'http://localhost');
 if(url.search===search)return false;
 res.statusCode=308;res.setHeader('Location',url.pathname+search);res.setHeader('Cache-Control','public, max-age=3600, s-maxage=86400');res.end();
 return true;
}
function reply(res,status,obj,sec=0){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control',sec?'public, max-age=0, s-maxage='+sec+', stale-while-revalidate='+Math.max(90,sec*2)+', stale-if-error=300':'no-store');res.end(JSON.stringify(obj))}
module.exports={UF,GOV_2T,START,validate,urlFor,readTSE,readOfficial,normalize,awaiting,ttl,canonical,reply,resetForTests};
