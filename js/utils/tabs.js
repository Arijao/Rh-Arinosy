// ============================================================
// utils/tabs.js — Système de gestion des tabs réutilisable
// ============================================================

/**
 * Initializes a tabbed interface with dynamic content switching
 * @param {string} containerId - ID du conteneur principal des tabs
 * @param {Object} options - Configuration optionnelle
 * @returns {Object} API de contrôle des tabs
 */
export function initTabs(containerId, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`[TABS] Container not found: ${containerId}`);
    return null;
  }

  // Configuration par défaut
  const config = {
    initialTab: options.initialTab || 'tab-0',
    onTabChange: options.onTabChange || null,
    persistence: options.persistence !== false, // Sauvegarde le tab actif
    storageKey: options.storageKey || `tabs-${containerId}`,
    ...options,
  };

  // État interne
  const state = {
    current: config.initialTab,
    tabs: new Map(),
    callbacks: [],
  };

  // Récupère les tabs depuis le DOM
  const tabButtons = container.querySelectorAll('[data-tab]');
  
  // Cherche les panneaux d'abord dans le container, puis dans le parent
  let tabPanels = container.querySelectorAll('[data-tab-panel]');
  let panelSearchScope = container;
  
  if (tabPanels.length === 0 && container.parentElement) {
    // Si pas de panneaux dans le container, cherche dans le parent
    tabPanels = container.parentElement.querySelectorAll('[data-tab-panel]');
    panelSearchScope = container.parentElement;
    console.log(`[TABS] Panels not found in container, searching in parent`);
  }

  if (tabButtons.length === 0 || tabPanels.length === 0) {
    console.error(`[TABS] No tabs or panels found in ${containerId}`);
    return null;
  }

  // Crée la map des tabs
  tabButtons.forEach((btn) => {
    const tabId = btn.getAttribute('data-tab');
    // Cherche d'abord dans le scope (container ou parent), puis en global
    let panel = panelSearchScope.querySelector(`[data-tab-panel="${tabId}"]`);
    if (!panel) {
      panel = document.querySelector(`[data-tab-panel="${tabId}"]`);
    }
    if (panel) {
      state.tabs.set(tabId, { button: btn, panel });
    }
  });

  // Restaure le dernier tab actif si persistence est activée
  if (config.persistence) {
    const saved = localStorage.getItem(config.storageKey);
    if (saved && state.tabs.has(saved)) {
      state.current = saved;
    }
  }

  /**
   * Active un tab spécifique
   * @param {string} tabId - ID du tab
   * @param {boolean} silent - N'appelle pas le callback
   */
  function activateTab(tabId, silent = false) {
    if (!state.tabs.has(tabId)) {
      console.warn(`[TABS] Tab not found: ${tabId}`);
      return;
    }

    const previousTab = state.current;

    // Désactive l'ancien tab
    const prevTab = state.tabs.get(previousTab);
    if (prevTab) {
      prevTab.button.classList.remove('active');
      prevTab.panel.classList.remove('active');
    }

    // Active le nouveau tab
    const newTab = state.tabs.get(tabId);
    newTab.button.classList.add('active');
    newTab.panel.classList.add('active');

    state.current = tabId;

    // Sauvegarde dans localStorage
    if (config.persistence) {
      localStorage.setItem(config.storageKey, tabId);
    }

    // Appelle les callbacks
    if (!silent && config.onTabChange) {
      config.onTabChange(tabId, previousTab);
    }

    // Appelle les callbacks enregistrés
    state.callbacks.forEach((cb) => {
      if (!silent) cb(tabId, previousTab);
    });

    // Accessibilité
    newTab.button.setAttribute('aria-selected', 'true');
    newTab.button.focus();
    prevTab?.button.setAttribute('aria-selected', 'false');
  }

  /**
   * Enregistre un callback à appeler lors du changement de tab
   * @param {Function} callback - (tabId, previousTab) => void
   */
  function onTabChange(callback) {
    if (typeof callback === 'function') {
      state.callbacks.push(callback);
    }
  }

  /**
   * Obtient le tab actif actuel
   * @returns {string} ID du tab actif
   */
  function getCurrentTab() {
    return state.current;
  }

  /**
   * Obtient tous les tabs disponibles
   * @returns {Array<string>} Liste des IDs
   */
  function getTabs() {
    return Array.from(state.tabs.keys());
  }

  /**
   * Désactibe la transition pour l'initialisation
   */
  function _disableTransitions() {
    const panels = container.querySelectorAll('[data-tab-panel]');
    panels.forEach((p) => {
      p.style.pointerEvents = 'none';
      p.style.opacity = '0';
    });
  }

  /**
   * Réactive les transitions
   */
  function _enableTransitions() {
    const panels = container.querySelectorAll('[data-tab-panel]');
    requestAnimationFrame(() => {
      panels.forEach((p) => {
        p.style.pointerEvents = '';
        p.style.opacity = '';
      });
    });
  }

  // Event listeners sur les boutons
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      activateTab(tabId);
    });

    // Support clavier (Ctrl+Left/Right arrow)
    btn.addEventListener('keydown', (e) => {
      const tabs = getTabs();
      const currentIndex = tabs.indexOf(state.current);

      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        e.preventDefault();
        activateTab(tabs[currentIndex - 1]);
      } else if (e.key === 'ArrowRight' && currentIndex < tabs.length - 1) {
        e.preventDefault();
        activateTab(tabs[currentIndex + 1]);
      }
    });
  });

  // Initialisation : Affiche le tab initial
  _disableTransitions();
  activateTab(state.current, true);
  _enableTransitions();

  // API publique
  return {
    activate: activateTab,
    current: getCurrentTab,
    tabs: getTabs,
    onChange: onTabChange,
  };
}

/**
 * Crée un élément tab simplement
 * @param {string} id - ID unique
 * @param {string} label - Étiquette du tab
 * @param {string} icon - Icône Material Design (optionnelle)
 * @returns {HTMLElement} Bouton tab
 */
export function createTabButton(id, label, icon = null) {
  const btn = document.createElement('button');
  btn.className = 'tab';
  btn.setAttribute('data-tab', id);
  btn.setAttribute('role', 'tab');
  btn.setAttribute('aria-selected', 'false');

  let html = '';
  if (icon) {
    html += `<span class="material-icons">${icon}</span>`;
  }
  html += label;

  btn.innerHTML = html;
  return btn;
}

/**
 * Crée un panneau de contenu para tab
 * @param {string} id - ID unique
 * @param {string} content - Contenu HTML (optionnel)
 * @returns {HTMLElement} Div panneau
 */
export function createTabPanel(id, content = '') {
  const panel = document.createElement('div');
  panel.className = 'tab-content';
  panel.setAttribute('data-tab-panel', id);
  panel.setAttribute('role', 'tabpanel');
  panel.innerHTML = content;
  return panel;
}

export default { initTabs, createTabButton, createTabPanel };
