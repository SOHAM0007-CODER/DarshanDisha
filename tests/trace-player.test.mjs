import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {makeGraph,shortestPath,planJourney,algorithms} from '../engine.mjs';
import {TracePlayer,describe,explainSimply,pseudocode} from '../trace-player.mjs';
import {teachingData,teachingGraph,runTeaching,teachingScenarios} from '../teaching-graph.mjs';
const data=JSON.parse(fs.readFileSync(new URL('../data/map.json',import.meta.url),'utf8'));
const p=id=>data.places.find(p=>p.id===id).node;
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const snapshot=s=>JSON.stringify({step:s.step,dist:[...s.dist].map(d=>Number.isFinite(d)?+d.toFixed(9):'inf'),pred:[...s.pred],settled:[...s.settled],current:s.current,edge:s.edge,pass:s.pass,heapSize:s.heapSize,heap:s.heap,checks:s.checks,updates:s.updates,stale:s.stale,converged:s.converged,finished:s.finished,last:s.last});

test('Beginner narration distinguishes improved, rejected, finished and unreachable routes',()=>{
  const name=v=>teachingData.nodes[v].label,cost=v=>`${v} m`,graph=teachingGraph(),run=runTeaching().runs.dijkstra,player=new TracePlayer(graph,run);
  const improved=run.trace.findIndex(e=>e.type==='relax');player.seek(improved+1);
  const update=explainSimply(player,name,cost);assert.match(update.title,/better way/);assert.ok(update.text.includes(cost(player.state.last.candidate)));
  // Full trace checks store their arithmetic in replay state, not the event.
  const check=run.trace.findIndex(e=>e.type==='check');player.seek(check+1);
  assert.match(explainSimply(player,name,cost).text,/keep the existing connection/);
  player.seek(player.length);assert.match(explainSimply(player,name,cost).text,new RegExp(String(run.cost)));
  for(const method of algorithms){const g=teachingGraph({scenario:'isolated'}),r=runTeaching({scenario:'isolated'}).runs[method],p=new TracePlayer(g,r);p.seek(p.length);assert.match(explainSimply(p,name,cost).title,/No open route/);}
  const same=runTeaching({source:0,target:0}).runs.astar,p=new TracePlayer(graph,same);p.seek(p.length);assert.match(explainSimply(p,name,cost).text,/no walking is needed/);
});

test('Trace detail does not change any result or operation count',()=>{
  for(const objective of ['distance','time']){
    const g=makeGraph(data,{objective,crowd:85});
    for(const method of algorithms){
      const runs=[false,true,'full'].map(record=>shortestPath(g,p('kasba'),p('kesari'),method,record));
      for(const r of runs.slice(1)){close(r.cost,runs[0].cost);assert.deepEqual(r.path,runs[0].path);for(const k of ['checks','updates','expanded','passes','stale'])assert.equal(r.metrics[k],runs[0].metrics[k]);}
      assert.equal(runs[0].trace.length,0);assert.equal(runs[1].detail,'compact');assert.equal(runs[2].detail,'full');
    }
  }
});

test('Compact traces account for every edge check; full traces record each one',()=>{
  const g=makeGraph(data,{objective:'time',crowd:85});
  for(const method of algorithms){
    const compact=shortestPath(g,p('shaniwar'),p('dagdu'),method,true),full=shortestPath(g,p('shaniwar'),p('dagdu'),method,'full');
    const grouped=compact.trace.reduce((s,e)=>s+(e.skipped||0)+(e.type==='relax'),0);
    assert.equal(grouped,compact.metrics.checks);
    assert.equal(full.trace.filter(e=>e.type==='check'||e.type==='relax').length,full.metrics.checks);
    assert.ok(!full.trace.some(e=>e.skipped||e.stale));
    assert.equal(compact.trace.reduce((s,e)=>s+(e.stale||0),0),compact.metrics.stale);
    assert.equal(full.trace.filter(e=>e.type==='stale').length,full.metrics.stale);
    if(method==='bellman'){
      const ends=compact.trace.filter(e=>e.type==='pass-end');assert.equal(ends.length,compact.metrics.passes);
      assert.equal(ends.at(-1).updates,0,'Bellman–Ford stops after a pass without updates');
      assert.equal(ends.reduce((s,e)=>s+e.checks,0),compact.metrics.checks);
      assert.ok(compact.trace.length<full.trace.length/10,'compact Bellman–Ford trace stays small on the Pune graph');
    }
  }
});

