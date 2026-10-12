// Replay state for one recorded search (one algorithm, one journey leg). No DOM.
// State after step k is the result of applying trace events 0..k-1 to the initial
// state (g[s] = 0, everything else ∞). Backward seeks restore the nearest sparse
// checkpoint and replay forward, so every step is reconstructed deterministically.
import {heuristic} from './engine.mjs';

const EPS=1e-6;

export const pseudocode={
  dijkstra:['for each node v: g[v] ← ∞, pred[v] ← none','g[s] ← 0; push (0, s) into the heap','while the heap is not empty:','  pop (key, u) with the smallest key','  if u is settled or key > g[u]: skip stale entry','  settle u   // g[u] is final (weights ≥ 0)','  if u = t: stop','  for each open lane (u, v) with weight w:','    if g[u] + w < g[v]:','      g[v] ← g[u] + w; pred[v] ← u; push (g[v], v)','path ← follow pred from t back to s'],
  astar:['for each node v: g[v] ← ∞, pred[v] ← none','g[s] ← 0; push (f = h(s), s) into the heap','while the heap is not empty:','  pop (f, u) with the smallest f = g + h','  if u is settled or entry is outdated: skip it','  settle u   // h is consistent, so g[u] is final','  if u = t: stop','  for each open lane (u, v) with weight w:','    if g[u] + w < g[v]:','      g[v] ← g[u] + w; pred[v] ← u; push (g[v] + h(v), v)','path ← follow pred from t back to s'],
  bellman:['for each node v: g[v] ← ∞, pred[v] ← none','g[s] ← 0','for pass ← 1 to V − 1:','  for each open directed lane (u, v, w), fixed order:','    if g[u] + w < g[v]:','      g[v] ← g[u] + w; pred[v] ← u','  if no g changed in this pass: stop early','path ← follow pred from t back to s']
};

function initialState(n,source,h) {
  const dist=new Float64Array(n).fill(Infinity);dist[source]=0;
  return {step:0,dist,pred:new Int32Array(n).fill(-1),predEdge:new Int32Array(n).fill(-1),settled:new Uint8Array(n),
    current:-1,edge:-1,edgeTo:-1,pass:0,heapSize:1,heap:[{node:source,g:0,priority:h(source)}],
    checks:0,updates:0,selections:0,stale:0,converged:false,finished:false,exhausted:false,mismatch:0,last:{kind:'init',node:source}};
}
const cloneState=s=>({...s,dist:s.dist.slice(),pred:s.pred.slice(),predEdge:s.predEdge.slice(),settled:s.settled.slice(),heap:s.heap.map(x=>({...x})),last:{...s.last}});

