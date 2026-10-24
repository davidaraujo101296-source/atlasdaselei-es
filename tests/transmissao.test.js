'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const C=require('../transmissao-core.js');

const raiz=path.join(__dirname,'..');
const ler=f=>fs.readFileSync(path.join(raiz,f),'utf8');
function foto({stage='counting',counted=0,a=0,b=0,publishedAt='2026-10-25T18:00:00-03:00',fetchedAt='2026-10-25T21:00:00Z',stale}={}){
 return {stage,sections:{counted,total:1000,percentage:counted/10},candidates:[{number:'13',votes:a,percentage:0},{number:'22',votes:b,percentage:0}],publishedAt,fetchedAt,...(stale?{stale:true}:{})};
}
const mapa=states=>({ok:true,states});
const comUF=(uf,o)=>({uf,...foto(o)});

test('fotografias: mesma divulgação com fetchedAt diferente não é novidade',()=>{
 assert.equal(C.compararFotografias(foto({counted:10,a:5}),foto({counted:10,a:5,fetchedAt:'2026-10-25T23:00:00Z'})),0);
});
test('fotografias: mais seções, mais votos ou arquivo posterior contam como mais recentes',()=>{
 assert.equal(C.compararFotografias(foto({counted:10}),foto({counted:11})),1);
 assert.equal(C.compararFotografias(foto({counted:10,a:5}),foto({counted:10,a:6})),1);
 assert.equal(C.compararFotografias(foto({counted:10,publishedAt:'2026-10-25T18:00:00-03:00'}),foto({counted:10,publishedAt:'2026-10-25T18:05:00-03:00'})),1);
});
test('fotografias: resposta fora de ordem ou de antes das 17h é mais antiga',()=>{
 assert.equal(C.compararFotografias(foto({counted:20}),foto({counted:15})),-1);
 assert.equal(C.compararFotografias(foto({counted:20}),foto({stage:'waiting'})),-1);
 assert.equal(C.compararFotografias(foto({stage:'final',counted:20}),foto({counted:20})),-1);
});

test('mapa: primeira leitura é linha de base, sem nova parcial',()=>{
 const r=C.incorporarMapa(new Map(),mapa([comUF('BA',{counted:10,a:5})]),1);
 assert.equal(r.novidades.length,0);assert.equal(r.estados.get('BA').dados.sections.counted,10);
});
test('mapa: avanço oficial vira nova parcial com o avanço de seções',()=>{
 const base=C.incorporarMapa(new Map(),mapa([comUF('BA',{counted:10,a:5})]),1).estados;
 const r=C.incorporarMapa(base,mapa([comUF('BA',{counted:35,a:20})]),2);
 assert.deepEqual(r.novidades.map(n=>[n.uf,n.deltaSecoes]),[['BA',2.5]]);
});
test('mapa: mesma divulgação, dado stale e resposta antiga não viram nova parcial',()=>{
 const base=C.incorporarMapa(new Map(),mapa([comUF('BA',{counted:30,a:5}),comUF('SP',{counted:30,a:5})]),1).estados;
 const r=C.incorporarMapa(base,mapa([comUF('BA',{counted:30,a:5,fetchedAt:'outro'}),comUF('SP',{counted:20,a:2})]),2);
 assert.equal(r.novidades.length,0);assert.equal(r.ignoradas,1);
 assert.equal(r.estados.get('SP').dados.sections.counted,30,'mantém a fotografia mais recente');
 const s=C.incorporarMapa(base,mapa([comUF('BA',{counted:40,a:9,stale:true})]),3);
 assert.equal(s.novidades.length,0);
});
test('mapa parcial: UFs ausentes ficam marcadas e mantêm os últimos dados',()=>{
 const base=C.incorporarMapa(new Map(),mapa([comUF('BA',{counted:30}),comUF('RS',{counted:12})]),1).estados;
 const r=C.incorporarMapa(base,mapa([comUF('BA',{counted:31})]),2);
 assert.equal(r.estados.get('RS').ausente,true);assert.equal(r.estados.get('RS').dados.sections.counted,12);
 assert.ok(r.ausentes.includes('RS'));assert.ok(!r.ausentes.includes('BA'));
});
test('mapa: dado restaurado após recarga não serve de base para nova parcial',()=>{
 const base=new Map([['BA',{dados:{uf:'BA',...foto({counted:10})},restaurado:true}]]);
 assert.equal(C.incorporarMapa(base,mapa([comUF('BA',{counted:50})]),1).novidades.length,0);
});

