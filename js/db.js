// ============================================================
// db.js — IndexedDB Manager (ES Module)
// ============================================================

export class IndexedDBManager {
  constructor() {
    this.db = null;
    this.dbName = 'BehavanaHRSystem';
    this.version = 2;
    this.isInitialized = false;
    this.diagnosticLog = [];
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}`;
    this.diagnosticLog.push(logEntry);
    console.log(logEntry);
  }

  // ===== DIAGNOSTIC =====
  async diagnose() {
    this.log('Démarrage du diagnostic IndexedDB...', 'info');
    
    try {
      // Vérifier si IndexedDB est disponible
      if (!window.indexedDB) {
        this.log('❌ IndexedDB n\'est pas disponible', 'error');
        return { available: false, error: 'IndexedDB non disponible' };
      }
      
      this.log('✅ IndexedDB est disponible', 'info');
      
      // Essayer de se connecter à la base de données existante
      return await this._tryConnect();
    } catch (err) {
      this.log(`❌ Erreur diagnostic: ${err.message}`, 'error');
      return { available: false, error: err.message };
    }
  }

  async _tryConnect() {
    return new Promise((resolve) => {
      // Essayer la version courante d'abord
      const request = indexedDB.open(this.dbName);
      
      request.onsuccess = () => {
        const db = request.result;
        const storeNames = Array.from(db.objectStoreNames);
        this.log(`✅ Connexion réussie à '${this.dbName}' (v${db.version})`, 'success');
        this.log(`   Stores existants: ${storeNames.join(', ') || 'Aucun'}`, 'success');
        db.close();
        resolve({ 
          available: true, 
          dbName: this.dbName,
          stores: storeNames,
          version: db.version,
          success: true
        });
      };
      
      request.onerror = () => {
        const errorMsg = request.error?.message || 'Erreur de connexion';
        this.log(`❌ Impossible de se connecter à '${this.dbName}': ${errorMsg}`, 'error');
        resolve({ 
          available: false, 
          error: errorMsg,
          success: false
        });
      };
      
      request.onblocked = () => {
        this.log('⚠️  Connexion bloquée (autre onglet utilise la DB)', 'warn');
      };
    });
  }

  async advancedDiagnosis() {
    console.group('🔬 Diagnostic Avancé IndexedDB');
    
    // Vérifier si IndexedDB est dispo
    if (!window.indexedDB) {
      console.error('❌ IndexedDB n\'est pas disponible dans ce navigateur');
      console.groupEnd();
      return { fatal: true, message: 'IndexedDB non disponible' };
    }
    console.log('✅ IndexedDB disponible');
    
    // Lister toutes les DB existantes (impossible directement, donc tester les noms communs)
    const possibleNames = ['BehavanaHRSystem', 'behavana', 'hrdb', 'rh-system'];
    console.log('\n🔍 Vérification des bases de données existantes...');
    for (const dbName of possibleNames) {
      const checkReq = indexedDB.open(dbName);
      await new Promise((resolve) => {
        checkReq.onsuccess = () => {
          const db = checkReq.result;
          console.log(`  📦 "${dbName}": v${db.version}, stores: ${Array.from(db.objectStoreNames).join(', ')}`);
          db.close();
          resolve();
        };
        checkReq.onerror = () => {
          console.log(`  ❌ "${dbName}": Inaccessible`);
          resolve();
        };
      });
    }
    
    // Tester la connexion à notre DB
    console.log(`\n🔗 Test de connexion à '${this.dbName}' v${this.version}...`);
    const diagnosis = await this._tryConnect();
    
    if (!diagnosis.success) {
      console.log('❌ Impossible de se connecter');
      console.log('\n💡 Causes possibles:');
      console.log('  1. Version incompatible (DB existe en v' + (diagnosis.version || '?') + ')');
      console.log('  2. Corruption de la base de données');
      console.log('  3. Autre onglet bloque la mise à jour');
      console.log('  4. Quota de stockage dépassé');
      console.log('  5. Problème de permissions du navigateur');
    } else {
      console.log('✅ Connexion réussie');
      console.log(`   Stores trouvés: ${diagnosis.stores.join(', ')}`);
    }
    
    console.log('\n📊 Actions à essayer:');
    console.log('  - Fermer tous les autres onglets avec cette app');
    console.log('  - Vider le cache du navigateur (Ctrl+Shift+Del)');
    console.log('  - Vérifier les DevTools > Application > IndexedDB');
    
    console.groupEnd();
    return diagnosis;
  }

  // ===== INITIALISATION =====
  async init() {
    return new Promise((resolve, reject) => {
      this.log(`Tentative de connexion à IndexedDB (${this.dbName} v${this.version})...`, 'info');
      
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        const errorMsg = `Erreur IndexedDB: ${request.error?.message || 'Erreur inconnue'}`;
        this.log(errorMsg, 'error');
        this.log(`Code d'erreur: ${request.error?.code || 'N/A'}`, 'error');
        this.log(`Type d'erreur: ${request.error?.name || 'N/A'}`, 'error');
        this.updateDBStatus('Erreur de connexion à la base de données', 'error');
        reject(new Error(errorMsg));
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
        const storeNames = Array.from(this.db.objectStoreNames);
        this.log(`✅ Base de données connectée. Version: ${this.db.version}`, 'success');
        this.log(`Stores disponibles: ${storeNames.length > 0 ? storeNames.join(', ') : 'Aucun'}`, 'success');
        
