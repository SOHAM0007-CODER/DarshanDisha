// Algorithm core: no rendering or browser dependencies. All costs are nonnegative.
export const WALK_SPEED = 1.25;
export const algorithms = ['dijkstra', 'bellman', 'astar'];
export const names = { dijkstra: 'Dijkstra', bellman: 'Bellman–Ford', astar: 'A*' };
const hypot = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);

class Heap {
  items=[];
  push(item) { const a=this.items; a.push(item); let i=a.length-1; while(i>0) {const p=(i-1)>>1; if(a[p].priority<=item.priority) break; a[i]=a[p];i=p;}a[i]=item; }
  pop() {const a=this.items, top=a[0], last=a.pop();if(a.length){let i=0;while(true){let c=i*2+1;if(c>=a.length)break;if(c+1<a.length&&a[c+1].priority<a[c].priority)c++;if(last.priority<=a[c].priority)break;a[i]=a[c];i=c;}a[i]=last;}return top;}
}

export function makeGraph(data, settings={}) {
  const closed=new Set(settings.closed||[]), crowd=Math.max(0,Math.min(100,settings.crowd||0))/100;
  const hotspots=data.places.filter(p=>['dagdu','tulshi','guruji','tambdi','babu'].includes(p.id));
  const adj=data.nodes.map(()=>[]);
  const edges=data.edges.map((e,id)=>{
    const a=data.nodes[e.a],b=data.nodes[e.b],x=(a.x+b.x)/2,y=(a.y+b.y)/2;
    const pressure=Math.max(0,...hotspots.map(p=>Math.exp(-((x-p.x)**2+(y-p.y)**2)/(2*85**2))));
    // Scenario bottlenecks: named central corridors receive an extra simulated slowdown.
    // These are educational assumptions, not claims about measured festival traffic.
    const corridor=/Ram Ganesh Gadkari|Ganesh Path|Shamsing Pardeshi|Laxmi Path/i.test(e.name)?2.8:0;
    const multiplier=1+crowd*(0.2+pressure*4+corridor);
    const seconds=e.length/WALK_SPEED*multiplier;
    const edge={...e,id,multiplier,seconds,weight:settings.objective==='time'?seconds:e.length,closed:closed.has(id)};
    if(!edge.closed){adj[e.a].push({to:e.b,edge:id});adj[e.b].push({to:e.a,edge:id});}
    return edge;
  });
  return {nodes:data.nodes,edges,adj,objective:settings.objective||'distance'};
}

// h(v) for A*: straight-line distance to the target, divided by the maximum walking
// speed in time mode. Other methods use h = 0. Shared with the replay inspector.
export function heuristic(graph,target,method='astar') {
  if(method!=='astar')return ()=>0;
  const t=graph.nodes[target],speed=graph.objective==='time'?WALK_SPEED:1;
  return v=>hypot(graph.nodes[v],t)/speed;
}

