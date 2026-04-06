// ============================================================
// ui/reports.js — Rapports & Export (ES Module)
// ============================================================

import { state, dbManager } from '../state.js';
import { formatCurrency, formatDate, formatDateForFilename, getDaysInMonth } from '../utils/format.js';
import { countPresenceDays } from '../utils/attendance-calc.js';
import { downloadJSON } from '../utils/ui.js';
import { showToast } from '../utils/notifications.js';
import { registerSectionCallback } from './navigation.js';

export function initReports() {
  registerSectionCallback('reports', updateReportStats);
  registerSectionCallback('payments', () => window.displayPayments?.());
}

export function updateReportStats() {
  const today   = new Date().toISOString().split('T')[0];
  const month   = new Date().toISOString().slice(0, 7);
  const present = state.attendance[today]
    ? Object.values(state.attendance[today]).filter(Boolean).length : 0;

  let monthTotal = 0;
  Object.keys(state.attendance).forEach(d => {
    if (d.startsWith(month))
      monthTotal += Object.values(state.attendance[d]).filter(Boolean).length;
  });

  _set('reportPresentToday',     present);
  _set('reportPresentMonth',     monthTotal);
  _set('reportSalariesPaid',     formatCurrency(state.payrolls.reduce((s, p) => s + p.amount, 0)));
  _set('reportActiveEmployees',  state.employees.length);
}

function _set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

// ------ Export Global ------

export function exportGlobalReport() {
  const today = new Date();
  const month = today.toISOString().slice(0, 7);
  downloadJSON({
    date: today.toISOString(),
    totalEmployees: state.employees.length,
    employees: state.employees,
    monthlyPayrolls: state.payrolls.filter(p => p.month === month),
    monthlyAdvances: state.advances.filter(a => a.date.startsWith(month)),
    qrAttendance: state.qrAttendance,
  }, `rapport-global-${formatDateForFilename(today)}.json`);
  showToast('Rapport global exporté!', 'success');
}

export function exportAttendanceReport() {
  downloadJSON({
    date: new Date().toISOString(),
    attendanceData: state.attendance,
    qrAttendanceData: state.qrAttendance,
    employees: state.employees,
  }, `rapport-presences-${formatDateForFilename(new Date())}.json`);
  showToast('Rapport présences exporté!', 'success');
}

// ------ PDF Paie ------

export function generatePayrollPDFReport() {
  const reportMonth = document.getElementById('reportMonth')?.value;
  if (!reportMonth) { showToast('Sélectionnez un mois.', 'error'); return; }
  const [y, m] = reportMonth.split('-');
  const days   = getDaysInMonth(parseInt(y), parseInt(m));
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const formatPDFAmount = (amount) =>
    Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Ar';

  doc.setTextColor(0, 0, 0); // Noir pur
  doc.setFontSize(18); doc.setFont('helvetica', 'bold');
  doc.text('Rapport de Paie Mensuel', 105, 20, { align: 'center' });
  doc.setFontSize(12); doc.setFont('helvetica', 'normal');
  doc.text(`Mois: ${reportMonth}`, 105, 28, { align: 'center' });

  let totalGross = 0, totalAdv = 0, totalNet = 0;
  const rows = state.employees.map(emp => {
    const present = countPresenceDays(emp.id, reportMonth);
    const gross   = (emp.salary / days) * present;
    const advances = state.advances
      .filter(a => a.employeeId === emp.id && a.date.startsWith(reportMonth))
      .reduce((s, a) => s + a.amount, 0);
    const net = gross - advances;
    totalGross += gross; totalAdv += advances; totalNet += net;
    return [emp.name, present, formatPDFAmount(gross), formatPDFAmount(advances), formatPDFAmount(net)];
  });

  doc.autoTable({
    startY: 40,
    head: [['Employé', 'Jours', 'Brut', 'Avances', 'Net']],
    body: rows,
    theme: 'grid',
    headStyles: { fillColor: [0, 0, 0], textColor: 255 }, // Header noir pour lisibilité
    styles: { fontSize: 8.5, textColor: [0, 0, 0] }, // Texte noir pur
  });

  const fy = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(`Total Brut: ${formatPDFAmount(totalGross)}`, 14, fy);
  doc.text(`Total Avances: ${formatPDFAmount(totalAdv)}`, 14, fy + 7);
  doc.text(`Total Net: ${formatPDFAmount(totalNet)}`, 14, fy + 14);

  doc.save(`rapport-paie-${reportMonth}.pdf`);
  showToast('Rapport PDF généré!', 'success');
}

// ------ PDF Présences QR ------

