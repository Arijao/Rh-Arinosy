import { Router } from 'express';
import { broadcast } from '../lib/ws.js';

const router = Router();

// Mode actif courant (annoncé par le Chromebook)
let _currentMode = { section: 'attendance', label: 'Présence' };

// ── GET /api/scan/mode — téléphone interroge le mode actif ───
router.get('/mode', (req, res) => {
    res.json(_currentMode);
});

// ── POST /api/scan/mode — Chromebook annonce sa section ──────
router.post('/mode', (req, res) => {
    const { section, label } = req.body;
    if (!section) return res.status(400).json({ error: 'section requis.' });
    _currentMode = { section, label: label || section, ts: Date.now() };
    broadcast('mode', _currentMode);
    res.json({ ok: true, mode: _currentMode });
});

// ── POST /api/scan — téléphone envoie un scan ────────────────
router.post('/', (req, res) => {
    const { employeeId, scanType, purpose } = req.body;
    if (!employeeId) return res.status(400).json({ error: 'employeeId requis.' });
    broadcast('scan', { employeeId, scanType: scanType || 'qr', purpose: purpose || _currentMode.section });
    console.log(`[SCAN] ${scanType} → employeeId: ${employeeId} — mode: ${_currentMode.section}`);
    res.json({ ok: true });
});

// ── POST /api/scan/auth — vérifier PIN scanner ───────────────
router.post('/auth', (req, res) => {
    const { pin } = req.body;
    const SCANNER_PIN = process.env.SCANNER_PIN || '1234';
    if (pin !== SCANNER_PIN) return res.status(401).json({ error: 'PIN invalide.' });
    // Token valable 8h
    const token = Buffer.from(`${pin}:${Date.now()}`).toString('base64');
    res.json({ ok: true, token });
});

// ── Middleware vérification token scanner ─────────────────────
export function requireScannerToken(req, res, next) {
    const token = req.headers['x-scanner-token'];
    if (!token) return res.status(401).json({ error: 'Token requis.' });
    try {
        const decoded = Buffer.from(token, 'base64').toString();
        const [pin, ts] = decoded.split(':');
        const SCANNER_PIN = process.env.SCANNER_PIN || '1234';
        if (pin !== SCANNER_PIN) return res.status(401).json({ error: 'Token invalide.' });
        // Expiration 8h
        if (Date.now() - Number(ts) > 8 * 60 * 60 * 1000) {
            return res.status(401).json({ error: 'Token expiré.' });
        }
        next();
    } catch {
        res.status(401).json({ error: 'Token invalide.' });
    }
}

export default router;
