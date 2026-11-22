// 見比べる1枚（compare.html）を開き、書いた感想をファイルへ残すための、手元だけのサーバ。
//   node compare/serve.mjs --work <作業フォルダ> [--port 5188] [--open]
// 感想は <作業フォルダ>/feedback/<周>.json に入る。外へは何も送らない。127.0.0.1 だけで待つ。
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const port = Number(opt('port', '5188'));
const work = path.resolve(opt('work', '.'));
const fileOf = (round) => path.join(work, 'feedback', `${String(round).replace(/[^\w-]/g, '')}.json`);
const roundOf = () => readFileSync(path.join(work, 'compare.html'), 'utf8').match(/"round":"([\w-]+)"/)?.[1] ?? 'round';

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
};

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && (pathname === '/' || pathname === '/compare.html')) {
    send(res, 200, readFileSync(path.join(work, 'compare.html')), 'text/html; charset=utf-8');
    return;
  }
  if (pathname === '/feedback' && req.method === 'GET') {
    const file = fileOf(roundOf());
    send(res, 200, existsSync(file) ? readFileSync(file) : 'null');
    return;
  }
  if (pathname === '/feedback' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => {
      body += d;
      if (body.length > 5e6) req.destroy();
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const file = fileOf(data.round);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`);
        send(res, 200, JSON.stringify({ file: `feedback/${path.basename(file)}` }));
      } catch (e) {
        send(res, 400, JSON.stringify({ error: String(e) }));
      }
    });
    return;
  }
  send(res, 404, '{}');
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}/`;
  console.log(`${url}  感想の保存先: ${fileOf(roundOf())}`);
  if (args.includes('--open')) spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
});
