import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { broadcast } from '../lib/ws.js';

const router = Router();

// GET /api/attendance?date=2026-06-28
router.get('/', async (req, res) => {
    try {
        const { date } = req.query;
        const where = date ? { date } : {};
        const records = await prisma.attendanceRecord.findMany({
            where,
            include: { employee: { select: { id: true, name: true, position: true } } },
        });
        // Reconstruire le format { date: { employeeId: status } } attendu par le frontend
        const result = {};
        for (const r of records) {
            if (!result[r.date]) result[r.date] = {};
            if (r.arrivee || r.depart) {
                result[r.date][r.employeeId] = {
                    arrivee: r.arrivee,
                    depart:  r.depart,
                    method:  r.method,
                };
            } else if (r.demi) {
                result[r.date][r.employeeId] = 'demi';
            } else if (r.present) {
                result[r.date][r.employeeId] = true;
            }
        }
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/attendance — upsert un enregistrement
router.post('/', async (req, res) => {
    try {
        const { date, employeeId, value, method } = req.body;
        if (!date || !employeeId) return res.status(400).json({ error: 'date et employeeId requis.' });

        // Déterminer present/demi/arrivee/depart selon la valeur
        let data = { present: false, demi: false, arrivee: null, depart: null, method: method || null };

        if (value === true || value === 'journee') {
            data.present = true;
        } else if (value === 'demi') {
            data.demi = true;
        } else if (value && typeof value === 'object') {
            data.arrivee = value.arrivee || null;
            data.depart  = value.depart  || null;
            data.method  = value.method  || method || null;
            // Règle : < 4h → demi-journée automatique
            if (data.arrivee && data.depart) {
                const toMin = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
                const diff = toMin(data.depart) - toMin(data.arrivee);
                data.present = diff >= 240;
                data.demi    = diff > 0 && diff < 240;
            } else if (data.arrivee && !data.depart) {
                data.demi = true; // arrivée sans départ → demi
            }
        } else if (value === false || value === null) {
            // Absent — supprimer l'enregistrement
            await prisma.attendanceRecord.deleteMany({ where: { date, employeeId } });
            broadcast('update', { type: 'attendance', date });
            return res.json({ ok: true, deleted: true });
        }

        const record = await prisma.attendanceRecord.upsert({
            where:  { date_employeeId: { date, employeeId } },
            update: data,
            create: { date, employeeId, ...data },
        });
        broadcast('update', { type: 'attendance', date });
        res.json(record);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /api/attendance/:date/:employeeId
router.delete('/:date/:employeeId', async (req, res) => {
    try {
        await prisma.attendanceRecord.deleteMany({
            where: { date: req.params.date, employeeId: req.params.employeeId },
        });
        broadcast('update', { type: 'attendance' });
        res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

export default router;
