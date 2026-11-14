import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.png': 'image/png', '.ics': 'text/calendar', '.woff2': 'font/woff2' };

createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  const file = resolve(root, '.' + pathname);
  if (!file.startsWith(root) && file + '/' !== root) {
    response.writeHead(404).end();
    return;
  }
  let body = await readFile(file).catch(() => undefined);
  let type = types[extname(file)] || 'text/plain';
  if (!body && !extname(pathname) && !pathname.startsWith('/api/')) {
    body = await readFile(resolve(root, 'index.html'));
    type = 'text/html';
  }
  response.writeHead(body ? 200 : 404, { 'Content-Type': type }).end(body);
}).listen(Number(process.env.DEMO_PORT ?? 4174), '127.0.0.1');