// record: false (no trace), true / 'compact' (selections, successful updates and pass
// boundaries; unsuccessful edge checks and stale heap entries are counted on the next
// event as `skipped` / `stale`), or 'full' (every edge check and stale heap entry as its
// own event, intended for small teaching graphs).
export function shortestPath(graph,source,target,method='dijkstra',record=true) {
  const began=performance.now(), n=graph.nodes.length, full=record==='full';
  const distance=new Float64Array(n).fill(Infinity),previous=new Int32Array(n).fill(-1),previousEdge=new Int32Array(n).fill(-1);
  const trace=[], touched=new Set([source]);let checks=0,updates=0,expanded=0,passes=0,stale=0,skipped=0,staleRun=0;
  distance[source]=0;
  const event=e=>{if(!record)return;if(skipped){e.skipped=skipped;skipped=0;}if(staleRun){e.stale=staleRun;staleRun=0;}trace.push(e);};
  const miss=e=>{if(full)event(e);else skipped++;};
  if(method==='bellman') {
    for(let pass=1;pass<n;pass++) {
      let changed=0,passChecks=0;passes=pass;event({type:'pass',pass});
      for(const e of graph.edges) {
        if(e.closed)continue;
        for(const [u,v] of [[e.a,e.b],[e.b,e.a]]) {
          checks++;passChecks++;
          if(distance[u]+e.weight<distance[v]-1e-9) {
            distance[v]=distance[u]+e.weight;previous[v]=u;previousEdge[v]=e.id;updates++;changed++;touched.add(v);
            event({type:'relax',node:v,from:u,edge:e.id,cost:distance[v],pass});
          } else miss({type:'check',node:v,from:u,edge:e.id,pass});
        }
      }
      event({type:'pass-end',pass,updates:changed,checks:passChecks});
      if(!changed)break;
    }
    expanded=touched.size;
  } else {
    const h=heuristic(graph,target,method);
    const heap=new Heap(),done=new Uint8Array(n);heap.push({node:source,priority:h(source),g:0});
    while(heap.items.length) {
      const item=heap.pop(),u=item.node;
      if(done[u]||item.g>distance[u]+1e-9){stale++;if(full)event({type:'stale',node:u,g:item.g,priority:item.priority});else staleRun++;continue;}
      done[u]=1;expanded++;event({type:'visit',node:u,cost:distance[u],heap:heap.items.length});
      if(u===target)break;
      for(const {to:v,edge:id} of graph.adj[u]) {
        checks++;const e=graph.edges[id],candidate=distance[u]+e.weight;
        if(candidate<distance[v]-1e-9) {
          distance[v]=candidate;previous[v]=u;previousEdge[v]=id;updates++;touched.add(v);
          heap.push({node:v,priority:candidate+h(v),g:candidate});event({type:'relax',node:v,from:u,edge:id,cost:candidate});
        } else miss({type:'check',node:v,from:u,edge:id});
      }
    }
    if(!done[target])event({type:'exhausted'});
  }
  const base={source,target,method,detail:full?'full':record?'compact':'none',trace};
  const metrics=()=>({checks,updates,expanded,passes,stale,ms:performance.now()-began});
  if(!Number.isFinite(distance[target]))return {...base,reachable:false,cost:Infinity,path:[],edgeIds:[],metrics:metrics()};
  const path=[target],edgeIds=[];let u=target;
  while(u!==source) {if(previous[u]<0||path.length>n)throw new Error('Invalid predecessor chain');edgeIds.push(previousEdge[u]);u=previous[u];path.push(u);}
  path.reverse();edgeIds.reverse();
  const metres=edgeIds.reduce((s,id)=>s+graph.edges[id].length,0),seconds=edgeIds.reduce((s,id)=>s+graph.edges[id].seconds,0);
  event({type:'finish',node:target,cost:distance[target]});
  return {...base,reachable:true,cost:distance[target],path,edgeIds,metres,seconds,metrics:metrics()};
}

export function permutations(items) {
  if(!items.length)return [[]];
  return items.flatMap((v,i)=>permutations(items.filter((_,j)=>i!==j)).map(rest=>[v,...rest]));
}

export function geometry(graph,result) {
  const points=[];
  result.edgeIds.forEach((id,i)=>{
    const e=graph.edges[id],part=e.a===result.path[i]?e.points:[...e.points].reverse();
    points.push(...(points.length?part.slice(1):part));
  });
  if(!points.length&&result.path.length){const p=graph.nodes[result.path[0]];points.push([p.x,p.y]);}
  return points;
}