test('Replay reconstructs final costs, predecessors and operation counts',()=>{
  for(const objective of ['distance','time']){
    const settings={start:'shaniwar',mode:'all',order:'optimal',objective,crowd:85,closed:[],extras:[]};
    const r=planJourney(data,settings),g=makeGraph(data,settings);
    for(const method of algorithms)for(const leg of r.comparisons[method].legs){
      const player=new TracePlayer(g,leg);player.seek(player.length);
      const s=player.state;assert.equal(s.mismatch,0);assert.equal(s.checks,leg.metrics.checks);assert.equal(s.updates,leg.metrics.updates);
      close(s.dist[leg.target],leg.cost);assert.deepEqual(player.path().nodes,leg.path);assert.deepEqual(player.path().edges,leg.edgeIds);
      if(method!=='bellman'){assert.equal(s.selections,leg.metrics.expanded);assert.equal(s.stale,leg.metrics.stale);}
      else assert.ok(s.converged);
      assert.ok(player.maxCost>=leg.cost);
    }
  }
});

test('Backward steps and scrubbing reproduce the same state as a fresh forward replay',()=>{
  const g=makeGraph(data,{objective:'distance'}),cases=[...algorithms.map(m=>[g,shortestPath(g,p('kasba'),p('tulshi'),m,true)]),...algorithms.map(m=>[teachingGraph(),runTeaching().runs[m]])];
  for(const [graph,run] of cases){
    const player=new TracePlayer(graph,run,{interval:16}),fresh=k=>{const q=new TracePlayer(graph,run,{interval:1e9});q.seek(k);return snapshot(q.state);};
    let seed=7;const random=()=>(seed=(seed*16807)%2147483647)/2147483647;
    const steps=[player.length,0,Math.floor(player.length/2),1,player.length-1,...Array.from({length:12},()=>Math.floor(random()*(player.length+1)))];
    for(const k of steps){player.seek(k);assert.equal(snapshot(player.state),fresh(k),`${run.method} step ${k}`);}
    for(let k=player.length;k>Math.max(0,player.length-20);k--){player.seek(k-1);assert.equal(snapshot(player.state),fresh(k-1));}
  }
});

test('Compact heap sizes match the reconstructed heap of a full trace',()=>{
  const g=makeGraph(data,{objective:'time',crowd:85});
  for(const method of ['dijkstra','astar']){
    const full=new TracePlayer(g,shortestPath(g,p('shaniwar'),p('kesari'),method,'full'));
    for(let k=0;k<=full.length;k+=1){full.seek(k);assert.equal(full.state.heap.length,full.state.heapSize);}
    full.seek(full.length);assert.equal(full.state.mismatch,0);
    const compact=new TracePlayer(g,shortestPath(g,p('shaniwar'),p('kesari'),method,true));compact.seek(compact.length);assert.equal(compact.state.mismatch,0);
    const live=full.heapEntries().filter(x=>!x.stale).length;assert.equal(live,full.frontier(1e9).total);
  }
});

test('Teaching graph: weights, consistency and an independent oracle',()=>{
  assert.ok(teachingData.nodes.length>=8&&teachingData.nodes.length<=12);
  for(const e of teachingData.edges){const a=teachingData.nodes[e.a],b=teachingData.nodes[e.b];assert.ok(e.length>=Math.hypot(a.x-b.x,a.y-b.y),e.name);}
  for(const scenario of Object.keys(teachingScenarios)){
    const g=teachingGraph({scenario}),n=g.nodes.length,d=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?0:Infinity));
    for(const e of g.edges)if(!e.closed)d[e.a][e.b]=d[e.b][e.a]=e.weight;
    for(let k=0;k<n;k++)for(let i=0;i<n;i++)for(let j=0;j<n;j++)d[i][j]=Math.min(d[i][j],d[i][k]+d[k][j]);
    for(let s=0;s<n;s++)for(let t=0;t<n;t++){const r=runTeaching({source:s,target:t,scenario});for(const m of algorithms){const run=r.runs[m];assert.equal(run.cost,d[s][t]);const player=new TracePlayer(g,run);player.seek(player.length);assert.equal(player.state.mismatch,0);assert.equal(player.state.dist[t],d[s][t]);}}
  }
});

