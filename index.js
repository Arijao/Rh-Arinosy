// ============================================================
// bridge/index.js — Point d'entrée du pont biométrique local
//
// Rôle :
//   1. Lire config.json
//   2. Instancier le bon adaptateur (auto-détection ou explicite)
//   3. Démarrer le serveur WebSocket
//   4. Relayer les événements 'fingerprint' vers l'application web
//   5. Gérer les reconnexions et le statut des clients
//
// Usage :
//   node index.js
//   node index.js --config ./mon-config.json
//   node index.js --adapter zkteco
//
// Nécessite Node.js 18+ (fetch natif)
// ============================================================

import { createServer }    from 'http';
import { WebSocketServer } from 'ws';
import { readFileSync }    from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath }   from 'url';

import { HIDAdapter }       from './adapters/hid.js';
import { ZKTecoAdapter }    from './adapters/zkteco.js';
import { HikvisionAdapter } from './adapters/hikvision.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Lecture de la configuration ───────────────────────────

function loadConfig() {
  const args       = process.argv.slice(2);
  const configFlag = args.indexOf('--config');
  const configPath = configFlag !== -1
    ? resolve(args[configFlag + 1])
    : resolve(__dirname, 'config.json');

  try {
    const raw = readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[Bridge] Impossible de lire config.json : ${err.message}`);
    process.exit(1);
  }
}

// ── Sélection de l'adaptateur ─────────────────────────────

function buildAdapter(config) {
  // Surcharge via argument CLI : node index.js --adapter zkteco
  const args        = process.argv.slice(2);
  const adapterFlag = args.indexOf('--adapter');
  const adapterType = adapterFlag !== -1
    ? args[adapterFlag + 1]
    : config.adapter.type;

  const ac = config.adapter; // raccourci

  switch (adapterType) {
    case 'hid':
      log('info', 'Adaptateur sélectionné : HID générique');
      return new HIDAdapter(ac.hid || {});

    case 'zkteco': {
      const mode    = ac.zkteco?.mode || 'tcp';
      const zkConf  = { mode, ...(mode === 'usb' ? ac.zkteco?.usb : ac.zkteco?.tcp) };
      log('info', `Adaptateur sélectionné : ZKTeco (${mode})`);
      return new ZKTecoAdapter(zkConf);
    }

    case 'hikvision': {
      const mode    = ac.hikvision?.mode || 'usb';
      const hikConf = { mode, ...(mode === 'usb' ? ac.hikvision?.usb : ac.hikvision?.isapi) };
      log('info', `Adaptateur sélectionné : Hikvision (${mode})`);
      return new HikvisionAdapter(hikConf);
    }

    case 'auto':
    default:
      log('info', 'Mode auto : détection du lecteur en cours…');
      return null; // géré par autoDetect()
  }
}

// ── Auto-détection ────────────────────────────────────────

async function autoDetect(config) {
  const ac       = config.adapter;
  const candidates = [
    // Ordre de priorité : Hikvision → ZKTeco réseau → ZKTeco USB → HID
    new HikvisionAdapter({ mode: 'usb', ...ac.hikvision?.usb }),
    new ZKTecoAdapter({ mode: 'tcp',   ...ac.zkteco?.tcp     }),
    new ZKTecoAdapter({ mode: 'usb',   ...ac.zkteco?.usb     }),
    new HIDAdapter(ac.hid || {}),
  ];

  for (const adapter of candidates) {
    try {
      const found = await adapter.detect();
      if (found) {
        log('info', `Auto-détection : ${adapter.name} sélectionné`);
        return adapter;
      }
    } catch {
      // Ce candidat n'est pas disponible, on continue
    }
  }

  // Aucun lecteur physique → HID en dernier recours (peut échouer à connect())
  log('warn', 'Aucun lecteur détecté automatiquement. Tentative HID par défaut.');
  return new HIDAdapter(ac.hid || {});
}

// ── Serveur WebSocket ─────────────────────────────────────

function startWebSocketServer(config, adapter) {
  const { port, host } = config.server;

  // Serveur HTTP minimal requis par ws
  const httpServer = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status:    'ok',
        adapter:   adapter.name,
        connected: adapter.connected,
        uptime:    process.uptime(),
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const wss = new WebSocketServer({ server: httpServer });

  // ── Gestion des clients ───────────────────────────────

  const clients = new Set();

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    log('info', `Client connecté : ${clientIp} (total: ${clients.size + 1})`);
    clients.add(ws);

    // Envoyer l'état actuel au client qui vient de se connecter
    send(ws, {
      type:      'device_info',
      name:      `${adapter.name} adapter`,
      transport: adapter.name,
      connected: adapter.connected,
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleClientMessage(ws, msg, adapter);
      } catch {
        // Message non-JSON ignoré
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      log('info', `Client déconnecté (restants: ${clients.size})`);
    });

    ws.on('error', (err) => {
      log('warn', `Erreur client WebSocket : ${err.message}`);
      clients.delete(ws);
    });
  });

  // ── Relay des événements adaptateur → clients WS ──────

  adapter.on('fingerprint', (payload) => {
    log('info', `Empreinte → ID: ${payload.employeeId}, qualité: ${payload.quality}, transport: ${payload.transport}`);
    broadcast(clients, payload);
  });

  adapter.on('status', ({ state, message }) => {
    log('info', `Statut adaptateur : [${state}] ${message}`);
    broadcast(clients, { type: 'status', state, message });
  });

  adapter.on('connected', ({ deviceName }) => {
    log('info', `Lecteur connecté : ${deviceName}`);
    broadcast(clients, { type: 'device_info', name: deviceName, connected: true });
  });

  adapter.on('disconnected', ({ unexpected } = {}) => {
    log('warn', `Lecteur déconnecté${unexpected ? ' (inattendu)' : ''}`);
    broadcast(clients, { type: 'status', state: 'disconnected', message: 'Lecteur déconnecté' });
  });

  adapter.on('error', ({ code, message }) => {
    log('warn', `Erreur lecteur : [${code}] ${message}`);
    broadcast(clients, { type: 'error', code, message });
  });

  // ── Démarrage ─────────────────────────────────────────

  httpServer.listen(port, host, () => {
    log('info', '─'.repeat(60));
    log('info', `Pont biométrique démarré`);
    log('info', `WebSocket : ws://${host}:${port}`);
    log('info', `Santé     : http://${host}:${port}/health`);
    log('info', `Adaptateur: ${adapter.name}`);
    log('info', '─'.repeat(60));
  });

  return wss;
}

