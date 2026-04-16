// ============================================================
// face/recognition.js — Reconnaissance Faciale (ES Module)
// ============================================================

import { state, saveData, dbManager } from '../state.js';
import { showAlert, showToast, renderPaginationControls } from '../utils/ui.js';
import { showNotification } from '../utils/dialog-manager.js';
import { formatDate, formatDisplayTime } from '../utils/format.js';
import { playSuccessSound, playErrorSound, playAuSuivantSound } from '../utils/audio.js';
import { processAttendanceScan } from '../ui/qr.js';
import { registerSectionCallback } from '../ui/navigation.js';
import { modelCache } from '../utils/model-cache.js';

// ============================================================
// FaceRecognition module
// ============================================================

const FR = {
  modelsLoaded: false,
  modelLoadingPromise: null,  // Éviter les race conditions

  async loadModels() {
    // ✅ Éviter le double chargement parallèle
    if (this.modelLoadingPromise) {
      return this.modelLoadingPromise;
    }
    
    if (this.modelsLoaded) return true;
    
    this.modelLoadingPromise = this._loadModelsInternal();
    const result = await this.modelLoadingPromise;
    this.modelLoadingPromise = null;
    return result;
  },

  async _loadModelsInternal() {
    try {
      console.log('[FR] 🔄 Loading face-api models...');
      
      // Vérifier que face-api est disponible
      if (typeof faceapi === 'undefined') {
        console.error('[FR] ❌ face-api library not loaded');
        return false;
      }
      
      // Initialiser le gestionnaire de cache
      if (!modelCache.cacheStatus.initialized) {
        await modelCache.initialize();
      }
      
      // ✅ STRATÉGIE OFFLINE-FIRST:
      // 1. Pré-charger les modèles en cache si online
      // 2. Charger les modèles via loadFromUri('/models') 
      //    → Service worker les servira depuis IndexedDB ou réseau
      
      // Étape 1: Essayer de pré-charger les modèles en cache (si online)
      if (navigator.onLine) {
        console.log('[FR] 📡 Online - Pre-caching models...');
        try {
          const progressHandler = (progress) => {
            const percent = progress.percent || 0;
            console.log(`[FR] ⬇️ Caching: ${percent}% - ${progress.model || 'models'}`);
          };
          
          // Pré-charger les modèles en IndexedDB (asynchrone, ne pas bloquer)
          modelCache.loadAllModels({ 
            progressCallback: progressHandler 
          }).catch(err => {
            console.warn('[FR] ⚠️ Pre-caching failed (OK, will use network):', err.message);
          });
        } catch (err) {
          console.warn('[FR] ⚠️ Pre-caching error (non-blocking):', err.message);
        }
      }
      
      // Étape 2: Charger les modèles pour face-api
      // ✅ Le Service Worker va intercepter ces requêtes:
      //    - Si modèles en cache: servir depuis IndexedDB (offline)
      //    - Sinon: fetch depuis CDN (online)
      
      let modelsLoaded = false;
      const baseUrl = window.location.pathname.includes('/systeme-rh-behavana/') 
        ? '/systeme-rh-behavana' 
        : '';
      
      // Essayer d'abord le chemin local (/models)
      // Le service worker va intercepter et servir depuis IndexedDB
      try {
        console.log('[FR] 🔍 Loading models via Service Worker...');
        const modelsPath = `${baseUrl}/model`;
        
        // Charger les trois modèles
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(modelsPath),
          faceapi.nets.faceLandmark68Net.loadFromUri(modelsPath),
          faceapi.nets.faceRecognitionNet.loadFromUri(modelsPath),
        ]);
        
        modelsLoaded = true;
        console.log('[FR] ✅ Models loaded (from cache or network)');
        
      } catch (swError) {
        console.warn('[FR] ⚠️ Service Worker route failed:', swError.message);
        
        // Fallback: Essayer directement les CDN (avec fallback)
        if (navigator.onLine) {
          try {
            console.log('[FR] 💾 Fallback to CDN...');
            // ✅ CDN URLs for @vladmandic/face-api models
            const cdnPaths = [
              'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model',
              'https://raw.githubusercontent.com/vladmandic/face-api/main/model',
            ];
            
            for (const cdnPath of cdnPaths) {
              try {
                console.log('[FR] Trying CDN:', cdnPath);
                await Promise.all([
                  faceapi.nets.tinyFaceDetector.loadFromUri(cdnPath),
                  faceapi.nets.faceLandmark68Net.loadFromUri(cdnPath),
                  faceapi.nets.faceRecognitionNet.loadFromUri(cdnPath),
                ]);
                
                modelsLoaded = true;
                console.log('[FR] ✅ Models loaded from CDN:', cdnPath);
                break;  // Success, exit loop
              } catch (cdnPathErr) {
                console.warn('[FR] ⚠️ CDN path failed:', cdnPath, cdnPathErr.message);
                // Try next CDN path
              }
            }
            
            if (modelsLoaded) {
              // Essayer de cacher les modèles pour le prochain offline
              setTimeout(() => {
                modelCache.loadAllModels().catch(err => {
                  console.warn('[FR] ⚠️ Async cache save failed:', err.message);
                });
              }, 1000);
            }
            
          } catch (cdnError) {
            console.error('[FR] ❌ All CDN sources failed:', cdnError.message);
            throw new Error('Impossible de charger les modèles de reconnaissance faciale');
          }
        } else {
          // Offline et pas de cache = impossible
          console.error('[FR] ❌ Offline + No cached models = Cannot load');
          throw new Error('Reconnaissance faciale indisponible en mode offline sans cache. Veuillez vous connecter une première fois.');
        }
      }
      
      if (modelsLoaded) {
        this.modelsLoaded = true;
        console.log('[FR] ✅ Face-api ready for recognition');
        console.log('[FR] Model states — tinyFaceDetector:', faceapi.nets.tinyFaceDetector.isLoaded,
          '| faceLandmark68Net:', faceapi.nets.faceLandmark68Net.isLoaded,
          '| faceRecognitionNet:', faceapi.nets.faceRecognitionNet.isLoaded);
        return true;
      }
      
      return false;
      
    } catch (err) {
      console.error('[FR] ❌ Fatal error loading models:', err.message);
      this.modelsLoaded = false;
      return false;
    }
  },

  distance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  },

  async enrollFace(videoEl, employe) {
    const instructions = [
      'Regardez droit devant', 'Tournez légèrement à gauche', 'Tournez légèrement à droite',
      'Inclinez légèrement vers le haut', 'Inclinez légèrement vers le bas',
    ];
    const descriptors = [];
    const statusEl = document.getElementById('enrollStatus');
    const btnStart = document.getElementById('btnEnrollStart');

    for (let i = 0; i < instructions.length; i++) {
      if (statusEl) statusEl.innerHTML = `Photo ${i + 1}/${instructions.length}: <strong>${instructions[i]}</strong><br><small>Cliquez quand prêt</small>`;
      if (btnStart) { btnStart.disabled = false; btnStart.style.opacity = '1'; btnStart.textContent = i === 0 ? '📸 Première photo' : `📸 Photo ${i + 1}`; }

      await new Promise(resolve => { btnStart.onclick = () => { btnStart.disabled = true; btnStart.style.opacity = '0.5'; resolve(); }; });

      const det = await faceapi.detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })).withFaceLandmarks().withFaceDescriptor();
      if (!det) { i--; if (statusEl) statusEl.innerHTML = '❌ Aucun visage détecté. Réessayez.'; await new Promise(r => setTimeout(r, 2000)); continue; }

      const le = det.landmarks.getLeftEye(), re = det.landmarks.getRightEye();
      const eyeOpen = (this.distance(le[1], le[5]) + this.distance(le[2], le[4])) > 3.5;
      if (!eyeOpen) { i--; if (statusEl) statusEl.innerHTML = '⚠️ Ouvrez bien les yeux.'; await new Promise(r => setTimeout(r, 2000)); continue; }

      descriptors.push(Array.from(det.descriptor));
      if (statusEl) { statusEl.innerHTML = `✅ Photo ${i + 1} enregistrée!`; statusEl.style.background = '#d4edda'; statusEl.style.color = '#000'; }
      await new Promise(r => setTimeout(r, 1000));
      if (statusEl) statusEl.style.background = '#f0f0f0'; statusEl.style.color = '#000';
    }

    if (descriptors.length < instructions.length) throw new Error('Enrollment incomplet.');
    return { ...employe, face_descriptors: descriptors, face_enrolled: true, face_enrollment_date: new Date().toISOString() };
  },

  async recognizeFace(videoEl, db) {
    const det = await faceapi.detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })).withFaceLandmarks().withFaceDescriptor();
    if (!det) return { success: false, message: 'Aucun visage détecté' };

    const labeled = db.filter(e => e.face_descriptors?.length > 0).map(e =>
      new faceapi.LabeledFaceDescriptors(e.id, e.face_descriptors.map(d => new Float32Array(d)))
    );
    if (!labeled.length) return { success: false, message: 'Aucun employé enregistré' };

    const matcher = new faceapi.FaceMatcher(labeled, 0.4);
    const best    = matcher.findBestMatch(det.descriptor);
    if (best.label === 'unknown') return { success: false, message: 'Non reconnu', distance: best.distance };

    const emp = db.find(e => e.id === best.label);
    return { success: true, employe: emp, confidence: 1 - best.distance, distance: best.distance };
  },

  // ✅ FIX: Exposé comme méthode publique pour import dans facial-mode.js
  async recognizeFacePublic(videoEl, db) {
    return this.recognizeFace(videoEl, db);
  },

  checkDuplicate(descriptors, currentId, db) {
    const others = db.filter(e => e.id !== currentId && e.face_descriptors?.length > 0);
    if (!others.length) return { isDuplicate: false };
    const labeled  = others.map(e => new faceapi.LabeledFaceDescriptors(e.id, e.face_descriptors.map(d => new Float32Array(d))));
    const matcher  = new faceapi.FaceMatcher(labeled, 0.4);
    for (const d of descriptors) {
      const best = matcher.findBestMatch(new Float32Array(d));
      if (best.label !== 'unknown' && best.distance < 0.4) {
        return { isDuplicate: true, matchedEmploye: db.find(e => e.id === best.label) };
      }
    }
    return { isDuplicate: false };
  },
};

