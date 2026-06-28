import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { broadcast } from '../lib/ws.js';

const router = Router();

router.get('/', async (req, res) => {
    try {
        const employees = await prisma.employee.findMany({
            include: { group: true },
            orderBy: { name: 'asc' },
        });
        res.json(employees);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
    try {
        const data = { ...req.body };
        if (data.faceDescriptors && typeof data.faceDescriptors !== 'string')
            data.faceDescriptors = JSON.stringify(data.faceDescriptors);
        if (data.group) delete data.group;
        const emp = await prisma.employee.create({ data });
        broadcast('update', { type: 'employee' });
        res.json(emp);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
    try {
        const data = { ...req.body };
        delete data.id;
        if (data.faceDescriptors && typeof data.faceDescriptors !== 'string')
            data.faceDescriptors = JSON.stringify(data.faceDescriptors);
        if (data.group) delete data.group;
        if (data.attendance) delete data.attendance;
        if (data.advances) delete data.advances;
        if (data.payrolls) delete data.payrolls;
        if (data.remarks) delete data.remarks;
        if (data.qrCode) delete data.qrCode;
        if (data.qrAttendance) delete data.qrAttendance;
        const emp = await prisma.employee.update({
            where: { id: req.params.id }, data,
        });
        broadcast('update', { type: 'employee' });
        res.json(emp);
    } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
    try {
        await prisma.employee.delete({ where: { id: req.params.id } });
        broadcast('update', { type: 'employee' });
        res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

export default router;