test('fase: aguarda até haver votos oficiais; final só com totalização final',()=>{
 assert.equal(C.fase(null),'pre');
 assert.equal(C.fase({ok:true,...foto({stage:'waiting'})}),'pre');
 assert.equal(C.fase({ok:true,...foto({stage:'counting'})}),'pre','counting sem votos ainda é espera');
 assert.equal(C.fase({ok:true,...foto({counted:1})}),'apuracao');
 assert.equal(C.fase({ok:true,...foto({stage:'final',counted:1000})}),'final');
});

// ---------- diretor de cenas ----------
const cfg={nacionalMs:20000,estadoMs:15000,parcialMs:15000,nacionalEntreParciaisMs:12000,recargaUfMs:240000,filaMax:6};
function rodar(diretor,inicio,ms,ctx,cada=1000){const cenas=[];let ultima=null;for(let t=inicio;t<=inicio+ms;t+=cada){const c=diretor.avancar(t,typeof ctx==='function'?ctx(t):ctx);if(c.id!==ultima){cenas.push(c);ultima=c.id}}return cenas}

test('diretor: antes dos votos permanece na cena de espera',()=>{
 const d=new C.Diretor(cfg,0);
 const cenas=rodar(d,0,120000,{modo:'pre',disponiveis:[]});
 assert.deepEqual(cenas.map(c=>c.tipo),['pre']);
});
test('diretor: alterna nacional e estado, com tempos configuráveis',()=>{
 const d=new C.Diretor(cfg,0);
 const cenas=rodar(d,0,140000,{modo:'apuracao',disponiveis:['SP','BA','RS']});
 assert.deepEqual(cenas.slice(0,5).map(c=>c.tipo),['nacional','estado','nacional','estado','nacional']);
 assert.equal(cenas[1].inicio,20000);assert.equal(cenas[2].inicio,35000);
});
test('diretor: rotação equilibrada cobre todas as UFs antes de repetir',()=>{
 const d=new C.Diretor(cfg,0),todas=C.UFS.slice();
 const ufs=rodar(d,0,27*35000,{modo:'apuracao',disponiveis:todas}).filter(c=>c.tipo==='estado').map(c=>c.uf);
 assert.equal(ufs.length,27);assert.equal(new Set(ufs).size,27);
 for(let i=1;i<ufs.length;i++)if(C.REGIOES[ufs[i]]===C.REGIOES[ufs[i-1]])assert.fail(`mesma região em sequência: ${ufs[i-1]}, ${ufs[i]}`);
});
test('diretor: sem dados estaduais permanece na visão nacional',()=>{
 const d=new C.Diretor(cfg,0);
 assert.ok(rodar(d,0,100000,{modo:'apuracao',disponiveis:[]}).every(c=>c.tipo==='nacional'));
});
test('diretor: nova parcial entra após a cena atual e com retorno nacional entre destaques',()=>{
 const d=new C.Diretor(cfg,0),ctx={modo:'apuracao',disponiveis:['SP','BA','RS','PE']};
 d.avancar(0,ctx);d.avancar(20000,ctx); // estado em exibição
 d.enfileirar([{uf:'PE',deltaSecoes:3,em:21000}],21000);
 assert.equal(d.avancar(30000,ctx).tipo,'estado','não interrompe a cena atual');
 const nac=d.avancar(35000,ctx);
 assert.equal(nac.tipo,'nacional');assert.equal(nac.fim-nac.inicio,cfg.nacionalEntreParciaisMs,'com parcial na fila, a visão nacional encurta');
 const parcial=d.avancar(nac.fim,ctx);
 assert.equal(parcial.tipo,'parcial');assert.equal(parcial.uf,'PE');
 assert.equal(d.avancar(parcial.fim,ctx).tipo,'nacional','sempre volta ao Brasil entre destaques');
});
test('diretor: fila prioriza maior avanço de seções, alterna regiões e respeita limite',()=>{
 const d=new C.Diretor(cfg,0),ctx={modo:'apuracao',disponiveis:C.UFS};
 d.enfileirar([{uf:'SP',deltaSecoes:1,em:0},{uf:'RJ',deltaSecoes:9,em:0},{uf:'MG',deltaSecoes:8,em:0},{uf:'BA',deltaSecoes:2,em:0}],0);
 const ordem=rodar(d,0,200000,ctx).filter(c=>c.tipo==='parcial').map(c=>c.uf);
 assert.equal(ordem[0],'RJ');assert.equal(ordem[1],'BA','após RJ (Sudeste) prefere outra região');
 d.enfileirar(C.UFS.map((uf,i)=>({uf,deltaSecoes:i,em:300000})),300000);
 assert.ok(d.fila.length<=cfg.filaMax);
});
test('diretor: mesma UF não volta como nova parcial antes da carência',()=>{
 const d=new C.Diretor(cfg,0),ctx={modo:'apuracao',disponiveis:['BA','SP']};
 d.enfileirar([{uf:'BA',deltaSecoes:5,em:0}],0);
 const primeira=rodar(d,0,40000,ctx).find(c=>c.tipo==='parcial');
 assert.equal(primeira.uf,'BA');
 d.enfileirar([{uf:'BA',deltaSecoes:5,em:60000}],60000);
 assert.equal(d.fila.length,0,'descartada durante a carência');
});
test('diretor: sessão longa com parciais contínuas cobre as UFs e não trava',()=>{
 const d=new C.Diretor(cfg,0);let t=0;const vistos={};
 for(;t<40*60000;t+=1000){
  if(t%60000===0)d.enfileirar(C.UFS.filter((uf,i)=>(i+t/60000)%3===0).map((uf,i)=>({uf,deltaSecoes:(i%5)+0.5,em:t})),t);
  const c=d.avancar(t,{modo:'apuracao',disponiveis:C.UFS});if(c.uf)vistos[c.uf]=(vistos[c.uf]||0)+(c.inicio===t?1:0);
 }
 assert.equal(Object.keys(vistos).length,27);
 assert.ok(Math.max(...Object.values(vistos))<=6,'nenhuma UF domina a transmissão');
});

