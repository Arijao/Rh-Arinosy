// ============================================================
// server.js — Serveur local LAN offline
// WebSocket (port 8765) + HTTP (port 8766)
// Node.js v20+ — fonctionne dans Crostini avec port forwarding
//
// Usage: node server.js
// ============================================================

const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const { WebSocketServer } = require('ws');

const WS_PORT   = 8765;
const HTTP_PORT = 8766;
const DIR       = __dirname;

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

// ── Serveur HTTP ──────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  // CORS pour le LAN
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-cache');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Route par défaut → smartphone.html
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/smartphone.html';

  const filePath = path.join(DIR, urlPath);

  // Sécurité : rester dans le dossier du projet
  if (!filePath.startsWith(DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end(`Fichier non trouvé: ${urlPath}`);
      return;
    }

    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`🌐 Serveur HTTP démarré sur le port ${HTTP_PORT}`);
});

// ── Serveur WebSocket ─────────────────────────────────────────
const wss = new WebSocketServer({ port: WS_PORT });

wss.on('listening', () => {
  console.log(`🔌 Serveur WebSocket démarré sur le port ${WS_PORT}`);
  printBanner();
});

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`🔗 Nouvelle connexion : ${clientIp}`);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (_) {
      console.warn(`[WS] Message non-JSON de ${clientIp}`);
      return;
    }

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
    console.log(`🔌 Connexion fermée : ${clientIp}`);
  });

  ws.on('error', (err) => {
    console.warn(`[WS] Erreur client ${clientIp}:`, err.message);
  });
});

// ── Gestion des messages ──────────────────────────────────────
function handleMessage(ws, msg, clientIp) {
  switch (msg.type) {

    case 'identify':
      if (msg.role === 'smartphone') {
        smartphoneClient = ws;
        console.log(`📱 Smartphone identifié : ${clientIp}`);
        safeSend(ws, {
          type:        'identified',
          role:        'smartphone',
          server_time: new Date().toISOString(),
        });
        safeSend(pcClient, { type: 'smartphone_connected', client_id: clientIp });

      } else if (msg.role === 'pc') {
        pcClient = ws;
        console.log(`💻 PC identifié : ${clientIp}`);
        safeSend(ws, {
          type:                 'identified',
          role:                 'pc',
          server_time:          new Date().toISOString(),
          smartphone_connected: isAlive(smartphoneClient),
        });
      }
      break;

    case 'qr_result':
      console.log(`📷 QR scanné : ${msg.data}`);
      if (isAlive(pcClient)) {
        safeSend(pcClient, { ...msg, source: 'smartphone' });
      } else {
        safeSend(ws, { type: 'error', message: 'PC non connecté' });
      }
      break;

    case 'face_data':
      if (isAlive(pcClient)) {
        safeSend(pcClient, { ...msg, source: 'smartphone' });
      }
      break;

    case 'face_frame':
      if (isAlive(pcClient)) {
        safeSend(pcClient, { ...msg, source: 'smartphone' });
      }
      break;

    case 'ack':
      safeSend(smartphoneClient, msg);
      break;

    case 'ping':
      safeSend(ws, { type: 'pong', ts: new Date().toISOString() });
      break;

    case 'status':
      safeSend(ws, {
        type:                 'status_response',
        smartphone_connected: isAlive(smartphoneClient),
        pc_connected:         isAlive(pcClient),
        clients_count:        wss.clients.size,
        server_time:          new Date().toISOString(),
      });
      break;

    default:
      break;
  }
}

// ── Helpers ───────────────────────────────────────────────────
function safeSend(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function isAlive(ws) {
  return ws && ws.readyState === ws.OPEN;
}

function printBanner() {
  console.log('='.repeat(60));
  console.log('  Serveur RemoteCamera — Système Présence LAN Offline');
  console.log('='.repeat(60));
  console.log('  Sur le smartphone Android, ouvrez Chrome et accédez à :');
  console.log(`  → http://192.168.101.14:${HTTP_PORT}/smartphone.html`);
  console.log(`  WebSocket : ws://192.168.101.14:${WS_PORT}`);
  console.log('='.repeat(60));
}

// ── Arrêt propre ──────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n🛑 Arrêt du serveur...');
  wss.close();
  httpServer.close();
  process.exit(0);
});