export class TracePlayer {
  // graph: makeGraph() output for the same settings; run: one shortestPath() result.
  constructor(graph,run,{interval=256}={}) {
    this.graph=graph;this.run=run;this.method=run.method;this.source=run.source;this.target=run.target;
    this.events=run.trace;this.length=run.trace.length;this.n=graph.nodes.length;this.full=run.detail==='full';
    this.h=heuristic(graph,run.target,run.method);this.interval=interval;this.checkpoints=[];
    this.state=initialState(this.n,this.source,this.h);this.checkpoints[0]=cloneState(this.state);
    this.seek(this.length);
    // A fixed scale for the whole replay: the largest finite cost reached in this search.
    this.maxCost=this.state.dist.reduce((m,d)=>Number.isFinite(d)&&d>m?d:m,0);
    this.final=cloneState(this.state);
    this.seek(0);
  }
  get step(){return this.state.step;}
  seek(step) {
    step=Math.max(0,Math.min(this.length,Math.round(step)));
    if(step<this.state.step) {
      let k=Math.floor(step/this.interval);while(k>0&&!this.checkpoints[k])k--;
      this.state=cloneState(this.checkpoints[k]);
    }
    while(this.state.step<step)this.apply(this.events[this.state.step]);
    return this.state;
  }
  apply(e) {
    const s=this.state,g=this.graph,bellman=this.method==='bellman';
    const last={kind:e.type,skipped:e.skipped||0,stalePopped:e.stale||0};
    s.checks+=last.skipped;s.stale+=last.stalePopped;
    if(e.type==='visit') {
      const u=e.node;s.settled[u]=1;s.current=u;s.edge=-1;s.edgeTo=-1;s.selections++;
      if(Math.abs(s.dist[u]-e.cost)>EPS)s.mismatch++;
      if(this.full)this.removeHeap(u,s.dist[u]);else s.heapSize-=1+last.stalePopped;
      if(s.heapSize!==e.heap)s.mismatch++;
      Object.assign(last,{node:u,g:s.dist[u],h:this.h(u),heapAfter:e.heap,target:u===this.target});
    } else if(e.type==='stale') {
      this.removeHeap(e.node,e.g);s.stale++;s.edge=-1;s.edgeTo=-1;
      Object.assign(last,{node:e.node,g:e.g,priority:e.priority,known:s.dist[e.node],settled:!!s.settled[e.node]});
    } else if(e.type==='check'||e.type==='relax') {
      const u=e.from,v=e.node,edge=g.edges[e.edge],w=edge.weight,gu=s.dist[u],old=s.dist[v],candidate=gu+w,updated=e.type==='relax';
      s.checks++;s.edge=e.edge;s.edgeTo=v;if(bellman)s.current=u;
      if(updated) {
        if(Math.abs(candidate-e.cost)>EPS)s.mismatch++;
        s.dist[v]=e.cost;s.pred[v]=u;s.predEdge[v]=e.edge;s.updates++;
        if(!bellman){s.heapSize++;if(this.full)s.heap.push({node:v,g:e.cost,priority:e.cost+this.h(v)});}
      } else if(candidate<old-1e-9)s.mismatch++;
      Object.assign(last,{from:u,node:v,edge:e.edge,w,gu,old,candidate,updated,h:this.h(v),pass:e.pass});
    } else if(e.type==='pass') {
      s.pass=e.pass;s.current=-1;s.edge=-1;s.edgeTo=-1;Object.assign(last,{pass:e.pass});
    } else if(e.type==='pass-end') {
      s.current=-1;s.edge=-1;s.edgeTo=-1;if(!e.updates)s.converged=true;
      Object.assign(last,{pass:e.pass,updates:e.updates,checks:e.checks});
    } else if(e.type==='finish') {
      s.finished=true;s.current=e.node;s.edge=-1;s.edgeTo=-1;Object.assign(last,{node:e.node,g:e.cost});
    } else if(e.type==='exhausted') {
      s.exhausted=true;s.current=-1;s.edge=-1;s.edgeTo=-1;s.heapSize=0;
    }
    s.last=last;s.step++;
    if(s.step%this.interval===0&&!this.checkpoints[s.step/this.interval])this.checkpoints[s.step/this.interval]=cloneState(s);
  }
  removeHeap(node,g) {
    const s=this.state,i=s.heap.findIndex(x=>x.node===node&&Math.abs(x.g-g)<EPS);
    if(i<0)s.mismatch++;else s.heap.splice(i,1);s.heapSize=s.heap.length;
  }
  // Predecessor chain from the current state; null while the target has no finite cost.
  path(node=this.target) {
    const s=this.state;if(!Number.isFinite(s.dist[node]))return null;
    const nodes=[node],edges=[];let u=node;
    while(u!==this.source){if(s.pred[u]<0||nodes.length>this.n)return null;edges.push(s.predEdge[u]);u=s.pred[u];nodes.push(u);}
    return {nodes:nodes.reverse(),edges:edges.reverse()};
  }
  status(v) {
    const s=this.state;
    if(!Number.isFinite(s.dist[v]))return 'unknown';
    if(this.method==='bellman')return s.converged?'final':'reached';
    return s.settled[v]?'settled':'tentative';
  }
  // Tentative nodes ordered by the priority the algorithm uses: g, or f = g + h for A*.
  // This is the set of live priorities; the binary heap may additionally hold stale entries.
  frontier(limit=6) {
    if(this.method==='bellman')return {items:[],total:0};
    const s=this.state,items=[];
    for(let v=0;v<this.n;v++)if(Number.isFinite(s.dist[v])&&!s.settled[v])items.push({node:v,g:s.dist[v],h:this.h(v),priority:s.dist[v]+this.h(v)});
    items.sort((a,b)=>a.priority-b.priority||a.node-b.node);
    return {items:items.slice(0,limit),total:items.length};
  }
  // Full traces know every heap entry; compact traces know only the heap size.
  heapEntries() {
    const s=this.state;if(!this.full||this.method==='bellman')return null;
    return s.heap.map(x=>({...x,stale:!!s.settled[x.node]||x.g>s.dist[x.node]+EPS})).sort((a,b)=>a.priority-b.priority||a.node-b.node);
  }
  inspect(v) {
    const s=this.state,g=s.dist[v],h=this.h(v);
    return {node:v,g,h,f:g+h,pred:s.pred[v],predEdge:s.predEdge[v],status:this.status(v)};
  }
}

