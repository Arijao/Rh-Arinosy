# RH RiseVanilla — Version Modulaire

## Architecture

```
rh-behavana/
├── index.html              ← Squelette HTML + <script type="module">
├── css/
│   └── styles.css          ← Tout le CSS (extrait de l'original)
├── js/
│   ├── main.js             ← Point d'entrée, init, globals
│   ├── db.js               ← IndexedDBManager (classe ES Module)
│   ├── state.js            ← État global + saveData/loadData
│   ├── ui/
│   │   ├── navigation.js   ← Menu hamburger, showSection, thème
│   │   ├── employees.js    ← CRUD employés
│   │   ├── groups.js       ← Groupes + selects + salaire en masse
│   │   ├── attendance.js   ← Présences manuelles
│   │   ├── advances.js     ← Avances
│   │   ├── payroll.js      ← Calcul de la paie
│   │   ├── stats.js        ← Dashboard, charts, notifications
│   │   ├── search.js       ← Recherche intelligente statut employé
│   │   ├── qr.js           ← Scanner QR + présences QR + génération codes
│   │   ├── reports.js      ← Rapports PDF/JSON/Excel
│   │   ├── stc.js          ← Solde de tout compte
│   │   ├── estimation.js   ← Estimation salaires
│   │   ├── data-manager.js ← Export/Import/Reset données
│   │   ├── auth.js         ← Authentification PIN (NOUVEAU)
│   │   └── scan-menu.js    ← Dropdown méthode scan
│   ├── face/
│   │   └── recognition.js  ← Reconnaissance faciale complète
│   └── utils/
│       ├── format.js       ← formatCurrency, formatDate, debounce...
│       ├── audio.js        ← Sons (succès, erreur, suivant)
│       ├── ui.js           ← showAlert, openModal, pagination
│       └── attendance-calc.js ← countPresenceDays, getLastPaidMonth...
├── models/                 ← Modèles face-api (inchangés)
├── manifest.json
├── service-worker.js
├── roboto.css
├── icons.css
├── efateo.mp3
└── suivant.mp3
```

## 🚀 Démarrage & Déploiement

### Prérequis
- Navigateur moderne (Chrome 80+, Firefox 75+, Safari 14+)
- **Aucun serveur Node.js nécessaire pour le fonctionnement offline**
- Un serveur HTTP minimal pour le développement (obligatoire pour ES Modules)

### � Démarrage Rapide

### ⚡ TL;DR (30 secondes)

**Sans aucun outil** → Netlify Drop:
1. Aller sur https://app.netlify.com/drop
2. Glisser-déposer le dossier
3. ✅ App en ligne!

**En local** → Double-cliquer:
- Windows: `server.cmd`
- Mac/Linux: `server.sh`

**Production** → Vercel + GitHub (voir DEPLOYMENT.md)

### 📚 Guides Détaillés

- **[NO-TOOLS-GUIDE.md](NO-TOOLS-GUIDE.md)** ← **COMMENCER ICI** (Zéro installation)
- **[QUICK_START.md](QUICK_START.md)** — 4 solutions rapides
- **[DEPLOYMENT.md](DEPLOYMENT.md)** — Production (Vercel, GitHub, Netlify)
- **[IMPROVEMENTS.md](IMPROVEMENTS.md)** — Détails techniques (dark mode, offline)

#### 🪟 Windows
**Option 1: Serveur HTTP Python natif** (Windows 10+)
```powershell
# Ouvrir PowerShell dans le dossier du projet, puis :
python -m http.server 8080
# Puis : http://localhost:8080
```

**Option 2: Node.js portable** (recommandé si Python non installé)
```powershell
# Télécharger : https://nodejs.org/en/download/
# Puis dans le dossier du projet:
npx serve .
# → Ouvre automatiquement http://localhost:3000
```

**Option 3: Serveur HTTP PHP natif** (Windows 10+)
```powershell
# Dans le dossier du projet :
php -S localhost:8080
```

#### 🍎 Mac / 🐧 Linux
```bash
# Option 1: Python (inclus par défaut)
python3 -m http.server 8080

# Option 2: Node.js
npx serve .

# Option 3: Ruby (inclus sur macOS)
ruby -run -ehttpd . -p8080

# Option 4: Serveur minimaliste bash
# Créer un script simple.sh :
```

**simple.sh** (Linux/Mac - serveur HTTP minimal sans dépendances)
```bash
#!/bin/bash
PORT=8080
echo "Serveur sur http://localhost:$PORT"
while true; do
  { echo -ne "HTTP/1.1 200 OK\r\n"; cat index.html; } | nc -l localhost $PORT
done
```

#### 🌐 Sans Aucun Outil (Solution Universelle)

**Option: Ouvrir directement le fichier**
```
⏸️ LIMITATION: ES Modules ne fonctionnent pas en file:// 
❌ Erreur: "Cannot use import statement outside a module"
```

