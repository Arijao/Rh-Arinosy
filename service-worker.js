// ============================================================
// Service Worker - RH RiseVanilla
// Stratégie: Network-first avec fallback cache
// Offline-first: Tout le contenu statique est mis en cache
// ============================================================

const CACHE_VERSION = 'rh-v15'; // Roboto auto-hébergée — fin de la dépendance Google Fonts

// Tous les fichiers essentiels à mettre en cache
const CACHE_URLS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/css/design-system.css',
  '/css/notifications.css',
  '/js/main.js',
  '/js/state.js',
  '/js/db.js',
  '/js/ui/navigation.js',
  '/js/ui/employees.js',
  '/js/ui/groups.js',
  '/js/ui/attendance.js',
  '/js/ui/attendance-manager.js',
  '/js/ui/attendance-modes/facial-mode.js',
  '/js/ui/attendance-modes/manual-mode.js',
  '/js/ui/attendance-modes/qr-mode.js',
  '/js/ui/advances.js',
  '/js/ui/payroll.js',
  '/js/ui/qr.js',
  '/js/ui/reports.js',
  '/js/ui/stats.js',
  '/js/ui/search.js',
  '/js/ui/data-manager.js',
  '/js/ui/auth.js',
  '/js/ui/estimation.js',
  '/js/ui/stc.js',
  '/js/ui/scan-menu.js',
  '/js/face/recognition.js',
  // Biometric module
  '/js/biometric/biometric-service.js',
  '/js/biometric/biometric-api.js',
  '/js/biometric/biometric-sync.js',
  '/js/ui/biometric-attendance.js',
  '/css/biometric.css',
  '/js/utils/format.js',
  '/js/utils/ui.js',
  '/js/utils/audio.js',
  '/js/utils/attendance-calc.js',
  '/js/utils/dialog-manager.js',
  '/js/utils/notifications.js',
  '/js/utils/tabs.js',
  '/js/utils/initializationManager.js',
  '/js/utils/model-cache.js',
  '/roboto.css',
  '/fonts/roboto/roboto-v51-latin-300.woff2',
  '/fonts/roboto/roboto-v51-latin-regular.woff2',
  '/fonts/roboto/roboto-v51-latin-500.woff2',
  '/fonts/roboto/roboto-v51-latin-700.woff2',
  '/icons.css',
  '/manifest.webmanifest',
  '/jsQR.min.js',
  '/chart.min.js',
  '/sweetalert2.all.min.js',
  '/jspdf.umd.min.js',
  '/jspdf.plugin.autotable.min.js',
  '/qrcode.min.js',
  '/xlsx.full.min.js',
  '/jszip.min.js',
  '/face-api.min.js',
  '/efateo.mp3',
  '/suivant.mp3',
  '/icon-192.png',
  '/icon-512.png',
  '/icon.svg',
  '/service-worker.js',
  '/MaterialIcons-Regular.woff2',
  '/model/tiny_face_detector_model-weights_manifest.json',
  '/model/tiny_face_detector_model-weights.bin',
  '/model/face_landmark_68_model-weights_manifest.json',
  '/model/face_landmark_68_model-weights.bin',
  '/model/face_recognition_model-weights_manifest.json',
  '/model/face_recognition_model-weights.bin',

];

// Installation: cache tous les fichiers essentiels
self.addEventListener('install', event => {
  console.log('🔧 Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => {
        console.log('📦 Caching critical files for offline use...');
        // Cache en mode "best-effort" : un fichier en 404 ne bloque pas
        // l'installation — chaque URL est tentée individuellement
        return Promise.allSettled(
          CACHE_URLS.map(url =>
            cache.add(url).catch(err =>
              console.warn(`⚠️ Could not cache ${url}:`, err.message)
            )
          )
        );
      })
      .then(() => {
        console.log('✅ Cache install complete');
        return self.skipWaiting(); // Toujours appelé, même si des fichiers ont échoué
      })
      .catch(err => {
        console.error('❌ Cache setup failed:', err);
        return self.skipWaiting(); // Garantir l'activation même en cas d'erreur grave
      })
  );
});