// ---------- verificações estáticas ----------
test('página consome só as URLs canônicas da Vercel, sem quebra de cache',()=>{
 const js=ler('transmissao.js');
 assert.match(js,/const API = 'https:\/\/atlasdaselei-es\.vercel\.app';/);
 assert.match(js,/API \+ '\/api\/apuracao\?cargo=presidente&uf=BR'/);
 assert.match(js,/API \+ '\/api\/mapa'/);
 const chamadas=[...js.matchAll(/fetch\(([^,)]+)/g)].map(m=>m[1].trim());
 assert.deepEqual(chamadas.sort(),["'assets/transmissao-estados.json'",'url'].sort());
 assert.doesNotMatch(js,/Math\.random|[?&](t|ts|_|cache|v)=|no-store|reload/);
 assert.doesNotMatch(js,/fetch\(\s*['"`]\/api\//,'nunca usa a API local');
});
test('demonstração isolada: só carrega com ?demo=1 e o modo real não a usa',()=>{
 const js=ler('transmissao.js'),html=ler('transmissao.html');
 assert.match(js,/const DEMO = params\.get\('demo'\) === '1';/);
 assert.doesNotMatch(html,/transmissao-demo\.js/,'o HTML não carrega a demonstração');
 assert.equal((js.match(/transmissao-demo\.js/g)||[]).length,1);
 assert.match(js,/if \(DEMO\) \{[\s\S]*?fonte = await carregarDemo\(\);[\s\S]*?\} else \{\s*fonte = fonteReal;/);
 assert.match(ler('transmissao-demo.js'),/DEMONSTRAÇÃO — DADOS FICTÍCIOS/);
 assert.ok(js.includes("const ARQUIVO = DEMO ? 'Horário simulado' : 'Arquivo oficial do TSE';"),'demonstração não usa rótulo oficial');
 assert.match(js,/if \(DEMO\) \{\s*const ritmo = /,'consultas aceleradas somente na demonstração');
 assert.match(html,/DEMONSTRAÇÃO — DADOS FICTÍCIOS/);
});
test('mapa estático das 27 UFs gerado da malha do IBGE',()=>{
 const geo=JSON.parse(ler('assets/transmissao-estados.json'));
 assert.deepEqual(Object.keys(geo.estados).sort(),C.UFS.slice().sort());
 assert.match(geo.fonte,/IBGE/);
 for(const e of Object.values(geo.estados)){assert.match(e.d,/^M[\d.,LMZ]+$/);assert.equal(e.caixa.length,4);assert.equal(e.rotulo.length,2)}
});
test('servidor local serve os arquivos da transmissão',()=>{
 const srv=ler('scripts/dev-server.cjs');
 for(const f of ['transmissao.html','transmissao.css','transmissao.js','transmissao-core.js','transmissao-demo.js','assets/transmissao-estados.json'])assert.ok(srv.includes(`'${f}'`),f);
});
