'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {campos,montar}=require('../scripts/historico/importar-presidente.cjs');

const DIR=path.join(__dirname,'..','dados','historico');
const UFS=['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const TURNOS=['2018-1','2018-2','2022-1','2022-2','2026-1'];
const ler=k=>JSON.parse(fs.readFileSync(path.join(DIR,`presidente-${k}.json`),'utf8'));

for(const k of TURNOS){
 test(`${k}: arquivo estático tem fonte, data de extração e todas as áreas`,()=>{
  const d=ler(k);
  assert.equal(d.schema,1);assert.equal(`${d.eleicao.ano}-${d.eleicao.turno}`,k);assert.equal(d.eleicao.cargo,'presidente');
  assert.ok(d.fonte.descricao.includes('TSE'));assert.ok(d.fonte.arquivos.length>0);
  assert.ok(!Number.isNaN(Date.parse(d.extraidoEm)));assert.ok(d.validacao.verificacoes.length>=4);
  assert.deepEqual(Object.keys(d.resultados).sort(),['BR',...UFS,'ZZ'].sort());
  const ids=d.candidatos.map(c=>c.id);
  assert.equal(new Set(ids).size,ids.length,'identificadores oficiais únicos');
  for(const c of d.candidatos){assert.match(c.id,/^\d{12}$/);assert.match(c.numero,/^\d{2}$/);assert.ok(c.nome&&c.partido)}
 });
 test(`${k}: soma dos candidatos = votos válidos em cada UF, exterior e Brasil`,()=>{
  const d=ler(k),ids=new Set(d.candidatos.map(c=>c.id));
  for(const [area,a] of Object.entries(d.resultados)){
   for(const id of Object.keys(a.votos))assert.ok(ids.has(id),`${area}: voto para candidato desconhecido ${id}`);
   for(const v of Object.values(a.votos))assert.ok(Number.isInteger(v)&&v>=0);
   assert.equal(Object.values(a.votos).reduce((s,v)=>s+v,0),a.totais.validos,area);
   const t=a.totais;
   assert.equal(t.validos+t.brancos+t.nulos+t.anulados+t.anuladosApuracaoSeparada,t.votos,`${area}: composição do total de votos`);
   assert.equal(t.comparecimento+t.abstencoes+t.eleitoresSecoesNaoInstaladas,t.aptos,`${area}: eleitorado`);
  }
 });
 test(`${k}: Brasil = 27 UFs + exterior, por candidato e nos totais`,()=>{
  const d=ler(k),br=d.resultados.BR;
  for(const c of d.candidatos){
   const soma=[...UFS,'ZZ'].reduce((s,uf)=>s+(d.resultados[uf].votos[c.id]||0),0);
   assert.equal(soma,br.votos[c.id],c.nome);
  }
  for(const campo of Object.keys(br.totais))assert.equal([...UFS,'ZZ'].reduce((s,uf)=>s+d.resultados[uf].totais[campo],0),br.totais[campo],campo);
 });
 test(`${k}: percentuais vêm dos votos exatos, com denominadores corretos`,()=>{
  const d=ler(k);
  for(const [area,a] of Object.entries(d.resultados)){
   for(const [id,v] of Object.entries(a.votos))assert.equal(a.percentualCandidato[id],Math.round(v/a.totais.validos*10000)/100,`${area} ${id}`);
   assert.equal(a.percentuais.brancos,Math.round(a.totais.brancos/a.totais.votos*10000)/100,`${area} brancos sobre votos totais`);
   assert.equal(a.percentuais.nulos,Math.round(a.totais.nulos/a.totais.votos*10000)/100,`${area} nulos sobre votos totais`);
  }
 });
}

test('totais nacionais conferem com resultados oficiais divulgados pelo TSE',()=>{
 const votos=(k,numero)=>{const d=ler(k);return d.resultados.BR.votos[d.candidatos.find(c=>c.numero===numero).id]};
 assert.equal(votos('2018-2','17'),57797847);assert.equal(votos('2018-2','13'),47040906);
 assert.equal(votos('2022-1','13'),57259504);assert.equal(votos('2022-1','22'),51072345);
 assert.equal(votos('2022-2','13'),60345999);assert.equal(votos('2022-2','22'),58206354);
 assert.equal(votos('2026-1','22'),56104503);assert.equal(votos('2026-1','13'),53879538);
 assert.equal(ler('2022-2').resultados.BR.totais.validos,118552353);
 assert.equal(ler('2018-1').resultados.BR.totais.brancos,3106937);
});

test('Atlas não associa candidatos por posição nem embute percentuais presidenciais',()=>{
 for(const f of ['atlas.html','index.html']){
  const html=fs.readFileSync(path.join(__dirname,'..',f),'utf8');
  for(const proibido of ['NATIONAL','PRES_2018','"2022-1":[','"2026-1":[','function embedded('])assert.ok(!html.includes(proibido),`${f} contém ${proibido}`);
  assert.match(html,/\/dados\/historico\/presidente-/);
  const declarados=[...html.match(/PRES_FILES=new Set\(\[([^\]]+)\]\)/)[1].matchAll(/'(\d{4}-\d)'/g)].map(m=>m[1]);
  assert.deepEqual(declarados.sort(),TURNOS);
 }
 assert.equal(fs.readFileSync(path.join(__dirname,'..','atlas.html'),'utf8'),fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'));
});

test('arquivos históricos são compactos para o site público',()=>{
 for(const k of TURNOS)assert.ok(fs.statSync(path.join(DIR,`presidente-${k}.json`)).size<60000,k);
});

test('importador lê CSV do TSE com aspas e ponto e vírgula',()=>{
 assert.deepEqual(campos('"A";"B ""C""";"1;2";""'),['A','B "C"','1;2','']);
});

test('importador recusa área em que candidatos não somam os votos válidos',()=>{
 const area=(votos,validos)=>({votos,totais:{aptos:10,comparecimento:10,abstencoes:0,eleitoresSecoesNaoInstaladas:0,votos:validos,validos,brancos:0,nulos:0,anulados:0,anuladosApuracaoSeparada:0}});
 const areas={BR:area({a:5},5)};for(const uf of [...UFS,'ZZ'])areas[uf]=area({a:0},0);
 areas.SP=area({a:3},4);
 assert.throws(()=>montar('2022-2',[{id:'a'}],areas,{}),/SP: soma dos candidatos 3 ≠ votos válidos 4/);
});
