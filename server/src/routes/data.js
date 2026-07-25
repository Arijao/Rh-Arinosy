import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { broadcast } from '../lib/ws.js';

const router = Router();

router.get('/', async (req, res) => {
    try {
        const [employees, groups, advances, payrolls, remarks, qrCodes, qrAttendance, settings, attendanceRecords] =
            await Promise.all([
                prisma.employee.findMany({ orderBy: { name: 'asc' } }),
                prisma.group.findMany({ orderBy: { name: 'asc' } }),
                prisma.advance.findMany({ orderBy: { date: 'desc' } }),
                prisma.payroll.findMany({ orderBy: { timestamp: 'desc' } }),
                prisma.remark.findMany({ orderBy: { createdAt: 'desc' } }),
                prisma.qrCode.findMany(),
                prisma.qrAttendance.findMany({ orderBy: { timestamp: 'desc' } }),
                prisma.setting.findMany(),
                prisma.attendanceRecord.findMany(),
            ]);

        // Reconstruire attendance au format { date: { empId: value } }
        const attendance = {};
        for (const r of attendanceRecords) {
            if (!attendance[r.date]) attendance[r.date] = {};
            if (r.arrivee || r.depart) {
                attendance[r.date][r.employeeId] = { arrivee: r.arrivee, depart: r.depart, method: r.method };
            } else if (r.demi) {
                attendance[r.date][r.employeeId] = 'demi';
            } else if (r.present) {
                attendance[r.date][r.employeeId] = true;
            }
        }

        // Reconstruire faceDescriptors depuis JSON
        const employeesOut = employees.map(e => ({
            ...e,
            face_descriptors: e.faceDescriptors ? JSON.parse(e.faceDescriptors) : [],
            face_enrolled:    e.faceEnrolled,
            face_enrollment_date: e.faceEnrollmentDate,
        }));

        // Settings en objet clé/valeur
        const settingsOut = {};
        settings.forEach(s => {
            try { settingsOut[s.key] = JSON.parse(s.value); }
            catch { settingsOut[s.key] = s.value; }
        });

        res.json({ employees: employeesOut, groups, advances, payrolls, remarks, qrCodes, qrAttendance, attendance, settings: settingsOut });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

router.delete('/', async (req, res) => {
    try {
        await prisma.$transaction([
            prisma.attendanceRecord.deleteMany(),
            prisma.qrAttendance.deleteMany(),
            prisma.qrCode.deleteMany(),
            prisma.advance.deleteMany(),
            prisma.payroll.deleteMany(),
            prisma.remark.deleteMany(),
            prisma.setting.deleteMany(),
            prisma.employee.deleteMany(),
            prisma.group.deleteMany(),
        ]);
        // FIX : notifier tous les postes connectés (tablette QR, autres onglets)
        // qu'un reset a eu lieu, même pattern que attendance.js::POST '/'.
        // Sans ça, seul le poste ayant cliqué sur reset se vide ; les autres
        // gardent les anciennes données jusqu'à un F5 manuel.
        broadcast('update', { reason: 'reset' });
        res.json({ success: true });
    } catch (err) {
        console.error('[DELETE /data] Erreur reset total:', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