// ============================================================
// ENROLLMENT MODAL
// ============================================================

export async function openEnrollmentModal(empId) {
  const emp = state.employees.find(e => e.id === empId);
  if (!emp) return;
  const loaded = await FR.loadModels();
  if (!loaded) { showAlert('Modèles non chargés.', 'error'); return; }

  // Anti-doublon rapide
  let tempStream;
  try {
    tempStream = await navigator.mediaDevices.getUserMedia({ video: {} });
    const tv   = document.createElement('video');
    tv.srcObject = tempStream; await tv.play();
    const enrolled = state.employees.filter(e => e.face_enrolled && e.face_descriptors && e.id !== empId);
    if (enrolled.length) {
      const r = await FR.recognizeFace(tv, enrolled);
      if (r.success && r.distance < 0.4) {
        tempStream.getTracks().forEach(t => t.stop());
        showAlert(`⚠️ Ce visage appartient déjà à ${r.employe.name}`, 'error'); return;
      }
    }
  } catch {} finally { tempStream?.getTracks().forEach(t => t.stop()); }

  const modal = document.createElement('div');
  modal.id    = 'enrollmentModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = `
    <div class="modal-content-facial" style="background:white;color:#1e293b;padding:24px;border-radius:12px;max-width:500px;width:95%;max-height:95vh;overflow-y:auto;">
      <h2 style="margin:0 0 16px;color:#1e293b;">📸 Enrollment: ${emp.name}</h2>
      <div style="position:relative;width:100%;max-width:320px;margin:0 auto 16px;aspect-ratio:4/3;background:#000;border-radius:8px;overflow:hidden;">
        <video id="enrollVideo" autoplay playsinline style="width:100%;height:100%;object-fit:cover;transform:scaleX(-1);"></video>
        <canvas id="enrollCanvas" style="position:absolute;top:0;left:0;width:100%;height:100%;z-index:10;pointer-events:none;"></canvas>
      </div>
      <div id="enrollStatus" style="padding:10px;background:#f0f0f0;border-radius:8px;text-align:center;margin-bottom:16px;font-size:13px;color:#000;">
        📹 Positionnez votre visage...
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <button id="btnEnrollStart" style="flex:1;min-width:120px;padding:12px;background:#6750A4;color:white;border:none;border-radius:8px;cursor:pointer;font-size:15px;">▶ Démarrer</button>
        <button id="btnEnrollCancel" style="flex:1;min-width:120px;padding:12px;background:#ccc;color:#333;border:none;border-radius:8px;cursor:pointer;font-size:15px;">✕ Fermer</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const video  = modal.querySelector('#enrollVideo');
  const status = modal.querySelector('#enrollStatus');
  const btnS   = modal.querySelector('#btnEnrollStart');
  const btnC   = modal.querySelector('#btnEnrollCancel');
  let stream, animId;

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } } });
    video.srcObject = stream;

    // ✅ FIX B: Attendre loadedmetadata garantit que videoWidth/videoHeight sont disponibles
    // avant de démarrer la boucle. onplay seul peut se déclencher trop tôt (width=0).
    await new Promise(resolve => {
      video.onloadedmetadata = () => video.play().then(resolve).catch(resolve);
    });

    const canvas = modal.querySelector('#enrollCanvas');
    const ctx    = canvas.getContext('2d');

    // Architecture double-boucle : rendu (rAF 60fps) + détection (setTimeout 200ms)
    // Élimine le clignotement en séparant affichage et calcul ML.
    let drawRunning = true;
    let lastDet     = null; // Cache du dernier résultat — réaffiché pendant l'await

    // BOUCLE 1 — Rendu pur à 60fps via rAF, jamais bloqué par un await
    function renderLoop() {
      if (!drawRunning) return;

      const vWidth  = video.videoWidth;
      const vHeight = video.videoHeight;

      if (vWidth > 0 && vHeight > 0) {
        if (canvas.width !== vWidth || canvas.height !== vHeight) {
          canvas.width  = vWidth;
          canvas.height = vHeight;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (lastDet) {
          const landmarks = lastDet.landmarks.positions;
          const box       = lastDet.detection.box;

          // MIROIR: La vidéo a transform:scaleX(-1) CSS.
          // Face-api lit les pixels source (espace non-miré).
          // On applique le même flip dans le CTM canvas pour aligner
          // les points avec la vidéo affichée en miroir.
          ctx.save();
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);

          ctx.fillStyle = '#D0BCFF';
          landmarks.forEach(pt => {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
            ctx.fill();
          });

          ctx.strokeStyle = '#818cf8';
          ctx.lineWidth   = 2;
          ctx.strokeRect(box.x, box.y, box.width, box.height);

          ctx.restore();
        }
      }

      requestAnimationFrame(renderLoop);
    }

    // BOUCLE 2 — Détection ML toutes les 200ms, indépendante du rendu
    async function detectLoop() {
      if (!drawRunning) return;
      if (!document.getElementById('enrollmentModal')) { drawRunning = false; return; }

      if (faceapi.nets.faceLandmark68Net.isLoaded && !video.paused && !video.ended) {
        try {
          const det = await faceapi
            .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.5 }))
            .withFaceLandmarks();
          lastDet = det || null;
        } catch (landmarkErr) {
          console.warn('[EnrollDraw] Detection error:', landmarkErr?.message || landmarkErr);
        }
      }

      if (drawRunning) setTimeout(detectLoop, 200);
    }

    animId = { stop: () => { drawRunning = false; } };
    renderLoop();
    detectLoop();

    // ─── Helper : affiche le modal doublon et retourne une Promise
    //     résolue quand l'utilisateur ferme (bouton OU clic extérieur).
    function showDuplicateAlert(matchName) {
      return new Promise(resolve => {
        // Overlay semi-transparent par-dessus le modal d'enrollment
        const overlay = document.createElement('div');
        overlay.id = 'dupOverlay';
        overlay.style.cssText = [
          'position:fixed;inset:0;z-index:10100',
          'background:rgba(0,0,0,.55)',
          'display:flex;align-items:center;justify-content:center;padding:20px',
        ].join(';');

        overlay.innerHTML = `
          <div id="dupBox" style="
            background:#fff;border-radius:14px;padding:28px 24px;
            max-width:360px;width:95%;text-align:center;
            border-top:5px solid #ef4444;box-shadow:0 8px 32px rgba(0,0,0,.35);">
            <span style="font-size:48px;display:block;margin-bottom:8px;">🚫</span>
            <h3 style="margin:0 0 10px;color:#b91c1c;font-size:1.1rem;">Visage déjà enrôlé</h3>
            <p style="margin:0 0 20px;color:#374151;font-size:.95rem;">
              Ce visage appartient déjà à<br>
              <strong style="color:#111;font-size:1.05rem;">${matchName}</strong>
            </p>
            <button id="dupOkBtn" style="
              background:#ef4444;color:#fff;border:none;border-radius:8px;
              padding:10px 28px;font-size:.95rem;font-weight:600;cursor:pointer;">
              Compris
            </button>
          </div>`;

        document.body.appendChild(overlay);
        playErrorSound();

        const close = () => { overlay.remove(); resolve(); };

        document.getElementById('dupOkBtn').addEventListener('click', close);
        // Clic à l'extérieur de la boîte = fermeture
        overlay.addEventListener('click', e => {
          if (!document.getElementById('dupBox')?.contains(e.target)) close();
        });
      });
    }

    btnS.onclick = async () => {
      try {
        // ── ÉTAPE 1 : Vérification doublon AVANT toute capture ──────────────
        // On utilise recognizeFace() sur le flux live (plus rapide que
        // d'attendre les 5 photos d'enrollFace pour checkDuplicate).
        const alreadyEnrolled = state.employees.filter(
          e => e.face_enrolled && e.face_descriptors?.length > 0 && e.id !== empId
        );

        if (alreadyEnrolled.length > 0) {
          status.innerHTML = '🔍 Vérification doublon...';
          btnS.disabled = true;

          const dupCheck = await FR.recognizeFace(video, alreadyEnrolled);

          btnS.disabled = false;

          if (dupCheck.success) {
            // Doublon détecté → bloquer et informer
            status.innerHTML = '📹 Positionnez votre visage...';
            status.style.background = '#f0f0f0';
            await showDuplicateAlert(dupCheck.employe.name);
            return; // Sortir sans lancer enrollFace
          }
        }

        // ── ÉTAPE 2 : Pas de doublon → procéder à l'enrôlement ──────────────
        status.innerHTML = '⏳ Capture en cours...';
        const enrolled = await FR.enrollFace(video, emp);

        // Garde-fou post-enrollment (filet de sécurité, rare en pratique)
        const dup = FR.checkDuplicate(enrolled.face_descriptors, empId, state.employees);
        if (dup.isDuplicate) {
          await showDuplicateAlert(dup.matchedEmploye.name);
          status.innerHTML = '📹 Positionnez votre visage...';
          status.style.background = '#f0f0f0';
          return;
        }

        const idx = state.employees.findIndex(e => e.id === empId);
        if (idx > -1) state.employees[idx] = enrolled;
        await saveData();
        status.innerHTML = '✅ Enrollment terminé!'; status.style.background = '#d4edda'; status.style.color = '#000';
        setTimeout(() => { stream.getTracks().forEach(t => t.stop()); animId?.stop(); modal.remove(); displayEnrolledEmployees(); window._displayEmployees?.(); }, 1500);
      } catch (err) { status.innerHTML = `❌ ${err.message}`; status.style.background = '#f8d7da'; status.style.color = '#000'; btnS.disabled = false; }
    };
    btnC.onclick = () => { stream.getTracks().forEach(t => t.stop()); animId?.stop(); modal.remove(); };
  } catch (err) {
    status.innerHTML = '❌ Caméra non accessible.'; status.style.background = '#f8d7da'; status.style.color = '#000';
    console.error(err);
    setTimeout(() => modal.remove(), 2000);
  }
}

