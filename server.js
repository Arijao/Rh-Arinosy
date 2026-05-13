// ============================================================
// server.js — Serveur WebSocket HTTP local (port 8765)
// smartphone.html est servi par Vercel (HTTPS)
// Ce serveur gère uniquement le WebSocket LAN local
//
// Usage: node server.js
// ============================================================

const http = require('http');
const { WebSocketServer } = require('ws');

const WS_PORT = 8765;

// ── État global ───────────────────────────────────────────────
let smartphoneClient = null;
let pcClient         = null;

// ── Serveur HTTP minimal (health check) ──────────────────────
const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('RemoteCamera WebSocket Server — OK\n');
});

// ── Serveur WebSocket ─────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(WS_PORT, '0.0.0.0', () => {
  console.log('='.repeat(60));
  console.log('  Serveur RemoteCamera — Système Présence LAN Offline');
  console.log('='.repeat(60));
  console.log(`  WebSocket : ws://192.168.101.14:${WS_PORT}`);
  console.log('');
  console.log('  Sur le smartphone, ouvrez Vercel :');
  console.log('  → https://rh-arinosy.vercel.app/smartphone.html');
  console.log('');
  console.log('  Puis saisissez : ws://192.168.101.14:8765');
  console.log('='.repeat(60));
});

// ── Gestion des connexions ────────────────────────────────────
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`🔗 Nouvelle connexion : ${clientIp}`);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch (_) { return; }
    handleMessage(ws, msg, clientIp);
  });

  ws.on('close', () => {
    if (ws === smartphoneClient) {
      smartphoneClient = null;
      console.log('📱 Smartphone déconnecté');
      safeSend(pcClient, { type: 'smartphone_disconnected' });
    }
    if (ws === pcClient) {
      pcClient = null;
      console.log('💻 PC déconnecté');
    }
  });

  ws.on('error', (err) => console.warn(`[WS] ${err.message}`));
});

// ── Gestion des messages ──────────────────────────────────────
function handleMessage(ws, msg, clientIp) {
  switch (msg.type) {

    case 'identify':
      if (msg.role === 'smartphone') {
        smartphoneClient = ws;
        console.log(`📱 Smartphone identifié : ${clientIp}`);
        safeSend(ws, {
          type: 'identified',
          role: 'smartphone',
          server_time: new Date().toISOString()
        });
        safeSend(pcClient, { type: 'smartphone_connected', client_id: clientIp });
      } else if (msg.role === 'pc') {
        pcClient = ws;
        console.log(`💻 PC identifié : ${clientIp}`);
        safeSend(ws, {
          type: 'identified',
          role: 'pc',
          server_time: new Date().toISOString(),
          smartphone_connected: isAlive(smartphoneClient),
        });
      }
      break;

    case 'qr_result':
      console.log(`📷 QR scanné : ${msg.data}`);
      if (isAlive(pcClient)) safeSend(pcClient, { ...msg, source: 'smartphone' });
      else safeSend(ws, { type: 'error', message: 'PC non connecté' });
      break;

    case 'face_data':
      if (isAlive(pcClient)) safeSend(pcClient, { ...msg, source: 'smartphone' });
      break;

    case 'face_frame':
      if (isAlive(pcClient)) safeSend(pcClient, { ...msg, source: 'smartphone' });
      break;

    case 'ack':
      safeSend(smartphoneClient, msg);
      break;

    case 'ping':
      safeSend(ws, { type: 'pong', ts: new Date().toISOString() });
      break;
  }
}

// ── Helpers ───────────────────────────────────────────────────
function safeSend(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}
function isAlive(ws) {
  return ws && ws.readyState === ws.OPEN;
}

// ── Arrêt propre ──────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n🛑 Arrêt du serveur...');
  wss.close(); httpServer.close();
  process.exit(0);
});
