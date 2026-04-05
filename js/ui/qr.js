// ============================================================
// ui/qr.js — QR Code Scanner & Présences QR (ES Module)
// ============================================================

import { state, saveAttendanceData } from '../state.js';
import { dbManager } from '../state.js';
import { openModal, closeModal, renderPaginationControls } from '../utils/ui.js';
import { showToast, openConfirm } from '../utils/notifications.js';
import { formatDisplayTime, formatDate } from '../utils/format.js';
import { playSuccessSound, playGenericErrorSound, playErrorSound } from '../utils/audio.js';
import { registerSectionCallback } from './navigation.js';

export function initQR() {
  registerSectionCallback('qr-presence', displayQRAttendance);
  const today = new Date().toISOString().split('T')[0];
  const el    = document.getElementById('qrAttendanceDate');
  if (el) el.value = today;
}

// ===== QR SCAN =====

export async function startQRScan(purpose) {
  if (state.isScanning) stopQRScan(false);
  state.currentScanPurpose = purpose;

  const video       = document.getElementById('qrVideo');
  const overlay     = document.getElementById('scanOverlay');
  const permMsg     = document.getElementById('cameraPermissionMessage');
  const title       = document.getElementById('qrScannerTitle');
  const instruction = document.getElementById('qrScannerInstruction');
  const result      = document.getElementById('scanResult');
  const loading     = document.getElementById('qrScannerLoading');

  result.style.display  = 'none';
  permMsg.style.display = 'none';
  if (loading) loading.style.display = 'flex';

  if (!video) {
    console.error('[QR Scanner] Élément vidéo introuvable');
    return;
  }

  const labels = {
    attendance:        ['<span class="material-icons">qr_code_scanner</span> Scanner pour Présence', "Marquer l'arrivée ou le départ."],
    payroll:           ['<span class="material-icons">payments</span> Scanner pour la Paie',          'Sélectionner un employé pour la paie.'],
    advance:           ['<span class="material-icons">savings</span> Scanner pour Avance',            "Sélectionner un employé pour une avance."],
    'advances-search': ['<span class="material-icons">search</span> Scanner pour Rechercher',        'Scannez pour rechercher les avances.'],
    'status-search':   ['<span class="material-icons">person_search</span> Recherche Statut',        'Scannez pour voir le statut employé.'],
  };
  const [t, i] = labels[purpose] || ['<span class="material-icons">qr_code_scanner</span> Scanner QR Code', ''];
  if (title)       title.innerHTML = t;
  if (instruction) instruction.textContent = i;

  state.isScanning = true;
  openModal('qrScannerModal');

  // FIX #1 : Attendre que la modal soit visible (transition CSS ~300ms)
  // avant d'initialiser le flux vidéo. Sans ce délai, video.play()
  // peut échouer si l'élément <video> n'est pas encore dans le viewport.
  await new Promise(resolve => setTimeout(resolve, 350));

  try {
    state.scanStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280, min: 640 },
        height: { ideal: 720, min: 480 }
      },
      audio: false,
    });

    video.srcObject = state.scanStream;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    // FIX #2 : forcer muted via JS (requis par les politiques autoplay navigateur)
    video.muted = true;

    // FIX #3 : gérer onloadedmetadata ET onerror pour éviter un timeout silencieux
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout vidéo')), 8000);
      video.onloadedmetadata = () => { clearTimeout(timeout); resolve(); };
      video.onerror = (e) => { clearTimeout(timeout); reject(new Error('Erreur flux vidéo')); };
    });

    await video.play();
    // FIX: removeProperty garantit que le display:none inline est effacé,
    // puis on force un repaint en lisant offsetHeight avant d'afficher.
    video.style.removeProperty('display');
    video.style.display = 'block';
    void video.offsetHeight; // force reflow/repaint
    overlay.style.display = 'block';
    if (loading) loading.style.display = 'none';

    const canvas = document.getElementById('qrCanvas');
    state.scanInterval = setInterval(() => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) _scanFrame(video, canvas);
    }, 500);
  } catch (err) {
    console.error('[QR Scanner] Erreur :', err);
    permMsg.style.display = 'flex';
    let msg = 'Permission refusée. Autorisez la caméra.';
    if (err.name === 'NotFoundError')         msg = 'Aucune caméra détectée.';
    if (err.name === 'NotReadableError')      msg = 'Caméra déjà utilisée.';
    if (err.name === 'NotAllowedError')       msg = 'Permission refusée. Autorisez la caméra dans les paramètres.';
    if (err.message === 'Timeout vidéo')      msg = 'Caméra ne répond pas. Vérifiez les permissions.';
    if (err.message === 'Erreur flux vidéo')  msg = 'Flux vidéo interrompu. Réessayez.';
    permMsg.querySelector('span').textContent = msg;
    stopQRScan();
  }
}