export function exportQRAttendancePDF() {
  const date = document.getElementById('qrAttendanceDate')?.value;
  if (!date) { showToast('Sélectionnez une date.', 'error'); return; }
  const dayAtt = state.qrAttendance.filter(a => a.date === date);
  if (!dayAtt.length) { showToast('Aucune présence QR à exporter.', 'warning'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(18); doc.setFont('helvetica', 'bold');
  doc.text('PRÉSENCES QR CODE', 105, 20, { align: 'center' });
  doc.setFontSize(14); doc.setFont('helvetica', 'normal');
  doc.text(`Date: ${formatDate(date + 'T00:00:00')}`, 105, 30, { align: 'center' });

  dayAtt.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const rows = dayAtt.map((a, i) => [i + 1, a.employeeName, '', new Date(a.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), 'QR']);

  doc.autoTable({
    startY: 45,
    head: [['#', 'Nom', 'Poste', 'Heure', 'Méthode']],
    body: rows,
    headStyles: { fillColor: [0, 0, 0], textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 10, textColor: [0, 0, 0] },
  });

  doc.save(`presences-qr-${date}.pdf`);
  showToast('PDF exporté!', 'success');
}

// ------ Export Avances ------

export function exportAdvances(format) {
  const search = (document.getElementById('advanceSearchInput')?.value || '').toLowerCase();
  const month  = document.getElementById('advanceMonthFilter')?.value || '';
  const group  = document.getElementById('advanceGroupFilter')?.value || 'all';

  let data = state.advances.filter(a => {
    const emp = state.employees.find(e => e.id === a.employeeId);
    if (!emp) return false;
    return (emp.name.toLowerCase().includes(search) || (a.reason || '').toLowerCase().includes(search)) &&
           (!month || a.date.startsWith(month)) &&
           (group === 'all' || emp.groupId === group);
  });
  data.sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!data.length) { showToast('Aucune donnée à exporter.', 'warning'); return; }

  if (format === 'pdf') {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });
    
    // Séparateur milliers = espace
    const formatPDFAmount = (amount) =>
      Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Ar';

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(18); doc.setFont('helvetica', 'bold');
    doc.text('Liste des Avances sur Salaire', doc.internal.pageSize.getWidth() / 2, 15, { align: 'center' });

    // Colonnes : Date (étroit) · Nom · Montant · Statut
    const rows = data.map(a => {
      const emp = state.employees.find(e => e.id === a.employeeId);
      const isPaid = a.status === 'Confirmé';
      return [
        formatDate(a.date, false).split(' ').slice(0, 2).join(' '), // Date plus compacte si besoin
        emp ? emp.name : 'N/A',
        formatPDFAmount(a.amount),
        isPaid ? 'PAYÉ (Confirmé)' : 'NON PAYÉ (En attente)',
      ];
    });

    doc.autoTable({
      body: rows,
      columns: [
        { header: 'Date',     dataKey: 0 },
        { header: 'Employé', dataKey: 1 },
        { header: 'Montant', dataKey: 2 },
        { header: 'Statut du Paiement',  dataKey: 3 },
      ],
      columnStyles: {
        0: { cellWidth: 35 },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 40, halign: 'right' },
        3: { cellWidth: 50, fontStyle: 'bold' },
      },
      startY: 30, theme: 'grid',
      headStyles: { fillColor: [0, 0, 0], textColor: 255, fontStyle: 'bold', fontSize: 10 },
      styles: { fontSize: 9.5, textColor: [0, 0, 0] }, 
      minCellHeight: 12,
    });

    const total = data.reduce((s, a) => s + a.amount, 0);
    doc.setFontSize(12); doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(`TOTAL DES AVANCES: ${formatPDFAmount(total)}`, 14, doc.lastAutoTable.finalY + 10);
    
    doc.save(`export-avances-${month || 'global'}.pdf`);
    showToast('PDF exporté avec succès!', 'success');

  } else if (format === 'xlsx' && window.XLSX) {
    const headers = ["Date", "Nom", "Groupe", "Montant (Ar)", "Motif", "Statut"];
    const rows    = [headers];
    data.forEach(a => {
      const emp = state.employees.find(e => e.id === a.employeeId);
      const grp = state.groups.find(g => g.id === emp?.groupId);
      rows.push([a.date, emp ? emp.name : 'N/A', grp ? grp.name : 'Sans groupe', a.amount, a.reason || '', a.status || 'En attente']);
    });
    rows.push([], ['', '', 'Total:', data.reduce((s, a) => s + a.amount, 0)]);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Avances');
    XLSX.writeFile(wb, `export-avances-${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast('Export Excel réussi!', 'success');
  }
}
