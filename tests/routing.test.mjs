import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {makeGraph,shortestPath,planJourney,algorithms,geometry,permutations} from '../engine.mjs';
const data=JSON.parse(fs.readFileSync(new URL('../data/map.json',import.meta.url),'utf8'));
const p=id=>data.places.find(p=>p.id===id);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const settings={start:'shaniwar',mode:'all',order:'optimal',objective:'distance',crowd:15,closed:[],extras:[]};
test('Both algorithms match an independent Floyd–Warshall oracle on a small graph',()=>{
  const fixture={nodes:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:2,y:0}],places:[],edges:[{a:0,b:1,length:4,points:[[0,0],[1,0]]},{a:0,b:2,length:2,points:[[0,0],[1,1]]},{a:2,b:1,length:1,points:[[1,1],[1,0]]},{a:1,b:3,length:2,points:[[1,0],[2,0]]},{a:2,b:3,length:6,points:[[1,1],[2,0]]}]};
  const g=makeGraph(fixture),n=g.nodes.length,d=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?0:Infinity));
  for(const e of g.edges)d[e.a][e.b]=d[e.b][e.a]=e.length;
  for(let k=0;k<n;k++)for(let i=0;i<n;i++)for(let j=0;j<n;j++)d[i][j]=Math.min(d[i][j],d[i][k]+d[k][j]);
  for(let i=0;i<n;i++)for(let j=0;j<n;j++)for(const method of algorithms)close(shortestPath(g,i,j,method).cost,d[i][j]);
});
test('Actual Pune routes agree under distance, crowds and walking time',()=>{
  for(const objective of ['distance','time'])for(const crowd of [0,85]){
    const g=makeGraph(data,{objective,crowd});
    for(const [from,to] of [['shaniwar','dagdu'],['kasba','kesari'],['mandai-start','tambdi']]){
      const runs=algorithms.map(a=>shortestPath(g,p(from).node,p(to).node,a));assert.ok(runs.every(r=>r.reachable));runs.forEach(r=>close(r.cost,runs[0].cost));
      for(const r of runs){const pts=geometry(g,r),length=pts.slice(1).reduce((s,q,i)=>s+Math.hypot(q[0]-pts[i][0],q[1]-pts[i][1]),0);assert.ok(Math.abs(length-r.metres)<.1);}
    }
  }
});
test('Closures cannot appear in a route; isolated destination returns no path',()=>{
  const target=p('dagdu').node,g=makeGraph(data),incident=g.edges.filter(e=>e.a===target||e.b===target).map(e=>e.id);
  for(const method of algorithms)assert.equal(shortestPath(makeGraph(data,{closed:incident}),p('shaniwar').node,target,method).reachable,false);
  const first=shortestPath(g,p('shaniwar').node,target),blocked=first.edgeIds[Math.floor(first.edgeIds.length/2)];
  for(const method of algorithms){const route=shortestPath(makeGraph(data,{closed:[blocked]}),p('shaniwar').node,target,method);assert.ok(route.reachable);assert.ok(!route.edgeIds.includes(blocked));}
});
test('Five-stop optimum is the minimum of all 120 orders',()=>{
  const r=planJourney(data,settings),g=makeGraph(data,settings),ids=data.places.filter(p=>p.rank).map(p=>p.id),cache=new Map();
  const cost=(a,b)=>{const k=a+b;if(!cache.has(k))cache.set(k,shortestPath(g,p(a).node,p(b).node,'dijkstra',false).cost);return cache.get(k);};
  const orders=permutations(ids);assert.equal(orders.length,120);const costs=orders.map(order=>[settings.start,...order].slice(1).reduce((sum,id,i)=>sum+cost([settings.start,...order][i],id),0));
  close(r.comparisons.dijkstra.cost,Math.min(...costs));assert.equal(new Set(r.order.slice(1)).size,5);
});
test('Optional suggestions show exact incremental costs and accepted stops persist',()=>{
  const s={...settings,mode:'single',destination:'dagdu',crowd:15},r=planJourney(data,s),g=makeGraph(data,s);
  assert.ok(r.suggestions.length>0);
  for(const suggestion of r.suggestions){const via=shortestPath(g,p(s.start).node,p(suggestion.id).node),after=shortestPath(g,p(suggestion.id).node,p(s.destination).node);close(suggestion.metres,Math.max(0,via.metres+after.metres-r.comparisons.dijkstra.metres));}
  const accepted=planJourney(data,{...s,extras:[r.suggestions[0].id]});assert.ok(accepted.order.includes(r.suggestions[0].id));assert.equal(accepted.order.at(-1),'dagdu');
});
test('Festival crowds produce a useful shorter-distance versus quicker-time comparison',()=>{
  const r=planJourney(data,{...settings,crowd:85});assert.ok(r.timeRoute.seconds<=r.distanceRoute.seconds);assert.ok(r.distanceRoute.metres<=r.timeRoute.metres);assert.ok(r.distanceRoute.seconds-r.timeRoute.seconds>60);
});
test('Starting at the destination does not create a duplicate stop or a fake trip',()=>{
  const r=planJourney(data,{...settings,start:'dagdu',mode:'single',destination:'dagdu'});
  assert.deepEqual(r.order,['dagdu']);for(const a of algorithms){close(r.comparisons[a].cost,0);assert.equal(r.comparisons[a].points.length,1);}
});
test('Two optional stops retain all five main mandals and the traditional relative order',()=>{
  const r=planJourney(data,{...settings,order:'traditional',extras:['dagdu','rangari']});
  assert.ok(r.order.includes('dagdu')&&r.order.includes('rangari'));
  assert.deepEqual(r.order.filter(id=>p(id).rank),['kasba','tambdi','guruji','tulshi','kesari']);
  for(const a of algorithms)close(r.comparisons[a].cost,r.comparisons.dijkstra.cost);
});
test('Full-tour ranking: 120 orders, best first, winner equals the journey cost',()=>{
  const r=planJourney(data,settings),s=r.orderSearch;
  assert.equal(s.evaluated,120);assert.deepEqual(s.top[0].order,r.order);
  close(s.top[0].cost,r.comparisons.dijkstra.cost);
  for(let i=1;i<s.top.length;i++)assert.ok(s.top[i-1].cost<=s.top[i].cost);
  assert.ok(s.top[0].cost<=r.traditionalCost&&r.traditionalCost<=s.worst.cost);
  assert.equal(planJourney(data,{...settings,mode:'single',destination:'dagdu'}).orderSearch,null);
});
