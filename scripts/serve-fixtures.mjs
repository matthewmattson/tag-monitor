// Minimal static server for the deliberately broken demo pages in ./fixtures.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const port = 4173;

http
  .createServer((request, response) => {
    const name = path.basename(new URL(request.url, 'http://localhost').pathname);
    const file = path.join(root, name);
    if (!name.endsWith('.html') || !fs.existsSync(file)) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    fs.createReadStream(file).pipe(response);
  })
  .listen(port, () => console.log(`Serving ${root} on http://localhost:${port}`));
