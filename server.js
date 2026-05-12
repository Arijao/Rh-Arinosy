// ============================================================
// server.js — Serveur local LAN offline (HTTPS + WSS)
// HTTPS requis pour getUserMedia (caméra) sur Chrome Android
//
// Prérequis — certificat généré avec :
//   openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem \
//     -days 365 -nodes -subj "/CN=192.168.101.14"
//
// Usage: node server.js
// ============================================================

const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const { WebSocketServer } = require('ws');

const PORT = 8766;   // HTTPS + WSS sur le même port
const DIR  = __dirname;

// ── Certificat SSL ────────────────────────────────────────────
let sslOptions;
try {
  sslOptions = {
    key:  fs.readFileSync(path.join(DIR, 'key.pem')),
    cert: fs.readFileSync(path.join(DIR, 'cert.pem')),
  };
  console.log('🔒 Certificat SSL chargé');
} catch (e) {
  console.error('❌ Certificat SSL introuvable.');
  console.error('   Lancez : openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=192.168.101.14"');
  process.exit(1);
}

// ── État global ───────────────────────────────────────────────
let smartphoneClient = null;
let pcClient         = null;

// ── MIME types ────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.mp3':  'audio/mpeg',
  '.woff2':'font/woff2',
  '.bin':  'application/octet-stream',
};

// ── Serveur HTTPS ─────────────────────────────────────────────
const server = https.createServer(sslOptions, (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/smartphone.html';

  const filePath = path.join(DIR, urlPath);
  if (!filePath.startsWith(DIR)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end(`Non trouvé: ${urlPath}`); return; }
    const mime = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

// ── WebSocket sur le même serveur HTTPS (wss://) ─────────────
const wss = new WebSocketServer({ server });

server.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(60));
  console.log('  Serveur RemoteCamera — Système Présence LAN Offline');
  console.log('='.repeat(60));
  console.log(`  HTTPS : https://192.168.101.14:${PORT}/smartphone.html`);
  console.log(`  WSS   : wss://192.168.101.14:${PORT}`);
  console.log('');
  console.log('  ⚠ Sur Chrome Android :');
  console.log('    1. Ouvrez l\'URL HTTPS ci-dessus');
  console.log('    2. Appuyez sur "Paramètres avancés" → "Continuer"');
  console.log('    3. La caméra fonctionnera après acceptation du certificat');
  console.log('='.repeat(60));
});

// ── Gestion des connexions WebSocket ─────────────────────────
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
        safeSend(ws, { type: 'identified', role: 'smartphone', server_time: new Date().toISOString() });
        safeSend(pcClient, { type: 'smartphone_connected', client_id: clientIp });
      } else if (msg.role === 'pc') {
        pcClient = ws;
        console.log(`💻 PC identifié : ${clientIp}`);
        safeSend(ws, {
          type: 'identified', role: 'pc',
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
  wss.close(); server.close();
  process.exit(0);
});
