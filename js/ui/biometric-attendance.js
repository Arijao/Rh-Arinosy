// ============================================================
// ui/biometric-attendance.js
// Section UI — Pointage biométrique
// Responsabilités :
//   - Connexion / déconnexion du périphérique
//   - Affichage temps réel des pointages
//   - Configuration réseau (ISAPI)
//   - Enrôlement des employés
//   - Rattrapage offline
// ============================================================

import { state }                         from '../state.js';
import { showToast }                     from '../utils/notifications.js';
import { formatDisplayTime }             from '../utils/format.js';
import { registerSectionCallback }       from './navigation.js';
import { biometricService, TRANSPORT }   from '../biometric/biometric-service.js';
import { biometricAPI }                  from '../biometric/biometric-api.js';
import { biometricSync }                 from '../biometric/biometric-sync.js';

// ============================================================
// État local du module
// ============================================================

const localState = {
  connected:     false,
  transport:     null,
  deviceName:    '',
  recentScans:   [],   // Max 50 derniers pointages affichés
  networkConfig: null, // { host, port, user, password }
  enrolling:     null, // employeeId en cours d'enrôlement
};

const MAX_RECENT_SCANS = 50;

// ============================================================
// Initialisation
// ============================================================

export function initBiometricAttendance() {
  registerSectionCallback('biometric', renderBiometricSection);
  _bindServiceEvents();
  _bindUIEvents();
  console.log('[BiometricAttendance] Module initialisé');
}

// ============================================================
// Rendu principal
// ============================================================

export function renderBiometricSection() {
  const container = document.getElementById('biometricSection');
  if (!container) return;

  container.innerHTML = _buildSectionHTML();
  _bindSectionEvents();
  _updateConnectionUI();
  _renderRecentScans();
}

function _buildSectionHTML() {
  return `
    <!-- En-tête connexion -->
    <div class="bio-header">
      <div class="bio-device-status" id="bioDeviceStatus">
        <span class="bio-status-dot" id="bioStatusDot"></span>
        <span class="bio-status-label" id="bioStatusLabel">Non connecté</span>
        <span class="bio-transport-badge" id="bioTransportBadge" style="display:none"></span>
      </div>
      <div class="bio-header-actions">
        <button class="btn btn-secondary btn-sm" id="bioConfigBtn" title="Configuration réseau">
          <span class="material-icons">settings</span>
        </button>
        <button class="btn btn-primary" id="bioConnectBtn">
          <span class="material-icons">fingerprint</span>
          Connecter
        </button>
      </div>
    </div>

    <!-- Panneau de configuration réseau (masqué par défaut) -->
    <div class="bio-config-panel" id="bioConfigPanel" style="display:none">
      <h3 class="bio-config-title">Configuration périphérique réseau</h3>
      <div class="bio-config-grid">
        <div class="form-group">
          <label for="bioConfigHost">Adresse IP / Hôte</label>
          <input type="text" id="bioConfigHost" class="form-control"
                 placeholder="192.168.1.64" autocomplete="off">
        </div>
        <div class="form-group">
          <label for="bioConfigPort">Port</label>
          <input type="number" id="bioConfigPort" class="form-control"
                 value="80" min="1" max="65535">
        </div>
        <div class="form-group">
          <label for="bioConfigUser">Utilisateur</label>
          <input type="text" id="bioConfigUser" class="form-control"
                 value="admin" autocomplete="off">
        </div>
        <div class="form-group">
          <label for="bioConfigPassword">Mot de passe</label>
          <input type="password" id="bioConfigPassword" class="form-control"
                 autocomplete="new-password">
        </div>
      </div>
      <div class="bio-config-actions">
        <button class="btn btn-secondary btn-sm" id="bioConfigCancelBtn">Annuler</button>
        <button class="btn btn-primary btn-sm" id="bioConfigSaveBtn">
          <span class="material-icons">save</span>
          Enregistrer et connecter
        </button>
      </div>
    </div>

    <!-- Statistiques du jour -->
    <div class="bio-stats-row" id="bioStatsRow">
      ${_buildStatsHTML()}
    </div>

    <!-- Zone de scan en temps réel -->
    <div class="bio-scan-zone" id="bioScanZone">
      <div class="bio-scan-indicator" id="bioScanIndicator">
        <div class="bio-fingerprint-icon">
          <span class="material-icons">fingerprint</span>
        </div>
        <p class="bio-scan-message" id="bioScanMessage">
          Connectez un lecteur d'empreintes pour démarrer le pointage
        </p>
      </div>
    </div>

    <!-- Onglets : Pointages récents / Enrôlement / Sync -->
    <div class="bio-tabs">
      <button class="bio-tab active" data-tab="scans">
        <span class="material-icons">list_alt</span>
        Pointages récents
      </button>
      <button class="bio-tab" data-tab="enroll">
        <span class="material-icons">person_add</span>
        Enrôlement
      </button>
      <button class="bio-tab" data-tab="sync">
        <span class="material-icons">sync</span>
        Synchronisation
      </button>
    </div>

    <!-- Contenu des onglets -->
    <div class="bio-tab-content active" id="bioTabScans">
      <div class="bio-scans-list" id="bioScansList">
        <p class="bio-empty-state">Aucun pointage récent</p>
      </div>
    </div>

    <div class="bio-tab-content" id="bioTabEnroll" style="display:none">
      ${_buildEnrollHTML()}
    </div>

    <div class="bio-tab-content" id="bioTabSync" style="display:none">
      ${_buildSyncHTML()}
    </div>
  `;
}

