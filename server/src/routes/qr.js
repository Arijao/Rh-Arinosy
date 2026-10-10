import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { broadcast } from '../lib/ws.js';

const router = Router();

// QR codes
router.get('/codes', async (req, res) => {
    try {
        res.json(await prisma.qrCode.findMany());
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/codes', async (req, res) => {
    try {
        const { employeeId, payload, generated, size, color } = req.body;
        const qr = await prisma.qrCode.upsert({
            where:  { employeeId },
            update: { payload, generated, size, color },
            create: { employeeId, payload, generated, size, color },
        });
        broadcast('update', { type: 'qr' });
        res.json(qr);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// Suppression du QR code d'un employé (désassociation de son identifiant).
// deleteMany et non delete : ne lève pas si l'employé n'a jamais eu de QR.
router.delete('/codes/:employeeId', async (req, res) => {
    try {
        const r = await prisma.qrCode.deleteMany({ where: { employeeId: req.params.employeeId } });
        broadcast('update', { type: 'qr' });
        res.json({ ok: true, deleted: r.count });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// QR attendance
router.get('/attendance', async (req, res) => {
    try {
        const { date } = req.query;
        const where = date ? { date } : {};
        res.json(await prisma.qrAttendance.findMany({ where, orderBy: { timestamp: 'desc' } }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/attendance', async (req, res) => {
    try {
        const data = { ...req.body };
        if (data.employee) delete data.employee;
        const qa = await prisma.qrAttendance.create({ data });
        broadcast('scan', { type: 'qr_attendance', employeeId: qa.employeeId, scanType: qa.type });
        res.json(qa);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

export default router;