        // VÉRIFICATION IMPORTANTE: Si la DB est vide, la supprimer et la recréer
        if (storeNames.length === 0) {
          this.log('⚠️  DB vide (aucun store). Suppression et recréation...', 'warn');
          this.db.close();
          
          // Supprimer la vieille DB
          const deleteRequest = indexedDB.deleteDatabase(this.dbName);
          deleteRequest.onsuccess = () => {
            this.log('✅ Ancienne DB supprimée. Recréation avec v' + this.version, 'info');
            // Réappeler init() pour recréer avec les bons stores
            this.init().then(resolve).catch(reject);
          };
          deleteRequest.onerror = () => {
            this.log('❌ Impossible de supprimer la vieille DB', 'error');
            reject(new Error('Impossible de régénérer la base de données'));
          };
          return;
        }
        
        this.updateDBStatus('Base de données connectée', 'connected');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        this.log(`Mise à jour de la base de données en v${this.version}`, 'info');
        const db = event.target.result;

        // Créer les stores s'ils n'existent pas (ne pas supprimer les existants)
        const requiredStores = {
          'groups': { keyPath: 'id', indexes: [['name', 'name', { unique: true }]] },
          'employees': { keyPath: 'id', indexes: [['name', 'name', { unique: false }], ['position', 'position', { unique: false }], ['groupId', 'groupId', { unique: false }]] },
          'attendance': { keyPath: 'date', indexes: [['date', 'date', { unique: true }]] },
          'payrolls': { keyPath: 'id', indexes: [['employeeId', 'employeeId', { unique: false }], ['month', 'month', { unique: false }]] },
          'advances': { keyPath: 'id', indexes: [['employeeId', 'employeeId', { unique: false }], ['date', 'date', { unique: false }]] },
          'settings': { keyPath: 'key', indexes: [] },
          'qr_attendance': { keyPath: 'id', indexes: [['employeeId', 'employeeId', { unique: false }], ['date', 'date', { unique: false }], ['timestamp', 'timestamp', { unique: false }]] },
          'qr_codes': { keyPath: 'employeeId', indexes: [['generated', 'generated', { unique: false }]] },
          'remarks': { keyPath: 'id', indexes: [['employeeId', 'employeeId', { unique: false }], ['type', 'type', { unique: false }], ['status', 'status', { unique: false }]] },
        };