// ============================================================
// POINTAGE FACIAL MODAL
// ============================================================

export async function openFacePointageModal() {
  // Afficher un loading pendant le chargement des modèles
  showNotification('⏳ Chargement des modèles ML...', 'info', 0);
  
  const loaded = await FR.loadModels();
  
  // Fermer la notification de chargement
  Swal?.close?.();
  
  if (!loaded) {
    // ❌ Erreur: Modèles non disponibles
    const message = navigator.onLine
      ? `⚠️ Impossible de charger les modèles de reconnaissance faciale.\n\n` +
        `Cela peut indiquer:\n` +
        `• Connexion Internet lente ou instable\n` +
        `• CDN jsdelivr momentanément indisponible\n\n` +
        `✅ Solution: Réchauffez votre connexion et réessayez.`
      : `⚠️ Mode OFFLINE détecté.\n\n` +
        `La reconnaissance faciale nécessite:\n` +
        `• Une connexion Internet (1ère utilisation)\n` +
        `• Téléchargement des modèles ML (~40 MB)\n\n` +
        `✅ Solution: Connectez-vous à Internet et utilisez le Pointage Facial une fois pour mettre en cache les modèles. Ensuite, il fonctionnera en offline!`;
    
    showNotification(message, 'warning', 8000);
    return;
  }
  
  const enrolled = state.employees.filter(e => e.face_descriptors?.length > 0);
  if (!enrolled.length) { 
    showNotification('⚠️ Aucun employé enregistré en reconnaissance faciale.\n\nActivez le Pointage Facial dans les détails de chaque employé.', 'warning', 5000);
    return; 
  }

  const modal = document.createElement('div');
  modal.id    = 'facePointageModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = `
    <div class="modal-content-facial" style="background:white;color:#1e293b;padding:24px;border-radius:12px;max-width:500px;width:95%;max-height:95vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px;">
        <h2 style="margin:0;color:#1e293b;font-size:clamp(1.1rem,4vw,1.5rem);flex:1;">🎯 Pointage Facial</h2>
        <button id="btnSwitchCam" title="Changer caméra" style="background:#f0f0f0;border:1px solid #ccc;border-radius:50%;width:44px;height:44px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#1e293b;">
          <span class="material-icons" style="font-size:22px;color:#1e293b;">cameraswitch</span>
        </button>
      </div>
      <div id="camIndicator" style="text-align:center;margin-bottom:8px;font-size:12px;color:#000;">📷 Caméra frontale</div>
      <div style="position:relative;width:100%;max-width:320px;margin:0 auto 16px;aspect-ratio:4/3;background:#000;border-radius:8px;overflow:hidden;">
        <video id="pointageVideo" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;"></video>
      </div>
      <div id="pointageStatus" style="padding:10px;background:#f0f0f0;border-radius:8px;text-align:center;margin-bottom:16px;font-size:13px;color:#000;">📹 Prêt pour le pointage...</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <button id="btnCapture" style="flex:1;min-width:120px;padding:12px;background:#6750A4;color:white;border:none;border-radius:8px;cursor:pointer;font-size:15px;font-weight:500;">📸 Pointage</button>
        <button id="btnClosePointage" style="flex:1;min-width:120px;padding:12px;background:#ccc;color:#333;border:none;border-radius:8px;cursor:pointer;font-size:15px;">✕ Fermer</button>
      </div>
      <div style="margin-top:12px;font-size:12px;color:#000;text-align:center;">${enrolled.length} employé(s) enrolled</div>
    </div>`;
  document.body.appendChild(modal);

  const video    = modal.querySelector('#pointageVideo');
  const status   = modal.querySelector('#pointageStatus');
  const btnCap   = modal.querySelector('#btnCapture');
  const btnClose = modal.querySelector('#btnClosePointage');
  const btnSwitch= modal.querySelector('#btnSwitchCam');
  const indicator= modal.querySelector('#camIndicator');
  let stream, facing = 'user', switching = false, capturing = false;

  async function startCam(facingMode) {
    stream?.getTracks().forEach(t => t.stop()); stream = null;
    await new Promise(r => setTimeout(r, 800));
    status.innerHTML = '⏳ Démarrage caméra...';
    try {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: facingMode } } }); }
      catch { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facingMode } } }); }
      video.srcObject = stream;
      await new Promise((res, rej) => { video.onloadedmetadata = () => video.play().then(res).catch(rej); setTimeout(() => rej(new Error('Timeout')), 10000); });
      await new Promise(r => setTimeout(r, 500));
      // Warm-up
      for (let i = 0; i < 2; i++) { try { await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 })); } catch {} await new Promise(r => setTimeout(r, 300)); }
      facing = facingMode;
      indicator.innerHTML = facingMode === 'environment' ? '📷 Caméra arrière' : '🤳 Caméra frontale';
      status.innerHTML = '📹 Prêt pour le pointage...'; status.style.background = '#f0f0f0'; status.style.color = '#000';
      return true;
    } catch (err) {
      status.innerHTML = `❌ Caméra inaccessible: ${err.message}`; status.style.background = '#f8d7da'; status.style.color = '#721c24';
      return false;
    }
  }

  btnSwitch.onclick = async () => {
    if (switching || capturing) return;
    switching = true; btnSwitch.disabled = true; btnCap.disabled = true;
    await startCam(facing === 'user' ? 'environment' : 'user');
    btnSwitch.disabled = false; btnCap.disabled = false; switching = false;
  };

  btnCap.onclick = async () => {
    if (capturing || switching) return;
    capturing = true; btnCap.disabled = true; btnSwitch.disabled = true;
    try {
      status.innerHTML = '⏳ Reconnaissance...';
      const result = await FR.recognizeFace(video, enrolled);
      if (result.success) {
        const conf = (result.confidence * 100).toFixed(1);
        const ok   = await processAttendanceScan(result.employe, 'FACIAL', true);
        status.innerHTML = ok ? `✅ ${result.employe.name} (${conf}%)` : `❌ Pointage refusé`;
        status.style.background = ok ? '#d4edda' : '#f8d7da';
        status.style.color      = ok ? '#155724' : '#721c24';
        if (ok) playAuSuivantSound(); else playErrorSound();
      } else {
        status.innerHTML = `❌ ${result.message}`; status.style.background = '#f8d7da'; status.style.color = '#721c24';
      }
    } catch (err) {
      status.innerHTML = `❌ Erreur: ${err.message}`; status.style.background = '#f8d7da'; status.style.color = '#000';
    }
    await new Promise(r => setTimeout(r, 2000));
    status.innerHTML = '📹 Prêt pour le suivant...'; status.style.background = '#f0f0f0'; status.style.color = '#000';
    btnCap.disabled = false; btnSwitch.disabled = false; capturing = false;
  };

  const closeAndClean = () => { stream?.getTracks().forEach(t => t.stop()); modal.remove(); displayEnrolledEmployees(); displayTodayFaceAttendance(); };
  btnClose.onclick = closeAndClean;

  await startCam(facing);
}

// ============================================================
// FACE SEARCH FOR STATUS
// ============================================================

export async function openFaceRecognitionForStatusSearch() {
  const loaded   = await FR.loadModels();
  if (!loaded)   { showAlert('Modèles non chargés.', 'warning'); return; }
  const enrolled = state.employees.filter(e => e.face_descriptors?.length > 0);

  const modal = document.createElement('div');
  modal.id    = 'faceSearchModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = `
    <div class="modal-content-facial" style="background:white;padding:24px;border-radius:16px;max-width:500px;width:95%;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h2 style="margin:0;color:#1e293b;">👁️ Recherche par Visage</h2>
        <button id="btnCloseFaceSearch" style="background:#ef4444;color:white;border:none;border-radius:50%;width:40px;height:40px;cursor:pointer;display:flex;align-items:center;justify-content:center;">
          <span class="material-icons">close</span>
        </button>
      </div>
      <div style="position:relative;width:100%;max-width:400px;margin:0 auto 16px;aspect-ratio:4/3;background:#000;border-radius:12px;overflow:hidden;">
        <video id="faceSearchVideo" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;"></video>
      </div>
      <div id="faceSearchStatus" style="padding:16px;background:rgba(14,165,233,.1);border:2px solid rgba(14,165,233,.3);border-radius:12px;text-align:center;">
        <span class="material-icons" style="font-size:48px;color:#0ea5e9;">face_retouching_natural</span>
        <p style="margin:12px 0 0;color:#1e293b;font-weight:600;">Initialisation...</p>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const video   = modal.querySelector('#faceSearchVideo');
  const status  = modal.querySelector('#faceSearchStatus');
  const btnC    = modal.querySelector('#btnCloseFaceSearch');
  let stream, intervalId, attempts = 0;

  const close = () => { clearInterval(intervalId); stream?.getTracks().forEach(t => t.stop()); modal.remove(); };
  btnC.onclick = close;

  if (!enrolled.length) {
    status.innerHTML = '<span class="material-icons" style="font-size:48px;color:#f59e0b;">warning</span><p style="color:#f59e0b;font-weight:600;">Aucun employé enregistré</p>';
    setTimeout(close, 3000); return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
    video.srcObject = stream; await video.play();
    await new Promise(r => setTimeout(r, 100));
    status.innerHTML = '<span class="material-icons" style="font-size:48px;color:#10b981;">face</span><p style="color:#1e293b;font-weight:600;">Recherche en cours... Regardez la caméra</p>';

    intervalId = setInterval(async () => {
      if (++attempts > 30) { clearInterval(intervalId); status.innerHTML = '<p style="color:#000;">⏱️ Temps écoulé</p>'; setTimeout(close, 2000); return; }
      try {
        const result = await FR.recognizeFace(video, enrolled);
        if (result.success) {
          clearInterval(intervalId);
          const emp  = result.employe;
          const conf = (result.confidence * 100).toFixed(1);
          status.innerHTML = `<span class="material-icons" style="font-size:64px;color:#10b981;">check_circle</span><h3 style="margin:12px 0 4px;color:#000;">${emp.name}</h3><p style="color:#000;">${emp.position}</p><p style="font-size:.9em;color:#000;">Confiance: <strong style="color:#10b981;">${conf}%</strong></p>`;
          playSuccessSound();
          setTimeout(() => {
            const si = document.getElementById('smartSearchInput');
            if (si) { si.value = emp.name; window._handleSmartSearch?.(); }
            setTimeout(() => window._selectEmployeeForStat?.(emp.id), 300);
            setTimeout(() => { close(); setTimeout(() => document.getElementById('employeeStatusResults')?.scrollIntoView({ behavior: 'smooth' }), 500); }, 1500);
          }, 1000);
        }
      } catch {}
    }, 1000);
  } catch (err) {
    status.innerHTML = `<span class="material-icons" style="font-size:48px;color:#ef4444;">videocam_off</span><p style="color:#ef4444;font-weight:600;">❌ ${err.message}</p>`;
    setTimeout(close, 3000);
  }
}

