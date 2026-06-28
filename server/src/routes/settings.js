import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

const router = Router();

router.get('/', async (req, res) => {
    try {
        const rows = await prisma.setting.findMany();
        const result = {};
        rows.forEach(r => {
            try { result[r.key] = JSON.parse(r.value); }
            catch { result[r.key] = r.value; }
        });
        res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:key', async (req, res) => {
    try {
        const value = typeof req.body.value === 'string'
            ? req.body.value
            : JSON.stringify(req.body.value);
        const s = await prisma.setting.upsert({
            where:  { key: req.params.key },
            update: { value },
            create: { key: req.params.key, value },
        });
        res.json(s);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

export default router;
