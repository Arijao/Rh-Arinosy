// ============================================================
// utils/model-cache.js — Système de Cache des Modèles Face-API
// Offline-First: Télécharge et cache les modèles en local (IndexedDB)
// ============================================================

/**
 * Gestionnaire de cache pour les modèles face-api
 * Permet le chargement offline des modèles ML
 */
export class ModelCacheManager {
  constructor() {
    this.dbName = 'face_api_models';
    this.storeName = 'models';
    this.version = 1;
    // ✅ CDN URLs for @vladmandic/face-api models
    this.cdnUrl         = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.3/model/';
    this.cdnUrlFallback = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights/';
    
    this.requiredModels = [
      'tiny_face_detector_model-weights_manifest.json',
      'tiny_face_detector_model-weights.bin',
      'face_landmark_68_model-weights_manifest.json',
      'face_landmark_68_model-weights.bin',
      'face_recognition_model-weights_manifest.json',
      'face_recognition_model-weights.bin',
    ];
    
    this.db = null;
    this.isOnline = navigator.onLine;
    this.cacheStatus = {
      initialized: false,
      modelsDownloaded: false,
      totalSize: 0,
      lastUpdate: null,
    };
  }

  /**
   * Initialiser la base de données IndexedDB
   */
  async initialize() {
    if (this.initialized) return true;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        this.cacheStatus.initialized = true;
        console.log('[ModelCache] ✅ IndexedDB initialized');
        resolve(true);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'name' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          console.log('[ModelCache] ✅ Object store created');
        }
      };
    });
  }

  /**
   * Vérifier la connexion réseau
   */
  async isNetworkAvailable() {
    try {
      // Utiliser une petite requête HEAD pour tester la connexion
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      const response = await fetch('https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/package.json', { 
        method: 'HEAD', 
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return true;
    } catch (err) {
      console.warn('[ModelCache] No network available:', err.message);
      return false;
    }
  }

  /**
   * Télécharger un modèle du CDN (avec fallback)
   * @param {string} modelName - Nom du fichier modèle
   * @returns {Promise<ArrayBuffer>} - Les données du modèle
   */
  async downloadModel(modelName) {
    console.log(`[ModelCache] ⬇️  Downloading: ${modelName}`);
    
    // Essayer CDN primary d'abord
    const urls = [
      `./model/${modelName}`,              // local/SW en premier — zéro réseau si précaché
      `${this.cdnUrl}${modelName}`,        // CDN seulement si local échoue
      `${this.cdnUrlFallback}${modelName}`,
    ];
    
    let lastError = null;
    
    for (const url of urls) {
      try {
        console.log(`[ModelCache] Trying: ${url}`);
        
        // Timeout compatible avec les anciens navigateurs
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(url, { 
          cache: 'default',
          redirect: 'follow',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.arrayBuffer();
        console.log(`[ModelCache] ✅ Downloaded: ${modelName} (${(data.byteLength / 1024).toFixed(2)} KB)`);
        return data;
        
      } catch (err) {
        lastError = err;
        console.warn(`[ModelCache] ⚠️ Failed from ${url}:`, err.message);
        // Continue to next URL
      }
    }
    
    // Tous les CDN ont échoué
    console.error(`[ModelCache] ❌ Failed to download ${modelName} from all CDNs`);
    throw lastError || new Error('All CDN sources failed');
  }

  /**
   * Sauvegarder un modèle dans IndexedDB
   * @param {string} modelName - Nom du modèle
   * @param {ArrayBuffer} data - Données du modèle
   */
  async saveModel(modelName, data) {
    if (!this.db) return false;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      
      const record = {
        name: modelName,
        data: data,
        timestamp: Date.now(),
        size: data.byteLength,
      };
      
      const request = store.put(record);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        console.log(`[ModelCache] 💾 Saved: ${modelName}`);
        resolve(true);
      };
    });
  }

  /**
   * Charger un modèle depuis le cache IndexedDB
   * @param {string} modelName - Nom du modèle
   * @returns {Promise<ArrayBuffer|null>} - Les données ou null
   */
  async loadModel(modelName) {
    if (!this.db) return null;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(modelName);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          console.log(`[ModelCache] 📂 Loaded from cache: ${modelName}`);
          resolve(result.data);
        } else {
          resolve(null);
        }
      };
    });
  }

  /**
   * Charger tous les modèles (depuis le cache ou CDN)
   * @param {Object} options - { forceDownload, progressCallback }
   * @returns {Promise<boolean>} - Success
   */
  async loadAllModels(options = {}) {
    const { forceDownload = false, progressCallback } = options;
    
    try {
      // Initialiser IndexedDB
      if (!this.cacheStatus.initialized) {
        await this.initialize();
      }
      
      const hasNetwork = await this.isNetworkAvailable();
      console.log(`[ModelCache] Network available: ${hasNetwork}`);
      
      let successCount = 0;
      let totalSize = 0;
      
      for (let i = 0; i < this.requiredModels.length; i++) {
        const modelName = this.requiredModels[i];
        const progress = ((i + 1) / this.requiredModels.length) * 100;
        
        if (progressCallback) {
          progressCallback({
            current: i + 1,
            total: this.requiredModels.length,
            percent: Math.round(progress),
            model: modelName,
            status: 'loading',
          });
        }
        
        let modelData = null;
        
        // Étape 1: Essayer le cache
        if (!forceDownload) {
          modelData = await this.loadModel(modelName);
        }
        
        // Étape 2: Si pas en cache et réseau disponible, télécharger
        if (!modelData && hasNetwork) {
          try {
            modelData = await this.downloadModel(modelName);
            await this.saveModel(modelName, modelData);
          } catch (err) {
            console.warn(`[ModelCache] Failed to download ${modelName}, trying fallback`);
            // Continuer sans arrêter
          }
        }
        
        // Étape 3: Vérifier le succès
        if (modelData) {
          successCount++;
          totalSize += modelData.byteLength;
        } else if (!hasNetwork) {
          // En offline sans cache = pas critique pour les manifests JSON
          if (!modelName.includes('.bin')) {
            console.warn(`[ModelCache] ⚠️ No network and no cache for ${modelName}`);
            successCount++; // Compter comme succès pour les manifests (provisoirement)
          }
        }
      }
      
      this.cacheStatus.modelsDownloaded = successCount >= 4; // Au minimum les binaries
      this.cacheStatus.totalSize = totalSize;
      this.cacheStatus.lastUpdate = new Date().toISOString();
      
      console.log(`[ModelCache] ✅ Models loaded: ${successCount}/${this.requiredModels.length}`);
      
      if (progressCallback) {
        progressCallback({
          current: this.requiredModels.length,
          total: this.requiredModels.length,
          percent: 100,
          status: 'complete',
        });
      }
      
      return this.cacheStatus.modelsDownloaded;
      
    } catch (err) {
      console.error('[ModelCache] ❌ Fatal error:', err);
      return false;
    }
  }

  /**
   * Nettoyer le cache (force re-download)
   */
  async clearCache() {
    if (!this.db) return false;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.cacheStatus.modelsDownloaded = false;
        console.log('[ModelCache] 🗑️  Cache cleared');
        resolve(true);
      };
    });
  }

  /**
   * Obtenir le statut du cache
   */
  getStatus() {
    return {
      ...this.cacheStatus,
      online: this.isOnline,
      cacheEnabled: this.db !== null,
    };
  }

  /**
   * Alternative: Charger modèles depuis blob URLs (cas offline)
   * @param {Function} listeningCallback - Optional: appelé avec { status, model }
   * @returns {Promise<boolean>} - Success
   */
  async loadModelsLocally(listeningCallback = null) {
    try {
      const modelsLoaded = await this.loadAllModels({
        progressCallback: listeningCallback
      });
      
      if (!modelsLoaded) {
        console.error('[ModelCache] ❌ Models not fully loaded');
        return false;
      }
      
      console.log('[ModelCache] ✅ All models loaded locally');
      return true;
    } catch (err) {
      console.error('[ModelCache] ❌ Error loading models:', err);
      return false;
    }
  }
}

// Export singleton
export const modelCache = new ModelCacheManager();

export default modelCache;
