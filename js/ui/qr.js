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
import { checkAndShowEmployeeAlerts, TRIGGER_POINTS } from '../utils/alert-system.js';

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
  // VÉRIFICATION DES ALERTES AVANT LE POINTAGE
  const triggerPoint = method === 'QR' ? TRIGGER_POINTS.QR_SCAN : 
                       method === 'FACIAL' ? TRIGGER_POINTS.FACIAL_SCAN : 
                       TRIGGER_POINTS.MANUAL_ATTENDANCE;
  
  const alertResult = await checkAndShowEmployeeAlerts(emp.id, triggerPoint, {
    showNonBlocking: true
  });
  
  // Si des alertes bloquantes et que l'utilisateur a annulé, on arrête
  if (!alertResult.confirmed) {
    playErrorSound();
    showScanResult(`<strong>⚠️ POINTAGE BLOQUÉ</strong><br>${emp.name}<br>Veuillez contacter le responsable.`, 'error');
    setTimeout(() => stopQRScan(), 3000);
    return false;
  }

  const now  = new Date();
  const y    = now.getFullYear();
  const mo   = String(now.getMonth() + 1).padStart(2, '0');
  const d    = String(now.getDate()).padStart(2, '0');
  const today = `${y}-${mo}-${d}`;
  const time  = now.toTimeString().split(' ')[0].substring(0, 5);

  if (!state.attendance[today]) state.attendance[today] = {};
  const raw = state.attendance[today][emp.id];

  // Normaliser l'ancien format booléen (true) en objet structuré
  const existing = (raw && typeof raw === 'object')
    ? raw
    : raw === true
      ? { arrivee: '--:--', depart: null, checks: [] }
      : null;

  // Réécrire en place si c'était un booléen
  if (raw === true) state.attendance[today][emp.id] = existing;

  if (!existing) {
    // Arrivée
    state.attendance[today][emp.id] = { arrivee: time, depart: null, method, checks: [{ type: 'arrivee', time, timestamp: now.toISOString() }] };
    state.qrAttendance.push({ id: `${emp.id}_${now.getTime()}`, employeeId: emp.id, employeeName: emp.name, date: today, timestamp: now.toISOString(), type: 'arrival', time });
    await saveAttendanceData();
    if (!skipSound) playSuccessSound();
    showScanResult(`<strong>✅ ARRIVÉE</strong><br>${emp.name}<br>Heure: <strong>${time}</strong>`, 'success');
    _refreshAfterScan();
    setTimeout(() => stopQRScan(), 2000);
    return true;
  }

  if (!existing.depart) {
    // ✅ FIX: délai minimum de 2 min entre arrivée et départ — évite qu'un
    // second scan rapproché de la même personne (double-appui, visage encore
    // dans le cadre, etc.) soit enregistré comme départ instantané.
    // Symétrique à la règle des 30 min déjà existante plus bas pour la
    // mise à jour d'un départ déjà enregistré.
    let arrTime = existing.arrivee;
    if (arrTime && arrTime.split(':').length === 3) arrTime = arrTime.substring(0, 5);
    const lastArr = arrTime ? new Date(`${today}T${arrTime}:00`) : null;
    const minSinceArrival = lastArr ? Math.floor((now - lastArr) / 60000) : Infinity;

    if (minSinceArrival < 2) {
      playErrorSound();
      showScanResult(`<strong>❌ TROP RAPPROCHÉ</strong><br>${emp.name}<br>Arrivée il y a ${minSinceArrival} min (min 2)`, 'error');
      setTimeout(() => stopQRScan(), 4000);
      return false;
    }

    // Départ
    existing.depart = time;
    if (!existing.checks) existing.checks = [];
    existing.checks.push({ type: 'depart', time, timestamp: now.toISOString() });
    state.qrAttendance.push({ id: `${emp.id}_${now.getTime()}`, employeeId: emp.id, employeeName: emp.name, date: today, timestamp: now.toISOString(), type: 'departure', time });
    await saveAttendanceData();
    if (!skipSound) playSuccessSound();
    showScanResult(`<strong>✅ DÉPART</strong><br>${emp.name}<br>Heure: <strong>${time}</strong>`, 'success');
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
  // ✅ FIX Cause racine #1: la section face-presence n'était jamais rafraîchie ici.
  // processAttendanceScan() enregistre correctement le pointage facial dans
  // state.attendance (arrivée/départ), mais sans cet appel la page
  // "Pointages Faciaux du Jour" restait figée après un scan reçu du téléphone
  // (scan-receiver.js::_handleAttendanceScan → processAttendanceScan(emp, 'FACIAL'))
  // tant que l'utilisateur ne quittait/revenait pas sur la section.
  if (document.getElementById('face-presence')?.classList.contains('active')) window._displayFaceAttendance?.();
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
    <div style="background:${bg};padding:10px 14px;border-radius:10px;text-align:center;">
      <span class="material-icons" style="font-size:28px;color:${color};">${icon}</span>
      <div style="margin-top:4px;font-size:13px;line-height:1.5;color:#1e293b;">${message}</div>
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
  // FIX : dbManager.put('qr_codes', ...) avale toute erreur réseau en
  // interne (state.js) sans jamais la signaler à l'appelant. On ne modifie
  // pas cette fonction partagée — elle est aussi utilisée par le système
  // de PIN (_savePin() dans auth.js) qu'on ne touche pas. À la place, on
  // fait ici un appel direct avec le même format de payload, pour pouvoir
  // détecter l'échec de persistance sans rien changer côté state.js.
  let persistFailures = 0;
  for (let i = 0; i < state.employees.length; i++) {
    const emp = state.employees[i];
    document.getElementById('progressText').textContent = `${i + 1}/${state.employees.length}`;
    const dataURL = await _generateQRCode(emp);
    if (!dataURL) continue;

    const item = {
      employeeId: emp.id, employeeName: emp.name, employeePosition: emp.position,
      employeeGroupId: emp.groupId, dataURL,
      generated: new Date().toISOString(), size: state.qrSettings.size, color: state.qrSettings.color,
    };
    let persisted = true;
    try {
      const res = await fetch('/api/qr/codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: item.employeeId,
          payload:    JSON.stringify(item),
          generated:  item.generated,
          size:       item.size || null,
          color:      item.color || null,
        }),
      });
      persisted = res.ok;
    } catch (err) {
      persisted = false;
      console.warn('[QR Generation] Échec de persistance pour', emp.name, ':', err.message);
    }
    if (!persisted) persistFailures++;

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
  if (persistFailures > 0) {
    showToast(`⚠️ ${cards.length - persistFailures}/${cards.length} QR codes générés — ${persistFailures} non sauvegardé(s) sur le serveur (connexion perdue). Réessayez.`, 'warning');
  } else {
    showToast(`✅ ${cards.length} QR codes générés!`, 'success');
  }
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
  // FIX : le QR est déjà affiché dans le DOM (dataURL de l'<img> de la
  // carte) — pas besoin de re-fetch le serveur pour un QR généré cette
  // session, ce qui échouait systématiquement hors ligne. Fallback serveur
  // conservé pour un QR généré lors d'une session précédente.
  const cardImg = document.querySelector(`.qr-card[data-employee-id="${empId}"] img`);
  let dataURL = cardImg?.src;
  let employeeName = state.employees.find(e => e.id === empId)?.name;

  if (!dataURL) {
    const qr = await dbManager.get('qr_codes', empId);
    if (!qr) { showToast('QR non trouvé. Générez d\'abord.', 'error'); return; }
    dataURL = qr.dataURL;
    employeeName = qr.employeeName;
  }

  const a    = document.createElement('a');
  a.href     = dataURL;
  a.download = `qr-${(employeeName || empId).replace(/\s+/g, '-')}.png`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  showToast(`✅ QR de ${employeeName || 'employé'} téléchargé!`, 'success');
}

