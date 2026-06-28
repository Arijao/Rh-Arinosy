import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

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

export default router;
