// A small weighted teaching example for edge-by-edge explanations. It is not part of
// the Pune map. It uses the same graph shape as data/map.json, so the same engine
// (makeGraph + shortestPath) runs on it. Coordinates are in metres on a flat plane.
import {makeGraph,shortestPath,algorithms} from './engine.mjs';

const positions={A:[0,150],B:[90,60],C:[100,230],D:[200,40],E:[210,150],F:[200,270],G:[310,80],H:[320,220],I:[60,330],J:[-40,40],K:[420,150]};
const letters=Object.keys(positions);
// Edge order matters for Bellman–Ford: lanes far from A are listed first, so the
// fixed-order passes need several rounds before a pass changes nothing.
// Each length is at least the straight-line distance, keeping the A* heuristic consistent.
const lanes=[['G','K',135],['H','K',123],['D','G',118],['E','G',123],['E','H',131],['F','H',130],['B','D',112],['B','E',175],['C','E',137],['C','F',108],['I','F',153],['J','B',132],['A','B',130],['A','C',160],['A','J',118],['A','I',190],['A','E',300]];

export const teachingData={
  metadata:{source:'Teaching example',note:'Illustrative graph for classroom explanation. Not a Pune street map.'},
  nodes:letters.map(id=>({id,label:id,x:positions[id][0],y:positions[id][1]})),
  edges:lanes.map(([a,b,length])=>({a:letters.indexOf(a),b:letters.indexOf(b),length,name:`${a}–${b}`,kind:'teaching',points:[positions[a],positions[b]]})),
  roads:[],buildings:[],parks:[],places:[]
};

const edgeId=(a,b)=>teachingData.edges.findIndex(e=>e.name===`${a}–${b}`);
export const teachingScenarios={
  open:{label:'All lanes open',closed:[]},
  detour:{label:'Lane D–G closed (detour)',closed:[edgeId('D','G')]},
  isolated:{label:'K cut off (unreachable)',closed:[edgeId('G','K'),edgeId('H','K')]}
};
export const teachingDefaults={source:0,target:letters.indexOf('K'),scenario:'open'};

export function teachingGraph(settings={}) {
  const scenario=teachingScenarios[settings.scenario]||teachingScenarios.open;
  return makeGraph(teachingData,{objective:'distance',crowd:0,closed:scenario.closed});
}

// Runs all three algorithms on the same teaching graph with full traces.
export function runTeaching(settings={}) {
  const source=settings.source??teachingDefaults.source,target=settings.target??teachingDefaults.target;
  const graph=teachingGraph(settings),runs={};
  for(const method of algorithms)runs[method]=shortestPath(graph,source,target,method,'full');
  return {settings:{source,target,scenario:settings.scenario||'open'},runs};
}
