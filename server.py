#!/usr/bin/env python3
"""
server.py — Serveur local LAN offline
WebSocket (port 8765) + HTTP (port 8766)
Communication Smartphone ↔ Chromebook via hotspot Android

Usage:
    python3 server.py
    python3 server.py --host 0.0.0.0 --ws-port 8765 --http-port 8766

Prérequis:
    pip install websockets
    (Python 3.7+ requis — préinstallé sur ChromeOS Linux/Crostini)
"""

import asyncio
import json
import logging
import argparse
import os
import sys
import socket
from datetime import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from pathlib import Path

# ─── Tentative import websockets ────────────────────────────────────────────
try:
    import websockets
except ImportError:
    print("❌ Module 'websockets' manquant.")
    print("   Installez-le avec : pip3 install websockets")
    sys.exit(1)

# ─── Configuration logging ───────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger('RemoteCamera')

# ─── État global ─────────────────────────────────────────────────────────────
connected_clients = set()   # Tous les clients WS connectés
smartphone_client = None    # Client smartphone identifié
pc_client = None            # Client PC/Chromebook identifié

# ─── Détection IP locale ──────────────────────────────────────────────────────
def get_local_ip():
    """Retourne l'IP locale du Chromebook sur le réseau hotspot."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('192.168.43.1', 80))  # IP gateway hotspot Android
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return '0.0.0.0'

# ─── Gestionnaire WebSocket ───────────────────────────────────────────────────
async def ws_handler(websocket, path='/'):
    """
    Gère chaque connexion WebSocket entrante.
    
    Protocole de messages (JSON) :
    
    Smartphone → PC :
        { "type": "identify",  "role": "smartphone" }
        { "type": "qr_result", "data": "<employee_id>", "ts": <timestamp> }
        { "type": "face_data", "descriptor": [...128 floats...], "ts": <timestamp> }
        { "type": "ping" }
    
    PC → Smartphone :
        { "type": "identify",    "role": "pc" }
        { "type": "ack",         "result": "arrival|departure|error", "name": "...", "time": "..." }
        { "type": "pong" }
        { "type": "session_qr",  "url": "..." }   ← URL de connexion pour le smartphone
    """
    global smartphone_client, pc_client

    client_ip = websocket.remote_address[0]
    client_id = f"{client_ip}:{websocket.remote_address[1]}"
    connected_clients.add(websocket)

    log.info(f"🔗 Nouvelle connexion : {client_id}")

    try:
        async for raw in websocket:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                log.warning(f"Message non-JSON reçu de {client_id}: {raw[:100]}")
                continue

            msg_type = msg.get('type', '')

            # ── Identification du client ──────────────────────────────────────
            if msg_type == 'identify':
                role = msg.get('role', 'unknown')

                if role == 'smartphone':
                    smartphone_client = websocket
                    log.info(f"📱 Smartphone identifié : {client_id}")
                    await websocket.send(json.dumps({
                        'type': 'identified',
                        'role': 'smartphone',
                        'server_time': datetime.now().isoformat()
                    }))
                    # Notifie le PC qu'un smartphone est connecté
                    if pc_client and pc_client.open:
                        await pc_client.send(json.dumps({
                            'type': 'smartphone_connected',
                            'client_id': client_id
                        }))

                elif role == 'pc':
                    pc_client = websocket
                    log.info(f"💻 PC identifié : {client_id}")
                    await websocket.send(json.dumps({
                        'type': 'identified',
                        'role': 'pc',
                        'server_time': datetime.now().isoformat(),
                        'smartphone_connected': smartphone_client is not None and smartphone_client.open
                    }))

            # ── Résultat scan QR (smartphone → PC) ───────────────────────────
            elif msg_type == 'qr_result':
                employee_id = msg.get('data', '').strip()
                ts = msg.get('ts', datetime.now().isoformat())
                log.info(f"📷 QR scanné : {employee_id}")

                if pc_client and pc_client.open:
                    await pc_client.send(json.dumps({
                        'type': 'qr_result',
                        'data': employee_id,
                        'ts': ts,
                        'source': 'smartphone'
                    }))
                else:
                    log.warning("⚠ PC non connecté — QR ignoré")
                    await websocket.send(json.dumps({
                        'type': 'error',
                        'message': 'PC non connecté'
                    }))

            # ── Données faciales (smartphone → PC) ───────────────────────────
            elif msg_type == 'face_data':
                descriptor = msg.get('descriptor', [])
                ts = msg.get('ts', datetime.now().isoformat())
                log.info(f"👤 Données faciales reçues (dim: {len(descriptor)})")

                if pc_client and pc_client.open:
                    await pc_client.send(json.dumps({
                        'type': 'face_data',
                        'descriptor': descriptor,
                        'ts': ts,
                        'source': 'smartphone'
                    }))

            # ── ACK présence (PC → smartphone) ───────────────────────────────
            elif msg_type == 'ack':
                if smartphone_client and smartphone_client.open:
                    await smartphone_client.send(json.dumps(msg))
                    log.info(f"✅ ACK transmis au smartphone : {msg.get('result')} — {msg.get('name')}")

            # ── Ping/Pong ─────────────────────────────────────────────────────
            elif msg_type == 'ping':
                await websocket.send(json.dumps({'type': 'pong', 'ts': datetime.now().isoformat()}))

            # ── Status ───────────────────────────────────────────────────────
            elif msg_type == 'status':
                await websocket.send(json.dumps({
                    'type': 'status_response',
                    'smartphone_connected': smartphone_client is not None and smartphone_client.open,
                    'pc_connected': pc_client is not None and pc_client.open,
                    'clients_count': len(connected_clients),
                    'server_time': datetime.now().isoformat()
                }))

            else:
                log.debug(f"Type de message inconnu : {msg_type}")

    except websockets.exceptions.ConnectionClosed as e:
        log.info(f"🔌 Connexion fermée : {client_id} (code: {e.code})")
    except Exception as e:
        log.error(f"❌ Erreur handler {client_id}: {e}")
    finally:
        connected_clients.discard(websocket)
        if websocket is smartphone_client:
            smartphone_client = None
            log.info("📱 Smartphone déconnecté")
            if pc_client and pc_client.open:
                await pc_client.send(json.dumps({'type': 'smartphone_disconnected'}))
        if websocket is pc_client:
            pc_client = None
            log.info("💻 PC déconnecté")

# ─── Serveur HTTP pour smartphone.html ───────────────────────────────────────
class CORSHandler(SimpleHTTPRequestHandler):
    """Sert les fichiers statiques avec headers CORS pour le LAN."""

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, format, *args):
        log.debug(f"HTTP: {format % args}")

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

def start_http_server(host, port, directory):
    """Lance le serveur HTTP dans un thread séparé."""
    os.chdir(directory)
    server = HTTPServer((host, port), CORSHandler)
    log.info(f"🌐 Serveur HTTP démarré : http://{host}:{port}/smartphone.html")
    server.serve_forever()

# ─── Point d'entrée ───────────────────────────────────────────────────────────
async def main(args):
    local_ip = get_local_ip()

    log.info("=" * 60)
    log.info("  Serveur RemoteCamera — Système Présence LAN Offline")
    log.info("=" * 60)
    log.info(f"  IP Chromebook (réseau hotspot) : {local_ip}")
    log.info(f"  WebSocket    : ws://{local_ip}:{args.ws_port}")
    log.info(f"  HTTP         : http://{local_ip}:{args.http_port}/smartphone.html")
    log.info("")
    log.info("  Sur le smartphone Android, ouvrez Chrome et accédez à :")
    log.info(f"  → http://{local_ip}:{args.http_port}/smartphone.html")
    log.info("=" * 60)

    # Lance HTTP dans un thread séparé
    script_dir = Path(__file__).parent.absolute()
    http_thread = Thread(
        target=start_http_server,
        args=(args.host, args.http_port, str(script_dir)),
        daemon=True
    )
    http_thread.start()

    # Lance WebSocket
    async with websockets.serve(
        ws_handler,
        args.host,
        args.ws_port,
        ping_interval=20,
        ping_timeout=10,
        max_size=10 * 1024 * 1024  # 10MB max (pour descripteurs faciaux)
    ):
        log.info("✅ Serveur WebSocket en écoute...")
        await asyncio.Future()  # Tourne indéfiniment

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Serveur RemoteCamera LAN')
    parser.add_argument('--host', default='0.0.0.0', help='Interface d\'écoute')
    parser.add_argument('--ws-port', type=int, default=8765, help='Port WebSocket')
    parser.add_argument('--http-port', type=int, default=8766, help='Port HTTP')
    args = parser.parse_args()

    try:
        asyncio.run(main(args))
    except KeyboardInterrupt:
        log.info("\n🛑 Serveur arrêté proprement.")
