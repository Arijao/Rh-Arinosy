// ============================================================
// ui/auth.js — Authentification (ES Module)
// PIN-based, stocké dans IndexedDB (chiffré via btoa simple)
// ============================================================

import { dbManager } from '../state.js';
import { showToast } from '../utils/notifications.js';

const SESSION_KEY  = 'rh_behavana_session';
const SESSION_MINS = 480; // 8 heures

// ------ PUBLIC API ------

export async function initAuth() {
  // Injecter le HTML de la page de login
  _injectLoginPage();
  _injectLockButton();

  const isLoggedIn = await checkSession();
  if (!isLoggedIn) {
    showLoginPage();
  }

  // Auto-lock après inactivité
  _setupAutoLock();
}

export async function checkSession() {
  try {
    const raw  = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const sess = JSON.parse(raw);
    if (!sess.ts) return false;
    const age  = (Date.now() - sess.ts) / 60000; // minutes
    return age < SESSION_MINS;
  } catch { return false; }
}

export function showLoginPage() {
  const appContent = document.getElementById('appContent');
  if (appContent) {
    // Retirer le focus AVANT de poser aria-hidden.
    // Sans ce blur(), le navigateur génère :
    // "Blocked aria-hidden on element because its descendant retained focus"
    if (appContent.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    appContent.classList.add('hidden');
    appContent.setAttribute('aria-hidden', 'true');
  }
  document.getElementById('loginOverlay')?.classList.remove('hidden');
  document.getElementById('loginOverlay')?.classList.add('visible');
  // Déplacer le focus vers le premier champ PIN
  setTimeout(() => {
    document.querySelector('.pin-key')?.focus();
  }, 100);
}

export function hideLoginPage() {
  document.getElementById('loginOverlay')?.classList.remove('visible');
  setTimeout(() => {
    document.getElementById('loginOverlay')?.classList.add('hidden');
    const appContent = document.getElementById('appContent');
    if (appContent) {
      appContent.classList.remove('hidden');
      appContent.removeAttribute('aria-hidden');
    }
  }, 400);
}

export async function login(pin) {
  const stored = await _getStoredPin();
  if (!stored) {
    // Première utilisation: on enregistre le PIN
    await _savePin(pin);
    _setSession();
    showToast('✅ PIN créé! Bienvenue.', 'success');
    hideLoginPage();
    // Call bootApp after successful login
    if (window._bootAppAfterLogin) {
      setTimeout(() => window._bootAppAfterLogin(), 500);
    }
    return true;
  }
  if (_hashPin(pin) === stored) {
    _setSession();
    hideLoginPage();
    // Call bootApp after successful login
    if (window._bootAppAfterLogin) {
      setTimeout(() => window._bootAppAfterLogin(), 500);
    }
    return true;
  }
  return false;
}

export async function changePin(oldPin, newPin) {
  const stored = await _getStoredPin();
  if (stored && _hashPin(oldPin) !== stored) {
    showToast('Ancien PIN incorrect.', 'error'); return false;
  }
  await _savePin(newPin);
  showToast('PIN mis à jour!', 'success'); return true;
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  showLoginPage();
}

// ------ PRIVATE ------

function _hashPin(pin) {
  // Hash simple mais suffisant pour un usage local offline
  let h = 0;
  for (let i = 0; i < pin.length; i++) {
    h = ((h << 5) - h) + pin.charCodeAt(i);
    h |= 0;
  }
  return btoa(String(h + pin.length * 31));
}

async function _getStoredPin() {
  try {
    const r = await dbManager.get('settings', 'auth_pin');
    return r?.value || null;
  } catch { return null; }
}

async function _savePin(pin) {
  await dbManager.put('settings', { key: 'auth_pin', value: _hashPin(pin) });
}

function _setSession() {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ts: Date.now() }));
}

let _lockTimer;
function _setupAutoLock() {
  const INACTIVE_MINS = 60;
  const reset = () => {
    clearTimeout(_lockTimer);
    _lockTimer = setTimeout(async () => {
      if (await checkSession()) {
        sessionStorage.removeItem(SESSION_KEY);
        showLoginPage();
      }
    }, INACTIVE_MINS * 60000);
  };
  ['click', 'keydown', 'mousemove', 'touchstart'].forEach(e => document.addEventListener(e, reset, { passive: true }));
  reset();
}

function _injectLockButton() {
  // Ajouter bouton de verrouillage dans le header
  const header = document.querySelector('.header');
  if (!header) return;
  const btn = document.createElement('button');
  btn.id = 'lockBtn';
  btn.title = 'Verrouiller';
  btn.style.cssText = `
    position:absolute;top:24px;right:136px;
    background:rgba(255,255,255,0.2);border:none;border-radius:50%;
    width:48px;height:48px;display:flex;align-items:center;justify-content:center;
    cursor:pointer;color:white;transition:all 0.3s ease;z-index:2;`;
  btn.innerHTML = '<span class="material-icons">lock</span>';
  btn.onclick   = logout;
  header.appendChild(btn);
}

