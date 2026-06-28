import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { broadcast } from '../lib/ws.js';

const router = Router();

router.get('/', async (req, res) => {
    try {
        res.json(await prisma.payroll.findMany({ orderBy: { timestamp: 'desc' } }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
    try {
        const data = { ...req.body };
        if (data.employee) delete data.employee;
        const p = await prisma.payroll.create({ data });
        broadcast('update', { type: 'payroll' });
        res.json(p);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
    try {
        const data = { ...req.body };
        delete data.id;
        if (data.employee) delete data.employee;
        const p = await prisma.payroll.update({ where: { id: req.params.id }, data });
        broadcast('update', { type: 'payroll' });
        res.json(p);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
    try {
        await prisma.payroll.delete({ where: { id: req.params.id } });
        broadcast('update', { type: 'payroll' });
        res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

export default router;