        for (const [storeName, storeConfig] of Object.entries(requiredStores)) {
          if (!db.objectStoreNames.contains(storeName)) {
            try {
              const store = db.createObjectStore(storeName, { keyPath: storeConfig.keyPath });
              for (const [indexName, keyPath, options] of storeConfig.indexes) {
                store.createIndex(indexName, keyPath, options);
              }
              this.log(`  ✅ Store créé: ${storeName}`, 'info');
            } catch (err) {
              this.log(`  ⚠️  Erreur création store ${storeName}: ${err.message}`, 'warn');
            }
          } else {
            this.log(`  ℹ️  Store existant: ${storeName}`, 'info');
            // Ajouter les indexes manquants si nécessaire
            const store = event.target.transaction.objectStore(storeName);
            for (const [indexName, keyPath, options] of storeConfig.indexes) {
              if (!store.indexNames.contains(indexName)) {
                try {
                  store.createIndex(indexName, keyPath, options);
                  this.log(`    ✅ Index créé: ${storeName}.${indexName}`, 'info');
                } catch (err) {
                  this.log(`    ⚠️  Erreur création index ${storeName}.${indexName}: ${err.message}`, 'warn');
                }
              }
            }
          }
        }
      };
    });
  }

  updateDBStatus(message, type = 'connected') {
    const statusEl = document.getElementById('dbStatus');
    const textEl   = document.getElementById('dbStatusText');
    if (statusEl && textEl) {
      statusEl.className = `db-status ${type}`;
      textEl.textContent = message;
    }
  }

  _tx(storeName, mode = 'readonly') {
    if (!this.isInitialized) throw new Error('DB non initialisée');
    const tx    = this.db.transaction([storeName], mode);
    const store = tx.objectStore(storeName);
    return store;
  }

  async add(storeName, data) {
    return new Promise((resolve, reject) => {
      const req = this._tx(storeName, 'readwrite').add(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async put(storeName, data) {
    return new Promise((resolve, reject) => {
      const req = this._tx(storeName, 'readwrite').put(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async get(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = this._tx(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async getAll(storeName) {
    return new Promise((resolve, reject) => {
      const req = this._tx(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  }

  async delete(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = this._tx(storeName, 'readwrite').delete(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async clear(storeName) {
    return new Promise((resolve, reject) => {
      const req = this._tx(storeName, 'readwrite').clear();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  // ===== DIAGNOSTIC EXPORT =====
  getDiagnosticLog() {
    return this.diagnosticLog;
  }

  printDiagnostic() {
    console.group('🔍 IndexedDB Diagnostic Report');
    console.log('Database Name:', this.dbName);
    console.log('Database Version:', this.version);
    console.log('Is Initialized:', this.isInitialized);
    console.log('Connection Status:', this.db ? 'Connected' : 'Not connected');
    
    if (this.db) {
      console.log('Available Stores:', Array.from(this.db.objectStoreNames).join(', '));
    }
    
    console.log('\n📋 Event Log:');
    if (this.diagnosticLog.length === 0) {
      console.log('  (aucun événement enregistré)');
    } else {
      this.diagnosticLog.forEach(entry => console.log('  ' + entry));
    }
    
    // Afficher un résumé
    console.log('\n📊 Résumé:');
    console.log('  Nombre d\'événements:', this.diagnosticLog.length);
    console.log('  Classe initialisée:', !!this.db);
    console.log('  Connexion active:', this.db ? 'OUI ✅' : 'NON ❌');
    
    console.groupEnd();
  }

  // ===== RECOVERY HELPERS =====
  async getStoreSizes() {
    const sizes = {};
    try {
      for (const storeName of this.db.objectStoreNames) {
        const items = await this.getAll(storeName);
        sizes[storeName] = items.length;
      }
    } catch (err) {
      this.log(`Erreur lecture store sizes: ${err.message}`, 'error');
    }
    return sizes;
  }

  async exportDiagnosticData() {
    const diagnostic = {
      timestamp: new Date().toISOString(),
      dbName: this.dbName,
      version: this.version,
      isInitialized: this.isInitialized,
      stores: this.db ? Array.from(this.db.objectStoreNames) : [],
      storeSizes: await this.getStoreSizes(),
      logs: this.diagnosticLog
    };
    return diagnostic;
  }
}
