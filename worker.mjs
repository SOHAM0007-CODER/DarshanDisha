import {planJourney} from './engine.mjs';
self.onmessage=({data:{id,data,settings}})=>{
  try {self.postMessage({id,result:planJourney(data,settings)});}
  catch(e){self.postMessage({id,error:e.message});}
};