test('Teaching graph shows greedy selection, repeated passes and heuristic pruning',()=>{
  const {runs}=runTeaching();
  assert.ok(runs.astar.metrics.expanded<runs.dijkstra.metrics.expanded,'A* settles fewer nodes');
  assert.ok(runs.bellman.metrics.passes>=4,'Bellman–Ford needs several passes in this edge order');
  assert.ok(runs.dijkstra.trace.some(e=>e.type==='stale'),'Dijkstra meets an outdated heap entry');
  // Dijkstra selects nodes in nondecreasing g; A* in nondecreasing f.
  const g=teachingGraph(),player=new TracePlayer(g,runs.astar);
  const gs=runs.dijkstra.trace.filter(e=>e.type==='visit').map(e=>e.cost);assert.deepEqual(gs,[...gs].sort((a,b)=>a-b));
  const fs=runs.astar.trace.filter(e=>e.type==='visit').map(e=>e.cost+player.h(e.node));fs.slice(1).forEach((f,i)=>assert.ok(f>=fs[i]-1e-9));
  // A relaxation followed by a later improvement of the same node (E: 300 then 297).
  const e=teachingData.nodes.findIndex(n=>n.id==='E'),updates=runs.dijkstra.trace.filter(x=>x.type==='relax'&&x.node===e).map(x=>x.cost);
  assert.deepEqual(updates,[300,297]);
});

test('Explanations quote the actual relaxation arithmetic',()=>{
  const g=teachingGraph(),name=v=>teachingData.nodes[v].id,cost=x=>Number.isFinite(x)?`${+x.toFixed(1)} m`:'∞';
  for(const method of algorithms){
    const run=runTeaching().runs[method],player=new TracePlayer(g,run);
    for(let k=0;k<=player.length;k++){
      player.seek(k);const d=describe(player,name,cost);assert.ok(d.title&&d.text);assert.ok(d.line>=0&&d.line<pseudocode[method].length);
      if(d.calc){const w=g.edges[player.state.last.edge].weight;close(d.calc.w,w);if(Number.isFinite(d.calc.gu))close(d.calc.candidate,d.calc.gu+w);assert.equal(d.updated,d.calc.candidate<d.calc.old-1e-9);}
    }
  }
  const pass=new TracePlayer(g,runTeaching().runs.bellman);pass.seek(pass.length-1);assert.match(describe(pass,name,cost).title,/changed nothing: stop early/);
});

test('Unreachable, identical source/target and closed lanes replay correctly',()=>{
  const isolated=runTeaching({scenario:'isolated'}),g=teachingGraph({scenario:'isolated'}),name=v=>teachingData.nodes[v].id,cost=x=>String(x);
  for(const m of algorithms){const player=new TracePlayer(g,isolated.runs[m]);player.seek(player.length);assert.equal(player.path(),null);assert.equal(player.status(player.target),'unknown');if(m!=='bellman')assert.ok(player.state.exhausted);assert.match(describe(player,name,cost).text,/unreachable|∞/);}
  const same=runTeaching({source:3,target:3});
  for(const m of algorithms){const player=new TracePlayer(teachingGraph(),same.runs[m]);player.seek(player.length);assert.deepEqual(player.path().nodes,[3]);assert.equal(player.state.dist[3],0);}
  const closed=teachingGraph({scenario:'detour'}),detour=runTeaching({scenario:'detour'});
  for(const m of algorithms){const player=new TracePlayer(closed,detour.runs[m]);for(let k=0;k<=player.length;k++){player.seek(k);if(player.state.edge>=0)assert.ok(!closed.edges[player.state.edge].closed);}}
});

test('Bellman–Ford never reports a node as settled before convergence',()=>{
  const player=new TracePlayer(teachingGraph(),runTeaching().runs.bellman);
  for(let k=0;k<player.length;k++){player.seek(k);if(!player.state.converged)for(let v=0;v<player.n;v++)assert.notEqual(player.status(v),'settled');}
  player.seek(player.length);assert.equal(player.status(player.target),'final');
});