export async function printAllQRCodes() {
  // FIX : priorité aux cartes déjà rendues dans le DOM (générées cette
  // session) — dbManager.getAll('qr_codes') dépend entièrement du serveur
  // et renvoie une liste vide hors ligne, même juste après une génération
  // réussie à l'écran.
  const domCards = document.querySelectorAll('#qrContainer .qr-card');
  let items = '';
  if (domCards.length) {
    items = Array.from(domCards).map(card => {
      const emp = state.employees.find(e => e.id === card.dataset.employeeId);
      const img = card.querySelector('img');
      if (!emp || !img?.src) return '';
      return `<div class="qr-item-print"><div class="qr-badge-header"><h3>${emp.name}</h3><p class="qr-position">${emp.position}</p></div><img src="${img.src}" alt="QR"><p class="qr-badge-footer">BEHAVANA HR</p></div>`;
    }).join('');
  } else {
    const all = await dbManager.getAll('qr_codes');
    items = all.map(qr => {
      const emp = state.employees.find(e => e.id === qr.employeeId);
      if (!emp || !qr.dataURL) return '';
      return `<div class="qr-item-print"><div class="qr-badge-header"><h3>${emp.name}</h3><p class="qr-position">${emp.position}</p></div><img src="${qr.dataURL}" alt="QR"><p class="qr-badge-footer">BEHAVANA HR</p></div>`;
    }).join('');
  }
  if (!items) { showToast('Aucun QR. Générez d\'abord.', 'error'); return; }
  const w = window.open('', '_blank');
  if (!w) { showToast('Fenêtre bloquée par le navigateur (pop-up).', 'error'); return; }
  w.document.write(`
    <html>
    <head>
      <title>QR Codes — BEHAVANA HR</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; }

        /* 3 colonnes × 4 lignes = 12 badges par page A4 portrait
           (au lieu de 2×3=6). Dimensionné en mm pour un rendu fidèle à
           l'impression quelle que soit la résolution d'écran. */
        .page-container {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 4mm;
          padding: 8mm;
        }

        .qr-item-print {
          border: 1px solid #d1d5db;
          border-radius: 10px;
          overflow: hidden;
          text-align: center;
          page-break-inside: avoid;
          break-inside: avoid;
          display: flex;
          flex-direction: column;
          align-items: center;
          background: #fff;
        }

        /* Bandeau coloré nom/poste — look badge standard */
        .qr-badge-header {
          width: 100%;
          background: #6750A4;
          color: #fff;
          padding: 3mm 2mm 2mm;
        }

        .qr-item-print h3 {
          font-size: 11px;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          width: 100%;
        }

        .qr-item-print .qr-position {
          font-size: 8.5px;
          font-weight: 400;
          opacity: .9;
          margin-top: 1px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          width: 100%;
        }

        /* QR en mm : taille lisible et stable à l'impression (38mm ≈
           largement au-dessus du seuil de scan fiable ~25-30mm) */
        .qr-item-print img {
          width: 38mm;
          height: 38mm;
          display: block;
          margin: 3mm auto 2mm;
          image-rendering: pixelated;
        }

        .qr-badge-footer {
          font-size: 7px;
          color: #9ca3af;
          letter-spacing: .5px;
          text-transform: uppercase;
          font-weight: 600;
          margin-bottom: 3mm;
        }

        @media print {
          @page { margin: 6mm; size: A4 portrait; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .page-container { padding: 0; }
        }
      </style>
    </head>
    <body>
      <div class="page-container">${items}</div>
    </body>
    </html>`);
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
  // FIX : même logique DOM-first que downloadQRFromDB. Auparavant, un
  // échec silencieux (`return;` sans toast) donnait l'impression que le
  // bouton "Imprimer" ne faisait rien.
  const cardImg = document.querySelector(`.qr-card[data-employee-id="${id}"] img`);
  const emp     = state.employees.find(e => e.id === id);
  let dataURL = cardImg?.src, employeeName = emp?.name, employeePosition = emp?.position;

  if (!dataURL) {
    const qr = await dbManager.get('qr_codes', id);
    if (!qr) { showToast('QR non trouvé. Générez d\'abord.', 'error'); return; }
    dataURL = qr.dataURL; employeeName = qr.employeeName; employeePosition = qr.employeePosition;
  }

  const w = window.open('', '_blank');
  if (!w) { showToast('Fenêtre bloquée par le navigateur (pop-up).', 'error'); return; }
  w.document.write(`<html><body style="text-align:center;font-family:Arial;padding:30px;"><h2>${employeeName}</h2><p>${employeePosition || ''}</p><img src="${dataURL}" style="width:280px;border:4px solid #6750A4;border-radius:12px;padding:12px;"><p><strong>BEHAVANA HR SYSTEM</strong></p></body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 500);
};