export function planJourney(data,settings) {
  const places=Object.fromEntries(data.places.map(p=>[p.id,p]));
  const graph=makeGraph(data,settings),cache=new Map();
  const path=(s,t)=>{const key=s+'|'+t;if(!cache.has(key))cache.set(key,shortestPath(graph,places[s].node,places[t].node,'dijkstra',false));return cache.get(key);};
  const cost=ids=>ids.slice(1).reduce((s,id,i)=>s+path(ids[i],id).cost,0);
  const mains=data.places.filter(p=>p.rank).sort((a,b)=>a.rank-b.rank).map(p=>p.id);
  const extras=[...new Set(settings.extras||[])].filter(id=>places[id]&&id!==settings.start);
  let order;
  if(settings.mode==='all') {
    const required=[...new Set([...mains,...extras])].filter(id=>id!==settings.start);
    if(settings.order==='traditional') {
      order=[settings.start,...mains.filter(id=>id!==settings.start)];
      for(const id of extras.filter(id=>!order.includes(id))) {
        let best=null,bestCost=Infinity;
        for(let i=1;i<=order.length;i++){const candidate=[...order.slice(0,i),id,...order.slice(i)],c=cost(candidate);if(c<bestCost){bestCost=c;best=candidate;}}
        order=best||[...order,id];
      }
    } else {
      let best=Infinity;
      for(const p of permutations(required)){const candidate=[settings.start,...p],c=cost(candidate);if(c<best){best=c;order=candidate;}}
      order??=[settings.start,...required];
    }
  } else {
    const extra=extras.filter(id=>id!==settings.destination);let best=Infinity;
    for(const p of permutations(extra)){const candidate=[settings.start,...p,settings.destination].filter((id,i,arr)=>!i||id!==arr[i-1]),c=cost(candidate);if(c<best){best=c;order=candidate;}}
    order??=[settings.start,settings.destination];
  }
  const result={order,settings,comparisons:{},suggestions:[],graphSummary:{nodes:graph.nodes.length,edges:graph.edges.filter(e=>!e.closed).length}};
  for(const method of algorithms) {
    const legs=order.slice(1).map((id,i)=>shortestPath(graph,places[order[i]].node,places[id].node,method,true));
    const reachable=legs.every(l=>l.reachable);
    result.comparisons[method]={reachable,legs,cost:legs.reduce((s,l)=>s+l.cost,0),metres:legs.reduce((s,l)=>s+(l.metres||0),0),seconds:legs.reduce((s,l)=>s+(l.seconds||0),0),metrics:legs.reduce((m,l)=>({checks:m.checks+l.metrics.checks,updates:m.updates+l.metrics.updates,expanded:m.expanded+l.metrics.expanded,passes:m.passes+l.metrics.passes,ms:m.ms+l.metrics.ms}),{checks:0,updates:0,expanded:0,passes:0,ms:0}),points:legs.flatMap((l,i)=>geometry(graph,l).slice(i?1:0))};
  }
  result.reachable=result.comparisons.dijkstra.reachable;
  if(order.length===1)for(const r of Object.values(result.comparisons))r.points=[[places[order[0]].x,places[order[0]].y]];
  if(!result.reachable)return result;
  const base=result.comparisons.dijkstra;
  if(extras.length<2) {
    for(const p of data.places.filter(p=>p.type!=='start'&&!order.includes(p.id))) {
      let best=null;
      for(let i=1;i<order.length;i++) {
        const first=path(order[i-1],p.id),second=path(p.id,order[i]),old=path(order[i-1],order[i]);
        if(!first.reachable||!second.reachable)continue;
        const detourCost=first.cost+second.cost-old.cost,metres=first.metres+second.metres-old.metres,seconds=first.seconds+second.seconds-old.seconds;
        if(!best||detourCost<best.cost)best={id:p.id,cost:detourCost,metres:Math.max(0,metres),seconds:Math.max(0,seconds),position:i};
      }
      if(best&&best.metres<=400&&best.seconds<=480)result.suggestions.push(best);
    }
    result.suggestions.sort((a,b)=>a.cost-b.cost);result.suggestions=result.suggestions.slice(0,2);
  }
  // Alternatives hold the same accepted itinerary, so only the route objective differs.
  const distanceGraph=makeGraph(data,{...settings,objective:'distance'}),timeGraph=makeGraph(data,{...settings,objective:'time'});
  const alternative=g=>{
    const legs=order.slice(1).map((id,i)=>shortestPath(g,places[order[i]].node,places[id].node,'astar',false));
    return {metres:legs.reduce((s,l)=>s+(l.metres||0),0),seconds:legs.reduce((s,l)=>s+(l.seconds||0),0),points:legs.flatMap((l,i)=>geometry(g,l).slice(i?1:0)),edgeIds:legs.flatMap(l=>l.edgeIds)};
  };
  result.distanceRoute=alternative(distanceGraph);result.timeRoute=alternative(timeGraph);
  result.traditionalCost=settings.mode==='all'?cost([settings.start,...mains.filter(id=>id!==settings.start)]):null;
  result.crowdEdges=graph.edges.filter(e=>e.multiplier>1.7&&!e.closed).map(e=>({id:e.id,level:e.multiplier}));
  return result;
}
