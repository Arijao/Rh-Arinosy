// ============================================================
// ui/navigation.js — Navigation & Layout (ES Module)
// ============================================================

import { state, saveData } from '../state.js';
import { showToast } from '../utils/notifications.js';

// ------ Theme (DARK MODE ONLY) ------

export function initializeTheme() {
  // Force le thème sombre - pas de mode clair autorisé
  state.currentTheme = 'dark';
  document.documentElement.setAttribute('data-theme', 'dark');
  const sel = document.getElementById('themeSelect');
  if (sel) sel.value = 'dark';
  
  // Mise à jour initiale de la base de données
  try {
    import('../state.js').then(({ dbManager }) =>
      dbManager.put('settings', { key: 'theme', value: 'dark' })
    );
  } catch {}
}

export function toggleTheme() {
  // Désactivé - le thème sombre est forcé
  console.log('ℹ️ Mode clair désactivé - Application en mode sombre uniquement');
}

export async function changeTheme(theme) {
  // Forcer toujours le thème sombre
  state.currentTheme = 'dark';
  document.documentElement.setAttribute('data-theme', 'dark');
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = 'light_mode'; // Affiche juste l'icône light_mode (logo)
  try {
    await import('../state.js').then(({ dbManager }) =>
      dbManager.put('settings', { key: 'theme', value: 'dark' })
    );
  } catch {}
}

// ------ Settings Panel ------

export function toggleSettings() {
  document.getElementById('settingsPanel')?.classList.toggle('active');
  document.getElementById('settingsOverlay')?.classList.toggle('active');
}

export function closeSettings() {
  document.getElementById('settingsPanel')?.classList.remove('active');
  document.getElementById('settingsOverlay')?.classList.remove('active');
}

// ------ Hamburger Menu ------

export function toggleNavMenu() {
  document.getElementById('navMenu')?.classList.toggle('active');
  document.getElementById('navOverlay')?.classList.toggle('active');
  document.getElementById('hamburgerBtn')?.classList.toggle('active');
}

export function navigateToSection(sectionId, el) {
  toggleNavMenu();
  document.querySelectorAll('.nav-menu-item').forEach(i => i.classList.remove('active'));
  el?.classList.add('active');
  showSection(sectionId);
}

// ------ Section display avec History API ------

// Map des callbacks à appeler lors de l'affichage d'une section.
// Remplie par chaque module via registerSectionCallback().
const _sectionCallbacks = {};

export function registerSectionCallback(sectionId, fn) {
  _sectionCallbacks[sectionId] = fn;
}

// Garder une trace de la section actuelle pour l'historique
let _currentSection = 'dashboard';

// Map pour la compatibilité entre anciens et nouveaux IDs (vide maintenant - utilise les IDs directs)
const _sectionIdMap = {};

export function showSection(sectionId) {
  // Obtient l'ID réel du conteneur (support des mappings)
  const actualId = _sectionIdMap[sectionId] || sectionId;

  // Masquer toutes les sections
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));

  // Afficher la section cible
  document.getElementById(actualId)?.classList.add('active');

  // Mettre à jour nav-tab (legacy)
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.nav-tab[onclick*="showSection('${sectionId}')"]`)?.classList.add('active');

  // Mettre à jour l'historique du navigateur
  if (_currentSection !== sectionId) {
    const state = { section: sectionId, timestamp: Date.now() };
    window.history.pushState(state, `RH - ${sectionId}`, `?section=${sectionId}`);
    _currentSection = sectionId;
  }

  // Appeler le callback enregistré pour cette section
  _sectionCallbacks[sectionId]?.();
}

// ------ Dates ------

export function setCurrentDate() {
  const el = document.getElementById('attendanceDate');
  if (el) el.value = new Date().toISOString().split('T')[0];
}

export function setCurrentMonth() {
  const el = document.getElementById('payrollMonth');
  if (el) el.value = new Date().toISOString().slice(0, 7);
}

// ------ Backup info ------

export async function updateLastBackupInfo() {
  const el = document.getElementById('lastBackupInfo');
  if (!el) return;
  try {
    const { dbManager } = await import('../state.js');
    const setting = await dbManager.get('settings', 'lastBackupDate');
    if (setting?.value) {
      const { formatDate } = await import('../utils/format.js');
      el.textContent = `Dernière sauvegarde téléchargée le: ${formatDate(setting.value)}`;
    } else {
      el.textContent = "Aucune sauvegarde n'a encore été téléchargée.";
    }
  } catch {}
}

// ------ Browser History Navigation ------

// Gérer le bouton retour/avancer du navigateur
window.addEventListener('popstate', (event) => {
  const section = event.state?.section || 'dashboard';
  const actualId = _sectionIdMap[section] || section;
  
  // Masquer toutes les sections
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  
  // Afficher la section demandée
  document.getElementById(actualId)?.classList.add('active');
  
  // Mettre à jour le menu de navigation
  document.querySelectorAll('.nav-menu-item').forEach(i => {
    const isActive = i.getAttribute('onclick')?.includes(`'${section}'`);
    i.classList.toggle('active', isActive);
  });
  
  _currentSection = section;
  
  // Appeler le callback pour la section
  _sectionCallbacks[section]?.();
  
  console.log('🔙 Navigation historique:', section);
});

// Initialiser l'URL avec la section actuelle au chargement
export function initializeRouting() {
  const params = new URLSearchParams(window.location.search);
  const sectionFromUrl = params.get('section');
  
  if (sectionFromUrl && document.getElementById(sectionFromUrl)) {
    _currentSection = sectionFromUrl;
    showSection(sectionFromUrl);
  } else {
    // Première visite - initialiser avec dashboard
    window.history.replaceState(
      { section: 'dashboard', timestamp: Date.now() },
      'RH - Dashboard',
      '?section=dashboard'
    );
  }
}

