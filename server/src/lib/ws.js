import { WebSocketServer } from 'ws';

let _wss = null;

export function initWS(httpServer, httpsServer) {
    _wss = new WebSocketServer({ noServer: true });

    _wss.on('connection', (ws) => {
        console.log('[WS] Client connecté — total:', _wss.clients.size);
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        ws.on('close', () => console.log('[WS] Client déconnecté — total:', _wss.clients.size));
        ws.on('error', (err) => console.warn('[WS] Erreur:', err.message));
    });

    function handleUpgrade(server) {
        server.on('upgrade', (req, socket, head) => {
            if (req.url === '/ws') {
                _wss.handleUpgrade(req, socket, head, (ws) => _wss.emit('connection', ws, req));
            } else {
                socket.destroy();
            }
        });
    }

    handleUpgrade(httpServer);
    if (httpsServer) handleUpgrade(httpsServer);

    setInterval(() => {
        _wss.clients.forEach(ws => {
            if (!ws.isAlive) { ws.terminate(); return; }
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    console.log('[WS] Serveur WebSocket initialisé sur /ws');
}

export function broadcast(event = 'update', data = {}) {
    if (!_wss) return;
    const msg = JSON.stringify({ event, ts: Date.now(), ...data });
    let count = 0;
    _wss.clients.forEach(ws => {
        if (ws.readyState === ws.OPEN) { ws.send(msg); count++; }
    });
    if (count > 0) console.log(`[WS] Broadcast "${event}" → ${count} client(s)`);
}
