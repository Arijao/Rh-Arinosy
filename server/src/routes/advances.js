import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { broadcast } from '../lib/ws.js';

const router = Router();

router.get('/', async (req, res) => {
    try {
        res.json(await prisma.advance.findMany({ orderBy: { date: 'desc' } }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
    try {
        const data = { ...req.body };
        if (data.employee) delete data.employee;
        const adv = await prisma.advance.create({ data });
        broadcast('update', { type: 'advance' });
        res.json(adv);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
    try {
        const data = { ...req.body };
        delete data.id;
        if (data.employee) delete data.employee;
        const adv = await prisma.advance.update({ where: { id: req.params.id }, data });
        broadcast('update', { type: 'advance' });
        res.json(adv);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
    try {
        await prisma.advance.delete({ where: { id: req.params.id } });
        broadcast('update', { type: 'advance' });
        res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

export default router;