// Beginner narration is derived from the same replay event as the technical view.
export function explainSimply(player,name,cost) {
  const s=player.state,e=s.last,bellman=player.method==='bellman';
  const unknown=x=>Number.isFinite(x)?cost(x):'no known route';
  if(e.kind==='exhausted'||(bellman&&s.step===player.length&&!player.run.reachable))return {title:'No open route connects the two places',text:'The search has checked every reachable option. Open a closed road or choose another destination to try again.'};
  if(e.kind==='init')return {title:'Find a route from '+name(player.source)+' to '+name(player.target),text:'We start at the flag with a total cost of zero. Grey junctions have not been reached yet. Click Next to watch the search make its first decision.'};
  if(e.kind==='visit')return {title:'Look at junction '+name(e.node),text:e.target?'We have reached the destination with its lowest possible cost. Next, reveal the final route.':player.method==='astar'?`This junction has the lowest total of cost so far (${cost(e.g)}) plus estimated cost still to go (${cost(e.h)}). The orange ring shows where the search is looking.`:`Of the junctions still waiting, this one has the smallest known cost from the start: ${cost(e.g)}. It turns green because that cost is now confirmed.`};
  if(e.kind==='check'||e.kind==='relax')return {title:e.updated?'A better way to '+name(e.node):'Test the road to '+name(e.node),text:!Number.isFinite(e.gu)?`We have not found a route to ${name(e.from)} yet, so we cannot use this road to reach ${name(e.node)}.`:`Reaching ${name(e.from)} costs ${cost(e.gu)}. This road adds ${cost(e.w)}, making ${cost(e.candidate)} in total. `+(e.updated?`Previously: ${unknown(e.old)}. Keep this better connection; the gold road shows it.${bellman?' A later pass may improve it again.':''}`:`The best known cost is already ${cost(e.old)}, so keep the existing connection.`)};
  if(e.kind==='pass')return {title:`Check all roads · round ${e.pass}`,text:'Bellman–Ford tests each open road in both directions. A gold junction has a known route, but its cost can still improve. One round means checking all roads once.'};
  if(e.kind==='pass-end')return {title:e.updates?'Some routes improved':'No route improved — ready to finish',text:e.updates?`${e.updates} costs improved in this round. Check all roads again to see whether those improvements help other junctions.`:'A complete round found no cheaper connections. The known costs are now confirmed.'};
  if(e.kind==='stale')return {title:'Skip an old suggestion',text:`An older suggestion for ${name(e.node)} is no longer useful. A better route was found, or this junction has already been completed.`};
  if(e.kind==='finish'){
    const nodes=player.path().nodes,route=nodes.length<=7?nodes.map(name).join(' → '):`${name(player.source)} → ${nodes.length-2} junctions → ${name(player.target)}`;
    return {title:player.source===player.target?'You are already at the destination':'Follow the thick orange route',text:player.source===player.target?'The start and destination are the same, so no walking is needed.':`The lowest total cost is ${cost(e.g)}. ${route}. Other colored roads were explored; they are not all part of your walk.`};
  }
  return {title:'Follow the search',text:'Use Next to inspect the next decision.'};
}

