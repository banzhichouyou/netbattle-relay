// 联机对战 - 轻量中继服务器（同时托管静态页面 → 同源 WebSocket）
// 运行：node server.js   （PORT 环境变量可改端口，默认 8787）
// 然后浏览器打开 http://localhost:8787 即自动连接同源 WebSocket，无需手填地址。
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8787;
const ROOT = path.join(__dirname, 'deploy');           // 静态托管 deploy/（含 index.html）
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif',
  '.svg':'image/svg+xml', '.json':'application/json', '.ico':'image/x-icon', '.woff2':'font/woff2' };

// ---- HTTP：静态托管（让 ws 与页面同源，避免 https/ws 混合内容被拦截）+ 健康检查 ----
const server = http.createServer((req, res) => {
  if (req.url === '/healthz'){ res.writeHead(200, {'Content-Type':'text/plain'}); res.end('ok'); return; }
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)){ res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err){ res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});
      res.end('404 not found（请在本项目目录运行 node server.js，且存在 deploy/index.html）'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---- WebSocket：房间管理 + 消息转发（不跑游戏逻辑）----
const wss = new WebSocket.Server({ server });
const rooms = new Map();                 // code -> { host, guest, code }

function genCode(){ let c; do { c = Math.random().toString(36).slice(2, 8).toUpperCase(); } while (rooms.has(c)); return c; }
function send(ws, obj){ if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function peerOf(ws, r){ if (!r) return null; return ws.meta.role === 'host' ? r.guest : r.host; }

wss.on('connection', (ws) => {
  ws.meta = { room: null, role: null };
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const r = ws.meta.room ? rooms.get(ws.meta.room) : null;
    if (m.t === 'create'){
      const code = genCode();
      rooms.set(code, { host: ws, guest: null, code });
      ws.meta = { room: code, role: 'host' };
      send(ws, { t: 'created', code });
    }
    else if (m.t === 'join'){
      const room = rooms.get((m.code || '').toUpperCase());
      if (!room){ send(ws, { t: 'error', msg: '房间不存在' }); return; }
      if (room.guest){ send(ws, { t: 'error', msg: '房间已满' }); return; }
      room.guest = ws;
      ws.meta = { room: room.code, role: 'guest' };
      send(ws, { t: 'joined', code: room.code });
      send(room.host, { t: 'peer' });
    }
    else if (m.t === 'start'){ send(peerOf(ws, r), { t: 'start' }); send(ws, { t: 'start' }); }
    else if (m.t === 'ping'){ send(peerOf(ws, r), { t: 'pong', ts: m.ts }); }
    else if (m.t === 'op' || m.t === 'state'){ send(peerOf(ws, r), m); }
  });
  ws.on('close', () => {
    const r = ws.meta.room ? rooms.get(ws.meta.room) : null;
    if (!r) return;
    send(peerOf(ws, r), { t: 'peerLeft' });
    if (ws.meta.role === 'host') rooms.delete(r.code);
    else if (r.host) r.guest = null;
  });
});

server.listen(PORT, () => console.log('[NetBattle] 已启动：浏览器打开 http://localhost:' + PORT + ' （同源 WebSocket 已就绪）'));