// ============================================================
// FACE SCAN FOR SELECTION (advance / payroll)
// ============================================================

export async function startFaceScanForSelection(purpose) {
  const loaded   = await FR.loadModels();
  if (!loaded)   { showAlert('Modèles non chargés.', 'error'); return; }
  const enrolled = state.employees.filter(e => e.face_enrolled && e.face_descriptors?.length > 0);
  if (!enrolled.length) { showAlert('Aucun employé enrolled.', 'warning'); return; }

  const modal = document.createElement('div');
  modal.id    = 'faceScanSelectionModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:450px;text-align:center;">
      <div class="modal-header">
        <h3><span class="material-icons">face</span> Scanner le visage</h3>
        <button class="close-btn" onclick="document.getElementById('faceScanSelectionModal')?.remove()"><span class="material-icons">close</span></button>
      </div>
      <div style="position:relative;width:100%;max-width:320px;margin:16px auto;aspect-ratio:4/3;background:#000;border-radius:8px;overflow:hidden;">
        <video id="selectionVideo" autoplay playsinline style="width:100%;height:100%;object-fit:cover;transform:scaleX(-1);"></video>
      </div>
      <div id="selectionStatus" class="alert alert-info">Positionnez votre visage...</div>
    </div>`;
  document.body.appendChild(modal);

  const video  = modal.querySelector('#selectionVideo');
  const status = modal.querySelector('#selectionStatus');
  let stream, iid;

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
    video.srcObject = stream;
    await new Promise(r => video.onloadedmetadata = r);

    iid = setInterval(async () => {
      const r = await FR.recognizeFace(video, enrolled);
      if (r.success) {
        clearInterval(iid);
        const emp = r.employe;
        status.className = 'alert alert-success'; status.innerHTML = `✅ ${emp.name}`;
        playSuccessSound();

        // 1. Dispatch vers les sélecteurs de formulaires (Bridge Smart Search)
        if (purpose === 'advance') {
          const sel = document.getElementById('advanceEmployee');
          if (sel) {
            if (!sel.querySelector(`option[value="${emp.id}"]`)) {
              const opt = document.createElement('option');
              opt.value = emp.id;
              opt.textContent = emp.name;
              sel.appendChild(opt);
            }
            sel.value = emp.id;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        if (purpose === 'payroll') {
          const sel = document.getElementById('payrollEmployeeSelect');
          if (sel) {
            if (!sel.querySelector(`option[value="${emp.id}"]`)) {
              const opt = document.createElement('option');
              opt.value = emp.id;
              opt.textContent = emp.name;
              sel.appendChild(opt);
            }
            sel.value = emp.id;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }

        // 2. Dispatch vers les barres de recherche de listes
        if (purpose === 'advances-search') {
          const si = document.getElementById('advanceSearchInput');
          if (si) {
            si.value = emp.name;
            si.dispatchEvent(new Event('input', { bubbles: true }));
            si.focus();
          }
        }
        if (purpose === 'payments-search') {
          const si = document.getElementById('paymentSearch');
          if (si) {
            si.value = emp.name;
            si.dispatchEvent(new Event('input', { bubbles: true }));
            si.focus();
          }
        }

        setTimeout(() => { stream.getTracks().forEach(t => t.stop()); modal.remove(); }, 1500);
      } else {
        status.innerHTML = r.message || 'Recherche...';
      }
    }, 1000);

    modal.querySelector('.close-btn').addEventListener('click', () => { clearInterval(iid); stream.getTracks().forEach(t => t.stop()); });
  } catch (err) {
    showAlert('Caméra inaccessible.', 'error'); stream?.getTracks().forEach(t => t.stop()); modal.remove();
  }
}

// ============================================================
// ENROLLED LIST & TODAY ATTENDANCE
// ============================================================

export function displayEnrolledEmployees() {
  const container = document.getElementById('enrolledEmployeesList');
  const countSpan = document.getElementById('enrolledCount');
  if (!container) return;

  const enrolled = state.employees.filter(e => e.face_enrolled && e.face_descriptors?.length > 0);
  if (countSpan) countSpan.textContent = enrolled.length;

  if (!enrolled.length) {
    container.innerHTML = `<div style="text-align:center;padding:32px;"><span class="material-icons" style="font-size:64px;opacity:.3;">face_retouching_off</span><p>Aucun employé enrolled.</p></div>`;
    document.getElementById('enrolledPagination').innerHTML = '';
    return;
  }

  const { current: page, perPage } = state.pagination.enrolled;
  const total = enrolled.length;
  const pages = Math.ceil(total / perPage);
  const slice = enrolled.slice((page - 1) * perPage, page * perPage);

  container.innerHTML = slice.map(emp => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px;background:var(--md-sys-color-surface);border:1px solid var(--md-sys-color-outline-variant);border-radius:12px;margin-bottom:12px;border-left:4px solid var(--md-sys-color-success);">
      <div style="display:flex;align-items:center;gap:14px;">
        <span class="material-icons" style="font-size:40px;color:var(--md-sys-color-success);">face</span>
        <div><div style="font-weight:600;font-size:16px;">${emp.name}</div><div style="font-size:13px;color:var(--md-sys-color-on-surface-variant);">${emp.position || 'N/A'}</div></div>
      </div>
      <div style="text-align:right;font-size:12px;color:var(--md-sys-color-on-surface-variant);">
        <div>Enrolled le</div><div style="font-weight:500;margin-top:4px;">${formatDate(emp.face_enrollment_date, false)}</div>
      </div>
    </div>`).join('');

  renderPaginationControls('enrolledPagination', page, pages, total, perPage, p => {
    state.pagination.enrolled.current = p; displayEnrolledEmployees();
  });
}