// Plain-language explanation of the most recent step. name(v) labels a node; cost(x)
// formats a cost (and must render Infinity as ∞).
export function describe(player,name,cost) {
  const s=player.state,e=s.last,m=player.method,astar=m==='astar',bellman=m==='bellman';
  const grouped=e.skipped?` Before this step, ${e.skipped.toLocaleString('en-IN')} edge check${e.skipped>1?'s':''} found no improvement (grouped in this compact trace).`:'';
  const staleNote=e.stalePopped?` ${e.stalePopped} outdated heap entr${e.stalePopped>1?'ies were':'y was'} discarded first.`:'';
  const out={line:1,title:'',text:'',calc:null,updated:null};
  switch(e.kind) {
    case 'init':
      out.title='Initialise';out.line=1;
      out.text=`g(${name(player.source)}) = 0. Every other node starts at ∞ with no predecessor.`+(bellman?' Bellman–Ford will relax every open directed lane in passes.':astar?` The heap starts with ${name(player.source)} at f = 0 + h = ${cost(player.h(player.source))}.`:` The heap starts with ${name(player.source)} at key 0.`);
      break;
    case 'visit':
      out.line=e.target?6:5;out.title=`${astar?'Select smallest f':'Select smallest g'}: ${name(e.node)}`;
      out.text=astar
        ?`${name(e.node)} has the smallest f = g + h = ${cost(e.g)} + ${cost(e.h)} = ${cost(e.g+e.h)} among tentative nodes. Because h never overestimates and is consistent, g(${name(e.node)}) = ${cost(e.g)} is now final.`
        :`${name(e.node)} has the smallest tentative distance, g = ${cost(e.g)}. Greedy choice: with nonnegative weights, no later path can reach it more cheaply, so it is settled.`;
      if(e.target)out.text+=` It is the destination, so the search stops.`;
      out.text+=staleNote+grouped;
      break;
    case 'stale':
      out.line=4;out.title=`Discard outdated heap entry for ${name(e.node)}`;
      out.text=`The heap still held ${name(e.node)} with g = ${cost(e.g)}, but ${e.settled?`${name(e.node)} is already settled`:`a cheaper g = ${cost(e.known)} was found later`}. A binary heap cannot decrease a key in place, so the old entry is skipped.`;
      break;
    case 'check': case 'relax': {
      out.line=bellman?(e.updated?5:4):(e.updated?9:8);
      out.title=`${e.updated?'Relax':'Check'} ${name(e.from)} → ${name(e.node)}`;
      out.calc={from:e.from,to:e.node,w:e.w,gu:e.gu,old:e.old,candidate:e.candidate,updated:e.updated};
      out.updated=e.updated;
      if(!Number.isFinite(e.gu))out.text=`g(${name(e.from)}) is still ∞, so this lane cannot improve ${name(e.node)} yet.`;
      else if(e.updated)out.text=`candidate = g(${name(e.from)}) + w = ${cost(e.gu)} + ${cost(e.w)} = ${cost(e.candidate)}, which is less than the old g(${name(e.node)}) = ${cost(e.old)}. Update: g(${name(e.node)}) ← ${cost(e.candidate)}, pred(${name(e.node)}) ← ${name(e.from)}.`+(bellman?'':astar?` Push with f = ${cost(e.candidate)} + h ${cost(e.h)} = ${cost(e.candidate+e.h)}.`:` Push with key ${cost(e.candidate)}.`);
      else out.text=`candidate = ${cost(e.gu)} + ${cost(e.w)} = ${cost(e.candidate)}, which is not less than g(${name(e.node)}) = ${cost(e.old)}. No update.`;
      if(bellman)out.text=`Pass ${e.pass}. `+out.text+(e.updated?' This g may still improve in a later pass.':'');
      out.text+=grouped;
      break;
    }
    case 'pass':
      out.line=2;out.title=`Pass ${e.pass} begins`;
      out.text=`Check every open lane in both directions, in the same fixed order. Reached nodes are not settled: any g can still decrease in this or a later pass.`;
      break;
    case 'pass-end':
      out.line=6;out.title=e.updates?`Pass ${e.pass} complete: ${e.updates} update${e.updates>1?'s':''}`:`Pass ${e.pass} changed nothing: stop early`;
      out.text=e.updates?`${e.checks.toLocaleString('en-IN')} directed checks, ${e.updates} improved. Another pass is needed.`:`All ${e.checks.toLocaleString('en-IN')} directed checks failed to improve any g, so no later pass could either. Every g is now final, after ${e.pass} of at most V − 1 = ${player.n-1} passes.`;
      out.text+=grouped;
      break;
    case 'finish': {
      out.line=bellman?7:10;out.title='Shortest path found';
      const p=player.path();
      const route=p.nodes.length>7?[...p.nodes.slice(0,2).map(name),`… ${p.nodes.length-4} more junctions …`,...p.nodes.slice(-2).map(name)]:p.nodes.map(name);
      out.text=`Follow predecessors back from ${name(player.target)}: ${route.join(' → ')}. ${p.edges.length} lane${p.edges.length===1?'':'s'}, minimum cost ${cost(e.g)}.`;
      if(player.source===player.target)out.text=`Source and destination are the same node, so the minimum cost is 0 and the path has no lanes.`;
      break;
    }
    case 'exhausted':
      out.line=2;out.title='Heap empty: destination unreachable';
      out.text=`No tentative node remains. ${name(player.target)} still has g = ∞, so open lanes do not connect it to ${name(player.source)}.`+staleNote+grouped;
      break;
  }
  if(player.length&&s.step===player.length&&bellman&&!player.run.reachable)out.text+=` ${name(player.target)} kept g = ∞: it is unreachable.`;
  return out;
}