export function stopQRScan(showMsg = true) {
  state.scanStream?.getTracks().forEach(t => t.stop());
  state.scanStream = null;
  if (state.scanInterval) { clearInterval(state.scanInterval); state.scanInterval = null; }
  const video = document.getElementById('qrVideo');
  if (video) { video.style.display = 'none'; video.srcObject = null; }
  const overlay = document.getElementById('scanOverlay');
  if (overlay) overlay.style.display = 'none';
  closeModal('qrScannerModal');
  if (showMsg && state.isScanning) showToast('Scan annulé', 'warning');
  state.isScanning = false;
}

function _scanFrame(video, canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code    = window.jsQR?.(imgData.data, imgData.width, imgData.height);
  if (code?.data?.trim()) handleQRScanResult(code.data);
}

async function handleQRScanResult(raw) {
  const purpose = state.currentScanPurpose;
  if (state.scanInterval) { clearInterval(state.scanInterval); state.scanInterval = null; }

  // Afficher le code scanné
  _displayScannedCode(raw);

  // Détecter format
  let empId = null;
  if (raw.startsWith('BEHAVANAHR:'))          empId = raw.replace('BEHAVANAHR:', '');
  else if (raw.startsWith('BEHAVANA:'))       empId = raw.replace('BEHAVANA:', '');
  else if (raw.startsWith('{')) {
    try {
      const p = JSON.parse(raw);
      if (p.type === 'BEHAVANA_ATTENDANCE' && p.employeeId) empId = p.employeeId;
    } catch {}
  } else {
    try {
      const d = decodeURIComponent(escape(atob(raw)));
      if (d.startsWith('{')) {
        const p = JSON.parse(d);
        if (p.employeeId) empId = p.employeeId;
      }
    } catch {}
  }

  if (!empId) { showScanResult('QR Code non valide.', 'error'); playGenericErrorSound(); return; }
  const emp = state.employees.find(e => e.id === empId);
  if (!emp)  { showScanResult('Employé non trouvé.', 'error'); playGenericErrorSound(); return; }

  switch (purpose) {
    case 'attendance':
      await processAttendanceScan(emp, 'QR'); break;
    case 'payroll': {
      const sel = document.getElementById('payrollEmployeeSelect');
      if (sel) {
        if (!sel.querySelector(`option[value="${empId}"]`)) {
          const opt = document.createElement('option');
          opt.value = empId;
          opt.textContent = emp.name;
          sel.appendChild(opt);
        }
        sel.value = empId;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      showScanResult(`✅ ${emp.name} sélectionné`, 'success');
      setTimeout(() => stopQRScan(), 1500); break;
    }
    case 'advance': {
      const sel = document.getElementById('advanceEmployee');
      if (sel) {
        if (!sel.querySelector(`option[value="${empId}"]`)) {
          const opt = document.createElement('option');
          opt.value = empId;
          opt.textContent = emp.name;
          sel.appendChild(opt);
        }
        sel.value = empId;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      showScanResult(`✅ ${emp.name} sélectionné`, 'success');
      setTimeout(() => stopQRScan(), 1500); break;
    }
    case 'advances-search': {
      const si = document.getElementById('advanceSearchInput');
      if (si) { 
        si.value = emp.name; 
        si.dispatchEvent(new Event('input', { bubbles: true }));
        si.focus();
      }
      playSuccessSound();
      showScanResult(`✅ Avances de ${emp.name}`, 'success');
      setTimeout(() => stopQRScan(), 1500); break;
    }
    case 'payments-search': {
      const si = document.getElementById('paymentSearch');
      if (si) {
        si.value = emp.name;
        si.dispatchEvent(new Event('input', { bubbles: true }));
        si.focus();
      }
      playSuccessSound();
      showScanResult(`✅ Paie de ${emp.name}`, 'success');
      setTimeout(() => stopQRScan(), 1500); break;
    }
    case 'status-search': {
      document.getElementById('smartSearchInput').value = emp.name;
      window._handleSmartSearch?.();
      setTimeout(() => window._selectEmployeeForStat?.(emp.id), 300);
      showScanResult(`✅ ${emp.name}`, 'success');
      playSuccessSound();
      setTimeout(() => stopQRScan(), 1500); break;
    }
    default: break;
  }
}

// ===== ATTENDANCE SCAN =====

export async function processAttendanceScan(emp, method = 'QR', skipSound = false) {
  const now  = new Date();
  const y    = now.getFullYear();
  const mo   = String(now.getMonth() + 1).padStart(2, '0');
  const d    = String(now.getDate()).padStart(2, '0');
  const today = `${y}-${mo}-${d}`;
  const time  = now.toTimeString().split(' ')[0].substring(0, 5);

  if (!state.attendance[today]) state.attendance[today] = {};
  const existing = state.attendance[today][emp.id];

  if (!existing) {
    // Arrivée
    state.attendance[today][emp.id] = { arrivee: time, depart: null, method, checks: [{ type: 'arrivee', time, timestamp: now.toISOString() }] };
    state.qrAttendance.push({ id: `${emp.id}_${now.getTime()}`, employeeId: emp.id, employeeName: emp.name, date: today, timestamp: now.toISOString(), type: 'arrival', time });
    await saveAttendanceData();
    if (!skipSound) playSuccessSound();
    showScanResult(`<strong>✅ ARRIVÉE</strong><br><span style="font-size:1.2em;">${emp.name}</span><br>Heure: <strong>${time}</strong>`, 'success');
    _refreshAfterScan();
    setTimeout(() => stopQRScan(), 2000);
    return true;
  }

  if (!existing.depart) {
    // Départ
    existing.depart = time;
    if (!existing.checks) existing.checks = [];
    existing.checks.push({ type: 'depart', time, timestamp: now.toISOString() });
    state.qrAttendance.push({ id: `${emp.id}_${now.getTime()}`, employeeId: emp.id, employeeName: emp.name, date: today, timestamp: now.toISOString(), type: 'departure', time });
    await saveAttendanceData();
    if (!skipSound) playSuccessSound();
    showScanResult(`<strong>✅ DÉPART</strong><br><span style="font-size:1.2em;">${emp.name}</span><br>Heure: <strong>${time}</strong>`, 'success');
    _refreshAfterScan();
    setTimeout(() => stopQRScan(), 2000);
    return true;
  }

  // Déjà 2 checks → vérifier timing
  let depTime = existing.depart;
  if (depTime.split(':').length === 3) depTime = depTime.substring(0, 5);
  const lastDep = new Date(`${today}T${depTime}:00`);
  const minutes = Math.floor((now - lastDep) / 60000);

  if (minutes >= 30) {
    const confirmed = await openConfirm(
      'Mise à jour du départ',
      `<strong>${emp.name}</strong> a déjà pointé.<br/>Arrivée: <strong>${existing.arrivee}</strong> | Départ: <strong>${existing.depart}</strong><br/><br/>Mettre à jour le départ avec <strong>${time}</strong>?`,
      'Mettre à jour',
      'Annuler'
    );
    
    if (confirmed) {
      const old = existing.depart;
      existing.depart = time;
      if (!existing.checks) existing.checks = [];
      existing.checks.push({ type: 'depart_update', time, oldTime: old, timestamp: now.toISOString() });
      await saveAttendanceData();
      if (!skipSound) playSuccessSound();
      showScanResult(`<strong>✅ DÉPART MIS À JOUR</strong><br>${emp.name}`, 'success');
      _refreshAfterScan();
      setTimeout(() => stopQRScan(), 2000);
      return true;
    } else {
      playErrorSound();
      showScanResult(`<strong>⚠️ ANNULÉ</strong><br>${emp.name}`, 'warning');
      setTimeout(() => stopQRScan(), 2000);
      return false;
    }
  } else {
    playErrorSound();
    showScanResult(`<strong>❌ TROP RAPPROCHÉ</strong><br>${emp.name}<br>Seulement ${minutes} min (min 30)`, 'error');
    setTimeout(() => stopQRScan(), 4000);
    return false;
  }
}

function _refreshAfterScan() {
  if (document.getElementById('qr-presence')?.classList.contains('active')) displayQRAttendance();
  if (document.getElementById('attendance')?.classList.contains('active')) window._displayAttendance?.();
  window._updateStats?.();
  window._runSmartChecks?.();
}

// ===== DISPLAY RÉSULTAT SCAN =====

function _displayScannedCode(code) {
  const displayEl = document.getElementById('scannedCodeDisplay');
  const textEl = document.getElementById('scannedCodeText');
  if (!displayEl || !textEl) return;
  
  // Tronquer le code pour l'affichage si trop long
  const displayCode = code.length > 50 ? code.substring(0, 47) + '...' : code;
  textEl.textContent = displayCode;
  displayEl.style.display = 'block';
  
  // Masquer après 2 secondes si pas de résultat
  setTimeout(() => {
    if (displayEl.style.display === 'block') displayEl.style.display = 'none';
  }, 2000);
}

export function showScanResult(message, type) {
  const el = document.getElementById('scanResult');
  if (!el) return;
  const bg = type === 'success' ? '#d1fae5' : type === 'error' ? '#fee2e2' : '#fef3c7';
  const icon = type === 'success' ? 'check_circle' : type === 'error' ? 'error' : 'warning';
  const color = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#f59e0b';
  el.innerHTML = `
    <div style="background:${bg};padding:20px;border-radius:12px;text-align:center;">
      <span class="material-icons" style="font-size:48px;color:${color};">${icon}</span>
      <div style="margin-top:12px;font-size:15px;line-height:1.6;color:#1e293b;">${message}</div>
    </div>`;
  el.style.display = 'block';
}

// ===== QR ATTENDANCE LIST =====

export function displayQRAttendance() {
  const container = document.getElementById('qrAttendanceList');
  const date      = document.getElementById('qrAttendanceDate')?.value;
  if (!date) { container.innerHTML = '<p>Veuillez sélectionner une date.</p>'; return; }

  const dayAtt = state.attendance[date] || {};
  const sorted = [...state.employees].sort((a, b) => {
    const aP = dayAtt[a.id]?.arrivee;
    const bP = dayAtt[b.id]?.arrivee;
    if (aP && !bP) return -1;
    if (!aP && bP) return 1;
    if (aP && bP) return aP.localeCompare(bP);
    return a.name.localeCompare(b.name);
  });

  const { current, perPage } = state.pagination.qrAttendance;
  const totalPages = Math.ceil(sorted.length / perPage);
  const page       = Math.max(1, Math.min(current, totalPages || 1));
  state.pagination.qrAttendance.current = page;
  const slice = sorted.slice((page - 1) * perPage, page * perPage);

  const presentCount = Object.keys(dayAtt).length;
  const summary = `
    <div style="display:flex;gap:16px;margin-bottom:16px;padding:12px;background:var(--md-sys-color-surface-variant);border-radius:8px;">
      <div style="color:var(--md-sys-color-success);font-weight:500;"><span class="material-icons" style="vertical-align:middle;">check_circle</span> Présents: ${presentCount}</div>
      <div style="color:var(--md-sys-color-error);font-weight:500;"><span class="material-icons" style="vertical-align:middle;">cancel</span> Absents: ${state.employees.length - presentCount}</div>
      <div style="color:var(--md-sys-color-on-surface-variant);font-weight:500;"><span class="material-icons" style="vertical-align:middle;">people</span> Total: ${state.employees.length}</div>
    </div>`;

  container.innerHTML = summary + slice.map(emp => {
    const p = dayAtt[emp.id];
    if (p?.arrivee) {
      const m = p.method || 'MANUAL';
      const badge = m === 'FACIAL' ? `<span class="material-icons" style="font-size:14px;color:#0ea5e9;">face</span><span style="font-size:12px;color:#0ea5e9;font-weight:600;">FACIAL</span>`
        : m === 'QR' ? `<span class="material-icons" style="font-size:14px;color:#6750A4;">qr_code_scanner</span><span style="font-size:12px;color:#6750A4;font-weight:600;">QR</span>`
        : `<span class="material-icons" style="font-size:14px;color:#f59e0b;">edit</span><span style="font-size:12px;color:#f59e0b;font-weight:600;">MANUEL</span>`;
      return `
        <div class="employee-qr-item">
          <div class="employee-qr-info"><h4>${emp.name}</h4><p>${emp.position}</p></div>
          <div>
            <div class="qr-status present"><span class="material-icons">check_circle</span><span>Présent</span></div>
            <div style="font-size:12px;text-align:right;margin-top:4px;">Arrivée: <strong>${formatDisplayTime(p.arrivee)}</strong> | Départ: <strong>${formatDisplayTime(p.depart)}</strong> ${badge}</div>
          </div>
        </div>`;
    }
    return `
      <div class="employee-qr-item">
        <div class="employee-qr-info"><h4>${emp.name}</h4><p>${emp.position}</p></div>
        <div class="qr-status absent"><span class="material-icons">cancel</span><span>Absent</span></div>
      </div>`;
  }).join('');

  renderPaginationControls('qrAttendancePagination', page, totalPages, sorted.length, perPage, p => {
    state.pagination.qrAttendance.current = p;
    displayQRAttendance();
  });
}

// ===== QR CODES GENERATION =====

export async function generateAllQRCodes() {
  const container = document.getElementById('qrContainer');
  if (!state.employees.length) {
    container.innerHTML = `<div style="text-align:center;padding:60px;"><span class="material-icons" style="font-size:64px;opacity:.5;">person_off</span><h3>Aucun employé</h3></div>`;
    return;
  }
  container.innerHTML = `<div style="text-align:center;padding:60px;"><h3>Génération...</h3><p id="progressText">0/${state.employees.length}</p></div>`;

  const cards = [];
  for (let i = 0; i < state.employees.length; i++) {
    const emp = state.employees[i];
    document.getElementById('progressText').textContent = `${i + 1}/${state.employees.length}`;
    const dataURL = await _generateQRCode(emp);
    if (!dataURL) continue;
    try {
      await dbManager.put('qr_codes', {
        employeeId: emp.id, employeeName: emp.name, employeePosition: emp.position,
        employeeGroupId: emp.groupId, dataURL,
        generated: new Date().toISOString(), size: state.qrSettings.size, color: state.qrSettings.color,
      });
    } catch {}
    const group = state.groups.find(g => g.id === emp.groupId);
    cards.push(`
      <div class="qr-card" data-employee-id="${emp.id}">
        <div class="qr-card-header"><h4>${emp.name}</h4><p class="qr-position">${emp.position}</p>
          <span class="qr-group-badge"><span class="material-icons" style="font-size:14px;">group</span>${group ? group.name : 'Sans groupe'}</span></div>
        <div class="qr-code-canvas"><img src="${dataURL}" width="200" height="200" style="width:200px;height:200px;image-rendering:pixelated;display:block;"></div>
        <div class="qr-actions">
          <button class="btn-icon" onclick="window._downloadQRFromDB?.('${emp.id}')" title="Télécharger"><span class="material-icons">download</span></button>
          <button class="btn-icon" onclick="window._printQRFromDB?.('${emp.id}')" title="Imprimer"><span class="material-icons">print</span></button>
        </div>
      </div>`);
  }
  container.innerHTML = cards.join('') || '<p>Échec de génération.</p>';
  showToast(`✅ ${cards.length} QR codes générés!`, 'success');
}

function _generateQRCode(emp) {
  return new Promise(resolve => {
    try {
      const tmp = document.createElement('div');
      tmp.style.cssText = 'display:none;position:absolute;left:-9999px;';
      document.body.appendChild(tmp);

      // Taille native haute résolution pour scan écran fiable
      // On génère à 512px natif (pas d'upscaling post-rendu)
      const nativeSize = 512;

      new QRCode(tmp, {
        text: `BEHAVANAHR:${emp.id}`,
        width: nativeSize,
        height: nativeSize,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M, // M = 15% correction, robuste aux reflets écran
      });

      setTimeout(() => {
        const canvas = tmp.querySelector('canvas');
        if (canvas) {
          // Ajout d'une quiet zone (marge blanche) de 4 modules autour
          // Les specs QR exigent 4 modules minimum — QRCode.js peut l'omettre
          const quietZone = 32; // 32px = ~4 modules à 512px
          const finalSize = canvas.width + quietZone * 2;
          const finalCanvas = document.createElement('canvas');
          finalCanvas.width  = finalSize;
          finalCanvas.height = finalSize;
          const ctx = finalCanvas.getContext('2d');

          // Fond blanc (quiet zone)
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, finalSize, finalSize);

          // Désactiver l'anti-aliasing pour des modules nets
          ctx.imageSmoothingEnabled = false;

          // Copier le QR centré sur le fond blanc
          ctx.drawImage(canvas, quietZone, quietZone, canvas.width, canvas.height);

          const url = finalCanvas.toDataURL('image/png', 1.0);
          document.body.removeChild(tmp);
          resolve(url);
        } else {
          document.body.removeChild(tmp);
          resolve(null);
        }
      }, 300);
    } catch (err) {
      console.error('[QR Generation] Erreur :', err);
      resolve(null);
    }
  });
}

export async function downloadQRFromDB(empId) {
  const qr  = await dbManager.get('qr_codes', empId);
  if (!qr)  { showToast('QR non trouvé. Générez d\'abord.', 'error'); return; }
  const a   = document.createElement('a');
  a.href    = qr.dataURL;
  a.download = `qr-${qr.employeeName.replace(/\s+/g, '-')}.png`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  showToast(`✅ QR de ${qr.employeeName} téléchargé!`, 'success');
}

export async function printAllQRCodes() {
  const all = await dbManager.getAll('qr_codes');
  if (!all.length) { showToast('Aucun QR. Générez d\'abord.', 'error'); return; }
  const items = all.map(qr => {
    const emp = state.employees.find(e => e.id === qr.employeeId);
    if (!emp || !qr.dataURL) return '';
    return `<div class="qr-item-print"><h3>${emp.name}</h3><p>${emp.position}</p><img src="${qr.dataURL}" alt="QR"><p>Scanner pour présence</p></div>`;
  }).join('');
  const w = window.open('', '_blank');
  w.document.write(`<html><head><title>QR Codes</title><style>body{font-family:Arial}.page-container{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:15px}.qr-item-print{border:1px solid #666;padding:15px;text-align:center;page-break-inside:avoid}img{max-width:180px}</style></head><body><div class="page-container">${items}</div></body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 500);
}

export function filterQRCodes() {
  const term  = document.getElementById('qrSearchInput')?.value.toLowerCase().trim() || '';
  const cards = document.querySelectorAll('.qr-card');
  let visible = 0;
  cards.forEach(c => {
    const match = c.querySelector('h4')?.textContent.toLowerCase().includes(term) ||
                  c.querySelector('p')?.textContent.toLowerCase().includes(term);
    c.style.display = match ? 'block' : 'none';
    if (match) visible++;
  });
  const res = document.getElementById('qrSearchResults');
  if (res) res.style.display = term ? 'block' : 'none';
  const cnt = document.getElementById('qrResultCount');
  if (cnt) cnt.innerHTML = visible ? `✅ <strong>${visible}</strong> résultat(s)` : `❌ Aucun résultat pour "${term}"`;
}

export async function handleQRImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.src = e.target.result;
    img.onload = () => {
      const canvas = document.getElementById('qrCanvas');
      const ctx    = canvas.getContext('2d');
      canvas.width = img.width; canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR?.(data.data, canvas.width, canvas.height);
      if (code) handleQRScanResult(code.data);
      else showToast('Aucun QR code détecté.', 'error');
    };
  };
  reader.readAsDataURL(file);
}

// Expose
window._downloadQRFromDB = downloadQRFromDB;
window._printQRFromDB    = async (id) => {
  const qr  = await dbManager.get('qr_codes', id);
  if (!qr) return;
  const w = window.open('', '_blank');
  w.document.write(`<html><body style="text-align:center;font-family:Arial;padding:30px;"><h2>${qr.employeeName}</h2><p>${qr.employeePosition}</p><img src="${qr.dataURL}" style="width:280px;border:4px solid #6750A4;border-radius:12px;padding:12px;"><p><strong>BEHAVANA HR SYSTEM</strong></p></body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 500);
};
