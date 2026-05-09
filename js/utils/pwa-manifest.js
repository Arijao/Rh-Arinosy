// ============================================================
// utils/pwa-manifest.js — Manifest PWA injecté via Blob URL
// Bypasse le firewall Vercel (DDoS Mitigation) qui bloque
// les fichiers manifest servis statiquement.
//
// Intégration dans main.js :
//   import { injectPWAManifest } from './utils/pwa-manifest.js';
//   // Dans _bootApp(), avant _exposeGlobals() :
//   injectPWAManifest();
//
// Dans index.html : supprimer (ou laisser, sera remplacé) :
//   <link rel="manifest" href="/manifest.json">  ← à supprimer
// ============================================================

// Les URLs doivent être absolues dans un Blob URL
// (le navigateur ne peut pas résoudre les chemins relatifs depuis blob://)
const _base = window.location.origin;

const MANIFEST = {
  name: "RH RiseVanilla - Gestion RH",
  short_name: "RH System",
  description: "Système de Gestion des Ressources Humaines - Mode Sombre Offline-First",
  start_url: `${_base}/`,
  scope: `${_base}/`,
  display: "standalone",
  orientation: "portrait-primary",
  background_color: "#0f172a",
  theme_color: "#1e293b",
  categories: ["business", "productivity"],
  screenshots: [
    {
      src: `${_base}/icon.svg`,
      sizes: "192x192",
      type: "image/svg+xml",
      form_factor: "narrow"
    },
    {
      src: `${_base}/icon.svg`,
      sizes: "512x512",
      type: "image/svg+xml",
      form_factor: "wide"
    }
  ],
  icons: [
    {
      src: `${_base}/icon.svg`,
      sizes: "192x192",
      type: "image/svg+xml",
      purpose: "any"
    },
    {
      src: `${_base}/icon.svg`,
      sizes: "512x512",
      type: "image/svg+xml",
      purpose: "any"
    }
  ],
  shortcuts: [
    {
      name: "Tableau de Bord",
      short_name: "Dashboard",
      description: "Accès rapide au tableau de bord",
      url: `${_base}/?section=dashboard`,
      icons: [{ src: `${_base}/icon.svg`, sizes: "192x192" }]
    },
    {
      name: "Présence QR",
      short_name: "QR",
      description: "Scanner QR pour les présences",
      url: `${_base}/?section=qr-presence`,
      icons: [{ src: `${_base}/icon.svg`, sizes: "192x192" }]
    }
  ]
};

/**
 * Injecte le manifest PWA via un Blob URL dans le <head>.
 * Remplace le <link rel="manifest"> statique s'il existe,
 * ou en crée un nouveau sinon.
 * Aucune requête réseau — bypasse le firewall Vercel.
 */
export function injectPWAManifest() {
  try {
    const blob = new Blob(
      [JSON.stringify(MANIFEST, null, 2)],
      { type: 'application/manifest+json' }
    );
    const blobURL = URL.createObjectURL(blob);

    // Réutiliser le <link> existant ou en créer un
    let link = document.querySelector('link[rel="manifest"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'manifest';
      document.head.appendChild(link);
    }

    link.href = blobURL;
    console.log('✅ [PWAManifest] Manifest injecté via Blob URL (firewall bypassed)');
  } catch (err) {
    // Non bloquant — l'app fonctionne sans manifest
    console.warn('⚠️ [PWAManifest] Injection échouée (non critique):', err.message);
  }
}
