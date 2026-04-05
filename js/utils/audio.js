// ============================================================
// utils/audio.js — Gestion du son (ES Module)
// ============================================================

let audioContext;

export function initializeAudio() {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') {
      const resume = () => {
        audioContext.resume();
        document.body.removeEventListener('click', resume);
        document.body.removeEventListener('touchstart', resume);
      };
      document.body.addEventListener('click', resume);
      document.body.addEventListener('touchstart', resume);
    }
  } catch (e) {
    console.error('AudioContext non disponible:', e);
  }
}

export function playSuccessSound() {
  if (!audioContext) return;
  try {
    const now  = audioContext.currentTime;
    const gain = audioContext.createGain();
    gain.connect(audioContext.destination);
    gain.gain.setValueAtTime(0.5, now);

    [[440, 0], [554.37, 0.1], [739.99, 0.2]].forEach(([freq, when]) => {
      const osc = audioContext.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + when);
      osc.connect(gain);
      osc.start(now + when);
      osc.stop(now + when + (freq === 739.99 ? 0.3 : 0.1));
    });
  } catch (e) {
    console.error('Erreur son succès:', e);
  }
}

export function playGenericErrorSound() {
  if (!audioContext || audioContext.state !== 'running') return;
  try {
    const now  = audioContext.currentTime;
    const osc  = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.frequency.value = 400;
    osc.type = 'square';
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  } catch (e) {
    console.error('Erreur son error:', e);
  }
}

export async function playErrorSound() {
  try {
    const basePath = window.location.pathname.includes('/systeme-rh-behavana/') ? '/systeme-rh-behavana' : '';
    const url = `${window.location.origin}${basePath}/efateo.mp3`;
    const cached = await caches.match(url);
    let player;
    if (cached) {
      const blob = await cached.blob();
      player = new Audio(URL.createObjectURL(blob));
    } else {
      player = new Audio('efateo.mp3');
    }
    player.volume = 0.7;
    await player.play();
  } catch {
    playGenericErrorSound();
  }
}

export async function playAuSuivantSound() {
  try {
    const basePath = window.location.pathname.includes('/systeme-rh-behavana/') ? '/systeme-rh-behavana' : '';
    const url = `${window.location.origin}${basePath}/suivant.mp3`;
    const cached = await caches.match(url);
    let player;
    if (cached) {
      const blob = await cached.blob();
      player = new Audio(URL.createObjectURL(blob));
    } else {
      player = new Audio('suivant.mp3');
    }
    player.volume = 0.8;
    await player.play();
  } catch {
    console.warn('Son suivant.mp3 non disponible');
  }
}