export function displayTodayFaceAttendance() {
  const container = document.getElementById('todayFaceAttendance');
  if (!container) return;

  const today  = new Date().toISOString().split('T')[0];
  const dayAtt = state.attendance[today] || {};
  const facials = Object.values(dayAtt).filter(a => a?.method === 'FACIAL').length;

  const summary = `
    <div style="display:flex;gap:16px;margin-bottom:16px;padding:12px;background:var(--md-sys-color-surface-variant);border-radius:8px;">
      <div style="color:var(--md-sys-color-success);font-weight:500;"><span class="material-icons" style="vertical-align:middle;">check_circle</span> Facial: ${facials}</div>
      <div style="color:var(--md-sys-color-on-surface-variant);font-weight:500;"><span class="material-icons" style="vertical-align:middle;">people</span> Total: ${state.employees.length}</div>
    </div>`;

  const sorted = [...state.employees].sort((a, b) => {
    const af = dayAtt[a.id]?.method === 'FACIAL';
    const bf = dayAtt[b.id]?.method === 'FACIAL';
    if (af && !bf) return -1; if (!af && bf) return 1;
    return a.name.localeCompare(b.name);
  });

  const { current: page, perPage } = state.pagination.faceAttendance;
  const total = sorted.length, pages = Math.ceil(total / perPage);
  const slice = sorted.slice((page - 1) * perPage, page * perPage);

  container.innerHTML = summary + slice.map(emp => {
    const p = dayAtt[emp.id];
    if (p?.method === 'FACIAL') {
      return `<div class="employee-qr-item"><div class="employee-qr-info"><h4>${emp.name}</h4><p>${emp.position}</p></div>
        <div><div class="qr-status present"><span class="material-icons">check_circle</span><span>Présent</span></div>
        <div style="font-size:12px;margin-top:4px;">Arrivée: <strong>${formatDisplayTime(p.arrivee)}</strong> | Départ: <strong>${formatDisplayTime(p.depart)}</strong>
          <span class="material-icons" style="font-size:14px;color:#0ea5e9;vertical-align:middle;">face</span><span style="font-size:12px;color:#0ea5e9;font-weight:600;">FACIAL</span></div></div></div>`;
    }
    return `<div class="employee-qr-item"><div class="employee-qr-info"><h4>${emp.name}</h4><p>${emp.position}</p></div>
      <div class="qr-status absent"><span class="material-icons">cancel</span><span>Absent</span></div></div>`;
  }).join('');

  renderPaginationControls('faceAttendancePagination', page, pages, total, perPage, p => {
    state.pagination.faceAttendance.current = p; displayTodayFaceAttendance();
  });
}

// ✅ FIX: Export standalone de recognizeFace pour import dans facial-mode.js
// Évite une dépendance directe sur l'objet FR depuis l'extérieur
export const recognizeFace = (videoEl, db) => FR.recognizeFace(videoEl, db);

// Init section
export function initFacePresence() {
  registerSectionCallback('face-presence', () => { displayEnrolledEmployees(); displayTodayFaceAttendance(); });
  // ✅ FIX: Exposer globalement pour rafraîchissement après enrôlement ou pointage
  // - window._displayEnrolled était appelé ligne 314 mais jamais assigné → ignoré silencieusement
  // - window._displayFaceAttendance est appelé depuis facial-mode._registerAttendance()
  window._displayEnrolled       = displayEnrolledEmployees;
  window._displayFaceAttendance = displayTodayFaceAttendance;
}
