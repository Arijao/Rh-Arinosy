// ============================================================
// Service Worker - RH RiseVanilla
// Stratégie: Network-first avec fallback cache
// Offline-first: Tout le contenu statique est mis en cache
// ============================================================

const CACHE_VERSION = 'rh-v4'; // Bumped: ajout fichiers manquants + fix Google Fonts

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
  '/icons.css',
  '/manifest.json',
  '/jsQR.min.js',
  '/efateo.mp3',
  '/suivant.mp3',
  '/icon-192.png',
  '/icon-512.png',
  '/icon.svg',
  '/service-worker.js',
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

  // Exclure Google Fonts du fetch intercept :
  // Ces domaines retournent des réponses opaques (CORS) non cachables par le SW.
  // Le navigateur gère leur cache HTTP natif directement.
  if (
    request.url.includes('fonts.googleapis.com') ||
    request.url.includes('fonts.gstatic.com')
  ) return;

  // SPECIAL: Intercepter les requêtes /models/ pour servir depuis IndexedDB
  if (request.url.includes('/model/')) {
    event.respondWith(
      (async () => {
        try {
          const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('face_api_models', 1);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
          });

          const modelName = request.url.split('/model/')[1];
          const transaction = db.transaction('models', 'readonly');
          const store = transaction.objectStore('models');
          
          const model = await new Promise((resolve, reject) => {
            const req = store.get(modelName);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
          });

          if (model && model.data) {
            const mimeType = modelName.endsWith('.json') 
              ? 'application/json' 
              : 'application/octet-stream';
            return new Response(model.data, {
              status: 200,
              headers: {
                'Content-Type': mimeType,
                'Cache-Control': 'max-age=604800'
              }
            });
          }
          return fetch(request);
        } catch (err) {
          console.warn('[SW] Model fetch failed, trying network:', err.message);
          return fetch(request);
        }
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
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_VERSION);
    console.log('🗑️ Cache cleared by client request');
  }
});
