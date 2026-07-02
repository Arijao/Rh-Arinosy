import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';
import { readFileSync } from 'fs';

import dataRoutes       from './routes/data.js';
import employeesRoutes  from './routes/employees.js';
import groupsRoutes     from './routes/groups.js';
import attendanceRoutes from './routes/attendance.js';
import advancesRoutes   from './routes/advances.js';
import payrollRoutes    from './routes/payroll.js';
import remarksRoutes    from './routes/remarks.js';
import qrRoutes         from './routes/qr.js';
import settingsRoutes   from './routes/settings.js';
import scanRoutes       from './routes/scan.js';
import { initWS }       from './lib/ws.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR  = path.resolve(__dirname, '../../');

const app       = express();
const PORT      = process.env.PORT      || 4001;
const HTTPS_PORT = process.env.HTTPS_PORT || 4444;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // 50mb pour les descripteurs faciaux + photos

app.use('/api/data',       dataRoutes);
app.use('/api/employees',  employeesRoutes);
app.use('/api/groups',     groupsRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/advances',   advancesRoutes);
app.use('/api/payroll',    payrollRoutes);
app.use('/api/remarks',    remarksRoutes);
app.use('/api/qr',         qrRoutes);
app.use('/api/settings',   settingsRoutes);
app.use('/api/scan',         scanRoutes);
app.get('/api/health',     (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ── Modèles face-api.js (servis localement) ───────────────────
app.use('/model', express.static(path.join(ROOT_DIR, 'model')));

// ── Scanner mobile (page dédiée) ───────────────────────────────
app.get('/test-camera', (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'test-camera.html'));
});

app.get('/scanner', (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'scanner.html'));
});

// ── Frontend statique ─────────────────────────────────────────
app.use(express.static(ROOT_DIR));
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

async function startServer() {
    // ── HTTP ─────────────────────────────────────────────────
    const httpServer = http.createServer(app);
    httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`RH-ARINOSY HTTP  : http://0.0.0.0:${PORT}`);
    });

    // ── HTTPS (mobiles réseau local) ─────────────────────────
    let httpsServer = null;
    const certDir = path.resolve(__dirname, '../certs');
    try {
        const key  = readFileSync(path.join(certDir, 'key.pem'));
        const cert = readFileSync(path.join(certDir, 'cert.pem'));
        httpsServer = https.createServer({ key, cert }, app);
        httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
            console.log(`RH-ARINOSY HTTPS : https://0.0.0.0:${HTTPS_PORT}`);
        });
    } catch (e) {
        console.warn('[HTTPS] Certificats introuvables — HTTP uniquement.');
    }

    // ── WebSocket ─────────────────────────────────────────────
    initWS(httpServer, httpsServer);
}

startServer();