**MEILLEURE SOLUTION: Utiliser un CDN gratuit**

1. **Déployer sur GitHub Pages** (voir section Déploiement)
2. **Ou utiliser Netlify Drop** : Glisser-déposer le dossier
   - https://app.netlify.com/drop
   - Instantané, pas de compte nécessaire
   - URL publique générée en 30 secondes

3. **Ou utiliser Vercel** (voir section Déploiement)

### 📦 Déploiement

#### 🐙 GitHub + Vercel (RECOMMANDÉ - Production Ready)

**Étape 1: Créer un repo GitHub**
```bash
cd ~/rh-behavana
git init
git add .
git commit -m "Initial commit: RH RiseVanilla v2.0"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/rh-behavana.git
git push -u origin main
```

**Étape 2: Déployer sur Vercel** (gratuit + illimité)
1. Aller sur https://vercel.com/import
2. Connecter GitHub
3. Sélectionner le repo `rh-behavana`
4. Cliquer "Deploy"
5. ✅ App déployée en 1 minute!
   - URL: `https://rh-behavana-xyz.vercel.app`
   - Domaine custom possible

**Avantages Vercel**:
- ✅ Déploiement automatique à chaque push
- ✅ HTTPS inclus (sécurisé)
- ✅ Offline-first via Service Worker
- ✅ Analytics et performance monitoring
- ✅ Edge caching automatique

#### 🐙 GitHub Pages (Alternative Gratuite)

**Pour un repo public**:
1. Activer "GitHub Pages" dans Settings
2. Source: Branch `main`, folder `/`
3. ✅ App accessible via `https://username.github.io/rh-behavana`

⏸️ **Limitation**: Pas de domaine custom sans Vercel

#### 🌐 Netlify (Alternative)
```bash
npm install -g netlify-cli
netlify deploy --prod --dir .
```

#### 🔒 Hébergement Privé (Entreprise)
- **Apache/Nginx** : Copier les fichiers dans `/var/www/html`
- **AWS S3 + CloudFront** : Hosting statique sécurisé
- **Azure Static Web Apps** : Comme Vercel (gratuit)

### 📝 Configuration Vercel

**Créer `vercel.json`** (optionnel - configuration avancée):
```json
{
  "buildCommand": null,
  "outputDirectory": ".",
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/service-worker.js",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=3600" }
      ]
    },
    {
      "source": "/index.html",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=300" }
      ]
    }
  ]
}
```

Cela optimise le caching et la gestion du routing SPA.

### 🔄 Mise à Jour après Déploiement

**GitHub → Vercel (Automatique)**
```bash
# Depuis votre machine locale:
git add .
git commit -m "Update: Feature X"
git push origin main
# → Vercel redéploie automatiquement!
```

**Vérifier le déploiement**:
1. Aller sur https://vercel.com/dashboard
2. Sélectionner "rh-behavana"
3. Voir l'historique des déploiements
4. Rollback en 1 clic si nécessaire

## 📚 Documentation Complète

- **[IMPROVEMENTS.md](IMPROVEMENTS.md)** — Détail des améliorations v2.0 (dark mode, offline, routing)
- **[DEPLOYMENT.md](DEPLOYMENT.md)** — Guide complet de déploiement (Vercel, GitHub, Netlify)
- **[.github/SECRETS.md](.github/SECRETS.md)** — Configuration GitHub Actions + Vercel

## 🔐 Authentification PIN

Au premier lancement, l'application vous demande de créer un PIN à 4 chiffres.  
Ce PIN est stocké localement dans IndexedDB (hashé).  
La session expire après **8 heures d'inactivité**.  
Verrou manuel via le bouton 🔒 dans le header.

## Ajout de nouvelles fonctionnalités

Pour ajouter un nouveau module :

1. Créez `js/ui/mon-module.js` avec vos fonctions
2. Importez-le dans `js/main.js`
3. Enregistrez la section via `registerSectionCallback('ma-section', maFonction)` si nécessaire
4. Exposez les fonctions globales via `window.maFonction = maFonction`

## Migration depuis l'ancien index.html monolithique

Les données IndexedDB sont **100% compatibles** — aucune migration nécessaire.  
Même nom de base de données (`BehavanaHRSystem`), même version, mêmes stores.

## Différences avec la version originale

| Aspect | Original | Modulaire |
|--------|----------|-----------|
| Structure | 1 fichier HTML (~10k lignes) | 20+ fichiers ES Modules |
| CSS | `<style>` dans le HTML | `css/styles.css` séparé |
| JS | `<script>` inline | `js/` modulaire |
| Auth | Aucune | PIN à 4 chiffres (IndexedDB) |
| Démarrage | Fichier seul | Serveur HTTP requis (ES Modules) |
| IndexedDB | Identique | Identique |
| Offline | ✅ | ✅ (via Service Worker) |
