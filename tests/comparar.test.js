'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const C=require('../comparar-core.js');

const raiz=path.join(__dirname,'..');
const ler=f=>fs.readFileSync(path.join(raiz,f),'utf8');
const dados=id=>JSON.parse(ler(`dados/historico/presidente-${id}.json`));

test('cenários: somente resultados finais consolidados; 2º turno de 2026 fora',()=>{
 assert.deepEqual(C.CENARIOS.map(c=>c.id),['2018-1','2018-2','2022-1','2022-2','2026-1']);
 assert.equal(C.cenario('2026-2'),null);
 for(const c of C.CENARIOS)assert.ok(fs.existsSync(path.join(raiz,`dados/historico/presidente-${c.id}.json`)),c.id);
});

test('resumo de cada cenário no Brasil e nas 27 UFs a partir das contagens exatas',()=>{
 for(const c of C.CENARIOS){
  const d=dados(c.id);
  for(const area of ['BR',...C.UFS]){
   const r=C.resumir(d,area),t=r.totais;
   assert.equal(r.candidatos.reduce((s,x)=>s+x.votos,0),t.validos,`${c.id} ${area}`);
   assert.equal(r.participacao.comparecimento.pct,Math.round(t.comparecimento/t.aptos*10000)/100);
   assert.equal(r.participacao.abstencao.pct,Math.round(t.abstencoes/t.aptos*10000)/100);
   assert.equal(r.participacao.brancos.pct,Math.round(t.brancos/t.votos*10000)/100,'brancos sobre o total de votos');
   assert.equal(r.participacao.nulos.pct,Math.round(t.nulos/t.votos*10000)/100);
   for(const x of r.candidatos)assert.equal(x.pct,Math.round(x.votos/t.validos*10000)/100,'candidato sobre válidos');
   for(let i=1;i<r.candidatos.length;i++)assert.ok(r.candidatos[i-1].votos>=r.candidatos[i].votos);
  }
 }
});

test('valores conferem com os totais oficiais conhecidos',()=>{
 const r=C.resumir(dados('2022-2'),'BR');
 assert.equal(r.candidatos[0].nome,'LULA');assert.equal(r.candidatos[0].votos,60345999);assert.equal(r.candidatos[0].pct,50.9);
 assert.equal(r.totais.validos,118552353);
 assert.equal(C.resumir(dados('2018-1'),'BR').totais.brancos,3106937);
});

test('mesma pessoa pelo nome civil, mesmo com número e partido diferentes',()=>{
 const cmp=C.comparar(C.resumir(dados('2018-2'),'BR'),C.resumir(dados('2022-2'),'BR'));
 assert.deepEqual(cmp.comuns.map(c=>c.nome),['JAIR BOLSONARO']);
 const b=cmp.comuns[0];
 assert.equal(b.a.numero,'17');assert.equal(b.b.numero,'22');assert.equal(b.a.partido,'PSL');assert.equal(b.b.partido,'PL');
 assert.equal(b.deltaPp,Math.round((b.b.pct-b.a.pct)*100)/100);
 // Lula e Haddad são pessoas diferentes, mesmo ambos pelo PT nº 13.
 const lulaHaddad=C.comparar(C.resumir(dados('2018-2'),'BR'),C.resumir(dados('2022-1'),'BR'));
 assert.ok(!lulaHaddad.comuns.some(c=>/HADDAD|LULA/.test(c.nome)));
});

test('turnos diferentes: nenhuma diferença calculada',()=>{
 const cmp=C.comparar(C.resumir(dados('2022-1'),'SP'),C.resumir(dados('2022-2'),'SP'));
 assert.equal(cmp.mesmoTurno,false);
 assert.ok(cmp.participacao.every(l=>l.deltaPp===null));
 assert.ok(cmp.comuns.length>0&&cmp.comuns.every(c=>c.deltaPp===null&&c.deltaVotos===null));
});

test('mesmo turno: diferenças em pontos percentuais com o mesmo denominador',()=>{
 const a=C.resumir(dados('2022-1'),'BA'),b=C.resumir(dados('2026-1'),'BA'),cmp=C.comparar(a,b);
 assert.equal(cmp.mesmoTurno,true);
 const comp=cmp.participacao.find(l=>l.rotulo==='Comparecimento');
 assert.equal(comp.deltaPp,Math.round((b.participacao.comparecimento.pct-a.participacao.comparecimento.pct)*100)/100);
 const lula=cmp.comuns.find(c=>c.nome==='LULA');
 assert.equal(lula.deltaVotos,lula.b.votos-lula.a.votos);
});

test('cor do mapa segue o mais votado e é neutra sem dados',()=>{
 assert.match(C.corLider(C.resumir(dados('2022-2'),'BA')),/^rgb\(/);
 assert.equal(C.corLider(null),'rgb(213,220,207)');
 assert.notEqual(C.corLider(C.resumir(dados('2022-2'),'BA')),C.corLider(C.resumir(dados('2022-2'),'SC')));
});

test('formatação de diferenças com sinal e sem inventar zero',()=>{
 assert.equal(C.fmtPp(null),'—');assert.equal(C.fmtPp(1.5),'+1,50 p.p.');assert.equal(C.fmtPp(-0.25),'−0,25 p.p.');
 assert.equal(C.fmtPct(null),'—');
});

test('página usa só arquivos estáticos do site: nenhuma consulta ao TSE ou API',()=>{
 const js=ler('comparar.js');
 const urls=[...js.matchAll(/fetch\(([^,)]+)/g)].map(m=>m[1]);
 assert.deepEqual(urls,['`/dados/historico/presidente-${id}.json`',"'assets/transmissao-estados.json'"]);
 assert.doesNotMatch(js,/tse\.jus\.br|\/api\//);
});

test('navegação do Atlas tem link discreto para o comparador',()=>{
 for(const f of ['atlas.html','index.html'])assert.match(ler(f),/<a href="\/comparar\.html">Comparar eleições<\/a>/);
 assert.equal(ler('atlas.html'),ler('index.html'));
 assert.match(ler('comparar.html'),/aria-current="page">Comparar eleições/);
 assert.ok(ler('scripts/dev-server.cjs').includes("'comparar.html'"));
});