// ── Messages entrants depuis le navigateur ────────────────

function handleClientMessage(ws, msg, adapter) {
  // Si la commande inclut un cmdId, on le renvoie dans la réponse
  // pour que ZKTecoAdapter._send() puisse résoudre la promesse correspondante.
  const cmdId = msg.cmdId ?? null;

  const reply = (data, error = null) => {
    if (cmdId === null) return;
    send(ws, error ? { cmdId, error } : { cmdId, data });
  };

  switch (msg.type) {
    case 'ping':
      send(ws, { type: 'pong', timestamp: new Date().toISOString(), cmdId });
      break;

    case 'get_status':
      reply({
        type:      'device_info',
        name:      adapter.name,
        connected: adapter.connected,
        transport: adapter.name,
      });
      break;

    case 'enroll':
      // Délègue l'enrôlement à l'adaptateur si supporté
      if (typeof adapter.startEnrollment === 'function') {
        adapter.startEnrollment?.({ employeeId: msg.employeeId, fingerIndex: msg.fingerIndex ?? 1 })
          .then((result) => reply(result))
          .catch((err)   => reply(null, err.message));
      } else {
        reply({ status: 'unsupported' });
      }
      break;

    default:
      log('debug', `Message client inconnu : ${msg.type}`);
      if (cmdId !== null) reply(null, `Commande inconnue : ${msg.type}`);
  }
}

// ── Utilitaires ───────────────────────────────────────────

function broadcast(clients, payload) {
  const json = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === 1 /* OPEN */) {
      try { client.send(json); } catch (_) {}
    }
  }
}

function send(ws, payload) {
  if (ws.readyState === 1) {
    try { ws.send(JSON.stringify(payload)); } catch (_) {}
  }
}

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
let configuredLevel = 1; // info par défaut

function log(level, ...args) {
  if ((LOG_LEVELS[level] ?? 1) >= configuredLevel) {
    const prefix = {
      debug: '\x1b[90m[DEBUG]\x1b[0m',
      info:  '\x1b[36m[INFO] \x1b[0m',
      warn:  '\x1b[33m[WARN] \x1b[0m',
      error: '\x1b[31m[ERROR]\x1b[0m',
    }[level] || '[LOG]  ';
    console.log(`${prefix} ${new Date().toLocaleTimeString()} —`, ...args);
  }
}

// ── Point d'entrée principal ──────────────────────────────

async function main() {
  const config = loadConfig();
  configuredLevel = LOG_LEVELS[config.logging?.level || 'info'] ?? 1;

  log('info', 'Démarrage du pont biométrique RH RiseVanilla…');

  // Sélectionner ou auto-détecter l'adaptateur
  let adapter = buildAdapter(config);
  if (!adapter) {
    adapter = await autoDetect(config);
  }

  // Démarrer le serveur WebSocket
  startWebSocketServer(config, adapter);

  // Connecter le lecteur
  try {
    await adapter.connect();
  } catch (err) {
    log('error', `Impossible de connecter le lecteur : ${err.message}`);
    log('warn',  'Le pont continue de tourner — nouvelle tentative à la prochaine connexion client.');
  }

  // Arrêt propre
  process.on('SIGINT',  () => shutdown(adapter));
  process.on('SIGTERM', () => shutdown(adapter));
}

async function shutdown(adapter) {
  log('info', 'Arrêt du pont…');
  try { await adapter.disconnect(); } catch (_) {}
  process.exit(0);
}

main().catch((err) => {
  console.error('[Bridge] Erreur fatale :', err);
  process.exit(1);
});
