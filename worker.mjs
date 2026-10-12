import {planJourney} from './engine.mjs';
import {runTeaching} from './teaching-graph.mjs';
self.onmessage=({data:{id,kind,data,settings}})=>{
  try {self.postMessage({id,result:kind==='teaching'?runTeaching(settings):planJourney(data,settings)});}
  catch(e){self.postMessage({id,error:e.message});}
};