function _buildStatsHTML() {
  const today = _todayStr();
  const records = Object.values(state.attendance || {}).flatMap(emp =>
    Object.entries(emp).filter(([date]) => date === today).map(([, r]) => r)
  ).filter(r => r.source === 'biometric');

  const present = records.filter(r => r.timeIn).length;
  const complete = records.filter(r => r.timeIn && r.timeOut).length;

  return `
    <div class="bio-stat-card">
      <span class="bio-stat-value">${present}</span>
      <span class="bio-stat-label">Arrivées aujourd'hui</span>
    </div>
    <div class="bio-stat-card">
      <span class="bio-stat-value">${complete}</span>
      <span class="bio-stat-label">Départs enregistrés</span>
    </div>
    <div class="bio-stat-card">
      <span class="bio-stat-value">${present - complete}</span>
      <span class="bio-stat-label">Encore présents</span>
    </div>
    <div class="bio-stat-card">
      <span class="bio-stat-value">${localState.recentScans.length}</span>
      <span class="bio-stat-label">Scans cette session</span>
    </div>
  `;
}

function _buildEnrollHTML() {
  const employees = (state.employees || []).filter(e => e.active !== false);
  return `
    <div class="bio-enroll-intro">
      <span class="material-icons bio-enroll-icon">touch_app</span>
      <p>Sélectionnez un employé puis suivez les instructions sur le lecteur d'empreintes.</p>
    </div>
    <div class="form-group">
      <label for="bioEnrollEmployee">Employé à enrôler</label>
      <select id="bioEnrollEmployee" class="form-control">
        <option value="">— Choisir un employé —</option>
        ${employees.map(e => `<option value="${e.id}">${e.name || e.nom || e.id}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label for="bioEnrollFinger">Doigt (index)</label>
      <select id="bioEnrollFinger" class="form-control">
        <option value="1">Index droit (recommandé)</option>
        <option value="2">Index gauche</option>
        <option value="3">Pouce droit</option>
        <option value="4">Pouce gauche</option>
        <option value="5">Majeur droit</option>
      </select>
    </div>
    <div class="bio-enroll-progress" id="bioEnrollProgress" style="display:none">
      <div class="bio-progress-bar"><div class="bio-progress-fill" id="bioProgressFill"></div></div>
      <p class="bio-progress-message" id="bioProgressMessage">Initialisation...</p>
    </div>
    <button class="btn btn-primary" id="bioEnrollBtn" disabled>
      <span class="material-icons">how_to_reg</span>
      Démarrer l'enrôlement
    </button>
  `;
}

function _buildSyncHTML() {
  const lastSync = localStorage.getItem('biometric_last_sync');
  const lastSyncStr = lastSync
    ? new Date(lastSync).toLocaleString('fr-FR')
    : 'Jamais';

  const queueRaw   = localStorage.getItem('biometric_pending_queue');
  const queueCount = queueRaw ? JSON.parse(queueRaw).length : 0;

  return `
    <div class="bio-sync-info">
      <div class="bio-sync-row">
        <span class="material-icons">schedule</span>
        <div>
          <strong>Dernière synchronisation</strong>
          <span>${lastSyncStr}</span>
        </div>
      </div>
      <div class="bio-sync-row">
        <span class="material-icons">pending</span>
        <div>
          <strong>Pointages en attente</strong>
          <span id="bioPendingCount">${queueCount} en file</span>
        </div>
      </div>
    </div>
    <div class="bio-sync-actions">
      <button class="btn btn-secondary" id="bioCatchUpBtn">
        <span class="material-icons">cloud_download</span>
        Rattrapage depuis le périphérique
      </button>
      <button class="btn btn-secondary" id="bioPushEmployeesBtn">
        <span class="material-icons">cloud_upload</span>
        Pousser les employés vers le device
      </button>
      <button class="btn btn-secondary" id="bioFlushQueueBtn" ${queueCount === 0 ? 'disabled' : ''}>
        <span class="material-icons">send</span>
        Vider la file d'attente (${queueCount})
      </button>
    </div>
    <div class="bio-sync-log" id="bioSyncLog"></div>
  `;
}

// ============================================================
// Binding des événements de section
// ============================================================

function _bindSectionEvents() {
  // Connexion / déconnexion
  document.getElementById('bioConnectBtn')?.addEventListener('click', _handleConnectToggle);

  // Configuration
  document.getElementById('bioConfigBtn')?.addEventListener('click', _toggleConfigPanel);
  document.getElementById('bioConfigCancelBtn')?.addEventListener('click', _toggleConfigPanel);
  document.getElementById('bioConfigSaveBtn')?.addEventListener('click', _handleNetworkConfig);

  // Onglets
  document.querySelectorAll('.bio-tab').forEach(tab => {
    tab.addEventListener('click', () => _switchTab(tab.dataset.tab));
  });

  // Enrôlement
  const enrollSelect = document.getElementById('bioEnrollEmployee');
  const enrollBtn    = document.getElementById('bioEnrollBtn');
  enrollSelect?.addEventListener('change', () => {
    if (enrollBtn) enrollBtn.disabled = !enrollSelect.value;
  });
  enrollBtn?.addEventListener('click', _handleEnroll);

  // Sync
  document.getElementById('bioCatchUpBtn')?.addEventListener('click', _handleCatchUp);
  document.getElementById('bioPushEmployeesBtn')?.addEventListener('click', _handlePushEmployees);
  document.getElementById('bioFlushQueueBtn')?.addEventListener('click', _handleFlushQueue);
}

// ============================================================
// Événements du BiometricService
// ============================================================

function _bindServiceEvents() {
  biometricService.addEventListener('connected', (e) => {
    localState.connected  = true;
    localState.transport  = e.detail.transport;
    localState.deviceName = e.detail.device;
    biometricSync.start();
    biometricService.startListening();
    _updateConnectionUI();
    showToast(`Lecteur connecté : ${e.detail.device}`, 'success');
  });

  biometricService.addEventListener('disconnected', (e) => {
    localState.connected = false;
    biometricSync.stop();
    _updateConnectionUI();
    if (e.detail.unexpected) {
      showToast('Lecteur déconnecté de manière inattendue', 'warning');
    }
  });

  biometricService.addEventListener('status', (e) => {
    _updateStatusLabel(e.detail.message, e.detail.state);
  });

  // Pointage reçu → mis à jour par biometric-sync via event window
  window.addEventListener('biometric-attendance', _handleAttendanceEvent);
  window.addEventListener('biometric-device-error', _handleDeviceError);
}

function _bindUIEvents() {
  // Écoute les mises à jour du state pour rafraîchir les stats
  window.addEventListener('biometric-attendance', () => {
    const statsRow = document.getElementById('bioStatsRow');
    if (statsRow) statsRow.innerHTML = _buildStatsHTML();
  });
}

// ============================================================
// Handlers
// ============================================================

async function _handleConnectToggle() {
  const btn = document.getElementById('bioConnectBtn');
  if (localState.connected) {
    await biometricService.disconnect();
    if (btn) {
      btn.innerHTML = '<span class="material-icons">fingerprint</span> Connecter';
      btn.classList.replace('btn-danger', 'btn-primary');
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons">hourglass_top</span> Connexion...';
  }

  try {
    await biometricService.autoConnect(localState.networkConfig);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons">link_off</span> Déconnecter';
      btn.classList.replace('btn-primary', 'btn-danger');
    }
  } catch (err) {
    showToast(`Connexion échouée : ${err.message}`, 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons">fingerprint</span> Connecter';
    }
  }
}

function _handleNetworkConfig() {
  const host     = document.getElementById('bioConfigHost')?.value.trim();
  const port     = parseInt(document.getElementById('bioConfigPort')?.value) || 80;
  const user     = document.getElementById('bioConfigUser')?.value.trim() || 'admin';
  const password = document.getElementById('bioConfigPassword')?.value;

  if (!host) {
    showToast('Adresse IP requise', 'warning');
    return;
  }

  localState.networkConfig = { host, port, user, password };
  biometricAPI.configureNetwork({ host, port, user, password });
  _toggleConfigPanel();
  showToast('Configuration réseau enregistrée', 'success');

  // Lancer la connexion automatiquement après config
  _handleConnectToggle();
}

async function _handleEnroll() {
  const employeeId  = document.getElementById('bioEnrollEmployee')?.value;
  const fingerIndex = parseInt(document.getElementById('bioEnrollFinger')?.value) || 1;
  if (!employeeId) return;

  const progressDiv = document.getElementById('bioEnrollProgress');
  const progressMsg = document.getElementById('bioProgressMessage');
  const progressFill= document.getElementById('bioProgressFill');
  const enrollBtn   = document.getElementById('bioEnrollBtn');

  if (progressDiv) progressDiv.style.display = 'block';
  if (enrollBtn)   enrollBtn.disabled = true;

  let progressValue = 0;
  const onProgress = ({ step, message }) => {
    if (progressMsg)  progressMsg.textContent = message;
    progressValue = step === 'start' ? 20 : step === 'waiting' ? 60 : 100;
    if (progressFill) progressFill.style.width = `${progressValue}%`;
  };

  try {
    await biometricAPI.enroll({ employeeId, fingerIndex }, onProgress);
    showToast('Empreinte enrôlée avec succès', 'success');
  } catch (err) {
    showToast(`Enrôlement échoué : ${err.message}`, 'error');
    if (progressMsg) progressMsg.textContent = `Erreur : ${err.message}`;
  } finally {
    if (enrollBtn) enrollBtn.disabled = false;
    setTimeout(() => {
      if (progressDiv) progressDiv.style.display = 'none';
      if (progressFill) progressFill.style.width = '0%';
    }, 3000);
  }
}

async function _handleCatchUp() {
  const btn = document.getElementById('bioCatchUpBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Récupération...'; }
  _logSync('Démarrage du rattrapage...');

  try {
    const result = await biometricSync.catchUp();
    const msg = `Rattrapage terminé : ${result.imported} importés, ${result.duplicates} doublons, ${result.errors} erreurs`;
    _logSync(msg);
    showToast(msg, result.errors > 0 ? 'warning' : 'success');
  } catch (err) {
    _logSync(`Erreur : ${err.message}`);
    showToast(`Rattrapage échoué : ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons">cloud_download</span> Rattrapage depuis le périphérique';
    }
  }
}

