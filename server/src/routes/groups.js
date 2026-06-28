import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { broadcast } from '../lib/ws.js';

const router = Router();

router.get('/', async (req, res) => {
    try {
        res.json(await prisma.group.findMany({ orderBy: { name: 'asc' } }));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
    try {
        const data = { ...req.body };
        if (data.employees) delete data.employees;
        const grp = await prisma.group.create({ data });
        broadcast('update', { type: 'group' });
        res.json(grp);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
    try {
        const data = { ...req.body };
        delete data.id;
        if (data.employees) delete data.employees;
        const grp = await prisma.group.update({ where: { id: req.params.id }, data });
        broadcast('update', { type: 'group' });
        res.json(grp);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
    try {
        await prisma.group.delete({ where: { id: req.params.id } });
        broadcast('update', { type: 'group' });
        res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

export default router;
