import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { prepareData, webRoot } from './prepare-data.mjs';

const dist = resolve(webRoot, 'dist');
if (!existsSync(resolve(dist, 'index.html'))) throw Error('Run npm run build first');
prepareData();
setInterval(() => prepareData(), 5000).unref();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
createServer((req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const root = path.startsWith('/data/') ? resolve(webRoot, 'public') : dist;
    let file = resolve(root, '.' + path);
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if (!existsSync(file) || !statSync(file).isFile()) {
      if (extname(path)) { res.writeHead(404).end(); return; }
      file = resolve(dist, 'index.html');
    }
    res.writeHead(200, { 'Content-Type': (mime[extname(file)] ?? 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  } catch { res.writeHead(400).end(); }
}).listen(Number(process.env.PORT ?? 4173), '127.0.0.1', () => console.log(`Benchmark dashboard: http://127.0.0.1:${process.env.PORT ?? 4173}`));