async function _handlePushEmployees() {
  const btn = document.getElementById('bioPushEmployeesBtn');
  if (btn) btn.disabled = true;
  _logSync('Envoi des employés vers le périphérique...');

  try {
    const result = await biometricSync.pushEmployeesToDevice();
    const msg = `${result.pushed} employés synchronisés${result.errors.length ? `, ${result.errors.length} erreurs` : ''}`;
    _logSync(msg);
    showToast(msg, result.errors.length > 0 ? 'warning' : 'success');
  } catch (err) {
    _logSync(`Erreur : ${err.message}`);
    showToast('Synchronisation échouée', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function _handleFlushQueue() {
  _logSync('Traitement de la file d\'attente...');
  await biometricSync.flushPendingQueue();
  const queueRaw   = localStorage.getItem('biometric_pending_queue');
  const queueCount = queueRaw ? JSON.parse(queueRaw).length : 0;
  const el = document.getElementById('bioPendingCount');
  if (el) el.textContent = `${queueCount} en file`;
  _logSync(`File vidée. Restants : ${queueCount}`);
}

// ============================================================
// Événement de pointage reçu
// ============================================================

function _handleAttendanceEvent(event) {
  const { success, employeeId, employee, record, reason, simulated } = event.detail;

  const scanEntry = {
    timestamp:  new Date().toISOString(),
    employeeId,
    employeeName: employee?.name || employee?.nom || employeeId,
    success,
    reason,
    record,
    simulated: simulated || false,
  };

  localState.recentScans.unshift(scanEntry);
  if (localState.recentScans.length > MAX_RECENT_SCANS) {
    localState.recentScans.pop();
  }

  // Feedback visuel dans la zone de scan
  _animateScanZone(success, scanEntry.employeeName, reason, simulated);
  _renderRecentScans();
}

function _handleDeviceError(event) {
  const { code, message } = event.detail;
  _animateScanZone(false, null, `${code}: ${message}`, false);
  showToast(`Erreur lecteur : ${message}`, 'error', 5000);
}

// ============================================================
// Mise à jour UI
// ============================================================

function _updateConnectionUI() {
  const dot    = document.getElementById('bioStatusDot');
  const label  = document.getElementById('bioStatusLabel');
  const badge  = document.getElementById('bioTransportBadge');
  const btn    = document.getElementById('bioConnectBtn');
  const zone   = document.getElementById('bioScanMessage');

  if (!dot) return; // Section non rendue

  if (localState.connected) {
    dot?.classList.add('connected');
    if (label)  label.textContent  = `Connecté — ${localState.deviceName}`;
    if (badge) {
      badge.textContent = localState.transport?.toUpperCase() || '';
      badge.style.display = 'inline-block';
    }
    if (btn) {
      btn.innerHTML = '<span class="material-icons">link_off</span> Déconnecter';
      btn.classList.replace('btn-primary', 'btn-danger');
      btn.disabled = false;
    }
    if (zone) zone.textContent = 'En attente d\'une empreinte...';
  } else {
    dot?.classList.remove('connected');
    if (label)  label.textContent  = 'Non connecté';
    if (badge)  badge.style.display = 'none';
    if (btn) {
      btn.innerHTML = '<span class="material-icons">fingerprint</span> Connecter';
      btn.classList.replace('btn-danger', 'btn-primary');
      btn.disabled = false;
    }
    if (zone) zone.textContent = 'Connectez un lecteur d\'empreintes pour démarrer le pointage';
  }
}

function _updateStatusLabel(message, state) {
  const label = document.getElementById('bioStatusLabel');
  if (label) label.textContent = message;
}

function _animateScanZone(success, employeeName, reason, simulated) {
  const zone = document.getElementById('bioScanZone');
  const icon = zone?.querySelector('.bio-fingerprint-icon');
  const msg  = document.getElementById('bioScanMessage');

  if (!zone) return;

  zone.classList.remove('scan-success', 'scan-error', 'scan-warning');
  void zone.offsetWidth; // Force reflow pour relancer l'animation

  if (success) {
    zone.classList.add('scan-success');
    const timeStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (msg) msg.innerHTML = `
      <strong>${employeeName}</strong> — ${timeStr}
      ${simulated ? '<span class="bio-sim-badge">Simulation</span>' : ''}
    `;
  } else {
    const isWarning = reason === 'duplicate' || reason === 'not_found';
    zone.classList.add(isWarning ? 'scan-warning' : 'scan-error');
    const reasonLabels = {
      duplicate:  'Pointage déjà enregistré récemment',
      not_found:  'Employé non trouvé dans la base',
      error:      'Erreur lors de l\'enregistrement',
    };
    if (msg) msg.textContent = reasonLabels[reason] || reason || 'Erreur inconnue';
  }

  setTimeout(() => {
    zone.classList.remove('scan-success', 'scan-error', 'scan-warning');
    if (msg && localState.connected) msg.textContent = 'En attente d\'une empreinte...';
  }, 4000);
}

function _renderRecentScans() {
  const list = document.getElementById('bioScansList');
  if (!list) return;

  if (!localState.recentScans.length) {
    list.innerHTML = '<p class="bio-empty-state">Aucun pointage récent</p>';
    return;
  }

  list.innerHTML = localState.recentScans.map(scan => `
    <div class="bio-scan-item ${scan.success ? 'success' : 'failed'}">
      <span class="material-icons bio-scan-item-icon">
        ${scan.success ? 'check_circle' : 'cancel'}
      </span>
      <div class="bio-scan-item-info">
        <strong>${scan.employeeName}</strong>
        <span>${new Date(scan.timestamp).toLocaleTimeString('fr-FR')}</span>
        ${scan.record?.timeOut ? `<span class="bio-exit-badge">Départ</span>` : ''}
        ${scan.simulated ? '<span class="bio-sim-badge">Sim</span>' : ''}
      </div>
      <div class="bio-scan-item-detail">
        ${scan.record?.timeIn ? `<span>Arrivée : ${scan.record.timeIn}</span>` : ''}
        ${scan.record?.timeOut ? `<span>Départ : ${scan.record.timeOut}</span>` : ''}
        ${!scan.success ? `<span class="bio-fail-reason">${scan.reason || 'Échec'}</span>` : ''}
      </div>
    </div>
  `).join('');
}

// ============================================================
// Utilitaires UI
// ============================================================

function _toggleConfigPanel() {
  const panel = document.getElementById('bioConfigPanel');
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function _switchTab(tabName) {
  document.querySelectorAll('.bio-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.bio-tab-content').forEach(c => {
    c.style.display = 'none';
    c.classList.remove('active');
  });
  const tabContentId = { scans: 'bioTabScans', enroll: 'bioTabEnroll', sync: 'bioTabSync' }[tabName];
  const content = document.getElementById(tabContentId);
  if (content) {
    content.style.display = 'block';
    content.classList.add('active');
  }
}

function _logSync(message) {
  const log = document.getElementById('bioSyncLog');
  if (!log) return;
  const entry = document.createElement('p');
  entry.className = 'bio-sync-entry';
  entry.textContent = `[${new Date().toLocaleTimeString('fr-FR')}] ${message}`;
  log.prepend(entry);
  if (log.children.length > 20) log.lastElementChild.remove();
}

function _todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ── Exposition globale ────────────────────────────────────
// Requis par smart-search.js pour vérifier l'état du lecteur
// avant de lancer une sélection par empreinte digitale.
window._biometricConnected = () => localState.connected;