// Activation: nettoyer les anciens caches
self.addEventListener('activate', event => {
  console.log('🟢 Service Worker activating...');
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name !== CACHE_VERSION)
            .map(name => {
              console.log('🗑️ Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim()) // Contrôle immédiatement les clients
  );
});

// Fetch: Stratégie Network-First avec support models offline
self.addEventListener('fetch', event => {
  const { request } = event;

  // Ignorer les requêtes non-GET
  if (request.method !== 'GET') return;

  // Ignorer les extensions navigateur
  if (request.url.startsWith('chrome-extension://')) return;

  // Roboto est désormais auto-hébergée (fonts/roboto/*.woff2, précachée
  // via CACHE_URLS) — cette exclusion ne matche plus aucune requête de
  // l'app mais reste inoffensive si un futur widget tiers y fait appel.
  if (
    request.url.includes('fonts.googleapis.com') ||
    request.url.includes('fonts.gstatic.com')
  ) return;

  // SPECIAL: Intercepter les requêtes /model/ — Cache Storage → IndexedDB → réseau
  if (request.url.includes('/model/')) {
    event.respondWith(
      (async () => {
        // 1. Cache Storage (précaché à l'install — zéro réseau)
        const cached = await caches.match(request);
        if (cached) return cached;

        // 2. IndexedDB (téléchargé par model-cache.js)
        try {
          const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('face_api_models', 1);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
            req.onupgradeneeded = e =>
              e.target.result.createObjectStore('models', { keyPath: 'name' });
          });

          const modelName = request.url.split('/model/')[1];
          const model = await new Promise((resolve, reject) => {
            const tx  = db.transaction('models', 'readonly');
            const req = tx.objectStore('models').get(modelName);
            req.onerror  = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
          });

          if (model?.data) {
            return new Response(model.data, {
              status: 200,
              headers: {
                'Content-Type': modelName.endsWith('.json')
                  ? 'application/json'
                  : 'application/octet-stream',
                'Cache-Control': 'max-age=604800',
              },
            });
          }
        } catch (err) {
          console.warn('[SW] IndexedDB lookup failed:', err.message);
        }

        // 3. Réseau en dernier recours
        return fetch(request);
      })()
    );
    return;
  }

  // Stratégie standard : Network-first, fallback cache
  event.respondWith(
    fetch(request)
      .then(response => {
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_VERSION)
          .then(cache => cache.put(request, responseToCache))
          .catch(err => console.warn('Cache put failed:', err));
        return response;
      })
      .catch(() => {
        console.warn('📡 Network request failed, using cache:', request.url);
        return caches.match(request)
          .then(cachedResponse => {
            if (cachedResponse) return cachedResponse;
            // FIX : navigation SPA avec ?section=xxx (history.pushState dans
            // navigation.js) — un reload sur /?section=employees ne matche
            // aucune entrée exacte du cache (seuls '/' et '/index.html' le
            // sont). L'ancienne détection via request.mode/destination s'est
            // révélée peu fiable selon le contexte de déclenchement (PWA
            // standalone, reload interne, etc.) — on se base à la place sur
            // le pathname, qui est garanti '/' pour toute route de cette
            // app SPA, peu importe mode/destination.
            const { pathname } = new URL(request.url);
            if (pathname === '/' || pathname === '/index.html') {
              return caches.match('/index.html');
            }
            if (request.destination === 'image') {
              return new Response('', { status: 404 });
            }
            return new Response(
              'Mode hors ligne - Page non disponible en cache',
              {
                status: 503,
                statusText: 'Service Unavailable',
                headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
              }
            );
          });
      })
  );
});

// Message handler
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    // Répondre au canal AVANT skipWaiting pour éviter "message channel closed"
    event.ports?.[0]?.postMessage({ type: 'SKIP_WAITING_ACK' });
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_VERSION);
    console.log('🗑️ Cache cleared by client request');
  }
});