function _injectLoginPage() {
  if (document.getElementById('loginOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id    = 'loginOverlay';
  overlay.classList.add('hidden');
  overlay.innerHTML = `
    <div class="login-box">
      <div class="login-logo">
        <span class="material-icons" style="font-size:3rem;color:#818cf8;">qr_code_scanner</span>
        <h1>RH RiseVanilla</h1>
        <p>La vanille à portée de main</p>
      </div>

      <form id="loginForm" onsubmit="window._submitLogin(event)">
        <div class="pin-label" id="pinLabel">Entrez votre PIN</div>

        <div class="pin-display" id="pinDisplay">
          <span class="pin-dot" id="d0"></span>
          <span class="pin-dot" id="d1"></span>
          <span class="pin-dot" id="d2"></span>
          <span class="pin-dot" id="d3"></span>
        </div>

        <div class="pin-error" id="pinError"></div>

        <div class="pin-pad">
          ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(k => k === ''
            ? '<div></div>'
            : `<button type="button" class="pin-key" onclick="window._pinKey('${k}')">${k}</button>`
          ).join('')}
        </div>

        <button type="submit" class="login-submit" id="loginSubmit" disabled>
          <span class="material-icons">login</span> Connexion
        </button>
      </form>

      <div class="login-footer">
        <small>Connexion sécurisée — données 100% locales</small>
      </div>
    </div>

    <style>
      #loginOverlay {
        position: fixed; inset: 0; z-index: 99999;
        display: flex; align-items: center; justify-content: center;
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
        transition: opacity 0.4s ease;
        opacity: 0;
      }
      #loginOverlay.visible  { opacity: 1; }
      #loginOverlay.hidden   { display: none !important; }

      .login-box {
        background: rgba(51,65,85,0.6);
        backdrop-filter: blur(30px);
        border: 1px solid rgba(148,163,184,0.2);
        border-radius: 24px;
        padding: 40px 32px;
        width: 100%;
        max-width: 380px;
        box-shadow: 0 32px 80px rgba(0,0,0,0.5);
        text-align: center;
        animation: loginSlideUp 0.5s ease;
      }

      @keyframes loginSlideUp {
        from { transform: translateY(40px); opacity: 0; }
        to   { transform: translateY(0);    opacity: 1; }
      }

      .login-logo h1 { color: #f1f5f9; font-size: 1.6rem; margin: 12px 0 4px; }
      .login-logo p  { color: #94a3b8; font-size: 0.9rem; margin-bottom: 32px; }

      .pin-label { color: #cbd5e1; font-size: 0.95rem; margin-bottom: 20px; font-weight: 500; }

      .pin-display {
        display: flex; gap: 16px; justify-content: center;
        margin-bottom: 8px;
      }
      .pin-dot {
        width: 18px; height: 18px; border-radius: 50%;
        border: 2px solid rgba(129,140,248,0.5);
        background: transparent;
        transition: all 0.2s ease;
      }
      .pin-dot.filled { background: #818cf8; border-color: #818cf8; transform: scale(1.1); }

      .pin-error { color: #f87171; font-size: 0.85rem; min-height: 20px; margin-bottom: 8px; }

      .pin-pad {
        display: grid; grid-template-columns: repeat(3, 1fr);
        gap: 12px; margin: 20px 0;
      }
      .pin-key {
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(148,163,184,0.15);
        border-radius: 14px; padding: 18px;
        font-size: 1.3rem; color: #f1f5f9;
        cursor: pointer; transition: all 0.15s ease;
        font-family: inherit; font-weight: 600;
      }
      .pin-key:hover  { background: rgba(129,140,248,0.2); border-color: rgba(129,140,248,0.4); transform: scale(1.05); }
      .pin-key:active { transform: scale(0.95); background: rgba(129,140,248,0.35); }

      .login-submit {
        width: 100%; padding: 14px;
        background: linear-gradient(135deg, #818cf8 0%, #6366f1 100%);
        border: none; border-radius: 14px; color: white;
        font-size: 1rem; font-weight: 700; cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 8px;
        transition: all 0.3s ease; margin-top: 8px;
        box-shadow: 0 4px 16px rgba(99,102,241,0.4);
      }
      .login-submit:disabled { opacity: 0.4; cursor: not-allowed; }
      .login-submit:not(:disabled):hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(99,102,241,0.5); }

      .login-footer { margin-top: 24px; color: #64748b; font-size: 0.8rem; }
    </style>`;

  document.body.prepend(overlay);

  // PIN state
  let _pin = '';
  const MAX = 4;

  window._pinKey = (k) => {
    const errorEl = document.getElementById('pinError');
    if (errorEl) errorEl.textContent = '';

    if (k === '⌫') {
      _pin = _pin.slice(0, -1);
    } else if (_pin.length < MAX) {
      _pin += k;
    }
    // Mise à jour des dots
    for (let i = 0; i < MAX; i++) {
      document.getElementById(`d${i}`)?.classList.toggle('filled', i < _pin.length);
    }
    const btn = document.getElementById('loginSubmit');
    if (btn) btn.disabled = _pin.length < MAX;
  };

  window._submitLogin = async (e) => {
    e.preventDefault();
    const ok = await login(_pin);
    if (!ok) {
      const errorEl = document.getElementById('pinError');
      if (errorEl) errorEl.textContent = '❌ PIN incorrect. Réessayez.';
      // Shake animation
      document.querySelector('.pin-display')?.animate(
        [{ transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }],
        { duration: 300, iterations: 2 }
      );
    }
    // Reset PIN
    _pin = '';
    for (let i = 0; i < MAX; i++) document.getElementById(`d${i}`)?.classList.remove('filled');
    const btn = document.getElementById('loginSubmit');
    if (btn) btn.disabled = true;
  };
}
