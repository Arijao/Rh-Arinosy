import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { broadcast } from '../lib/ws.js';

const router = Router();

router.get('/', async (req, res) => {
    try {
        const { employeeId } = req.query;
        const where = employeeId ? { employeeId } : {};
        res.json(await prisma.remark.findMany({ where, orderBy: { createdAt: 'desc' } }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
    try {
        const data = { ...req.body };
        if (data.employee) delete data.employee;
        const r = await prisma.remark.create({ data });
        broadcast('update', { type: 'remark' });
        res.json(r);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
    try {
        const data = { ...req.body };
        delete data.id;
        if (data.employee) delete data.employee;
        const r = await prisma.remark.update({ where: { id: req.params.id }, data });
        broadcast('update', { type: 'remark' });
        res.json(r);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
    try {
        await prisma.remark.delete({ where: { id: req.params.id } });
        broadcast('update', { type: 'remark' });
        res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

export default router;
