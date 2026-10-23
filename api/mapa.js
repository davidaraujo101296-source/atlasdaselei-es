'use strict';
const {UF,START,readOfficial,canonical,reply}=require('../lib/tse');
// Orçamento da função (maxDuration=30s em vercel.json), contado desde o início da
// requisição e válido para a consulta nacional e as estaduais. Cada leitura do TSE tem
// timeout próprio de 6,2s, mas a resposta nunca espera além do prazo: uma leitura ainda
// pendente segue em segundo plano e apenas abastece a memória da instância.
// 22s + serialização (milissegundos) deixam ~8s de margem, inclusive para início a frio.
const LIMITS={totalMs:22000,minStartMs:2500};
const budgetError=()=>Object.assign(new Error('Prazo da função esgotado.'),{name:'BudgetExceeded'});
function beforeDeadline(promise,deadline){
 const left=deadline-Date.now();
 if(left<=0)return Promise.reject(budgetError());
 let timer;
 return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(budgetError()),left)})]).finally(()=>clearTimeout(timer));
}
async function handler(req,res){
 const deadline=Date.now()+LIMITS.totalMs;
 if(req.method!=='GET')return reply(res,405,{ok:false,error:'Método não permitido.'});
 if(canonical(req,res,''))return;
 if(Date.now()<START)return reply(res,200,{ok:true,source:'TSE',stage:'scheduled',states:[],fetchedAt:new Date().toISOString(),errors:0},100);
 let nat;
 try{nat=await beforeDeadline(readOfficial('presidente','BR'),deadline)}
 catch(e){return reply(res,503,{ok:false,error:'Totalização nacional indisponível; aguardando o TSE.'})}
 if(nat.stage==='waiting')return reply(res,200,{ok:true,source:'TSE',stage:'waiting',states:[],fetchedAt:new Date().toISOString(),errors:0,...(nat.stale?{stale:true}:{})},nat.stale?10:30);
 const byUF=new Map();let index=0;
 async function worker(){
  // Só inicia consulta estadual se ainda houver tempo útil antes do prazo.
  while(index<UF.length&&deadline-Date.now()>=LIMITS.minStartMs){
   const uf=UF[index++];
   try{const d=await beforeDeadline(readOfficial('presidente',uf),deadline);byUF.set(uf,{uf,stage:d.stage,sections:d.sections,candidates:d.candidates.slice(0,4),publishedAt:d.publishedAt,...(d.stale?{stale:true}:{})})}catch(e){}
  }
 }
 await Promise.all([worker(),worker(),worker(),worker()]);
 const states=UF.filter(uf=>byUF.has(uf)).map(uf=>byUF.get(uf)).sort((a,b)=>a.uf.localeCompare(b.uf));
 if(!states.length)return reply(res,503,{ok:false,error:'Não foi possível consultar resultados estaduais.'});
 // Estados sem resposta no prazo ficam identificados; nenhum dado é preenchido no lugar.
 const missing=UF.filter(uf=>!byUF.has(uf)),stale=nat.stale||states.some(s=>s.stale);
 return reply(res,200,{ok:true,source:'TSE',stage:nat.stage,states,fetchedAt:new Date().toISOString(),errors:missing.length,partial:missing.length>0,missing,...(stale?{stale:true}:{})},stale||missing.length?20:55);
}
module.exports=handler;
module.exports.LIMITS=LIMITS;
