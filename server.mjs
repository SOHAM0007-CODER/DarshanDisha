import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),port=Number(process.env.PORT||5173);
const types={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.md':'text/plain'};
http.createServer(async(req,res)=>{
  try {const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const filename=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!filename.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}const body=await readFile(filename);res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(body);}
  catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Local: http://localhost:${port}`));
