# GitHub Secrets Configuration

Pour configurer le déploiement automatique sur Vercel via GitHub Actions:

## 🔐 Étapes de Configuration

### 1. Créer un Token Vercel

1. Aller sur https://vercel.com/account/tokens
2. Cliquer "Create Token"
3. Nommer: `VERCEL_TOKEN`
4. Copier le token

### 2. Ajouter les Secrets GitHub

1. Aller sur https://github.com/YOUR_USERNAME/rh-behavana/settings/secrets/actions
2. Cliquer "New repository secret"
3. Ajouter ces 3 secrets:

#### Secret 1: VERCEL_TOKEN
- **Name**: `VERCEL_TOKEN`
- **Value**: [Copier le token Vercel]

#### Secret 2: VERCEL_ORG_ID (optionnel mais recommandé)
1. Dans Vercel Dashboard
2. Aller sur Account Settings → General
3. Copier "Team ID"
- **Name**: `VERCEL_ORG_ID`
- **Value**: [Team ID]

#### Secret 3: VERCEL_PROJECT_ID
1. Dans Vercel Dashboard → rh-behavana project
2. Settings → General
3. Copier "Project ID"
- **Name**: `VERCEL_PROJECT_ID`
- **Value**: [Project ID]

### 3. Tester le Déploiement

```bash
# Faire un commit pour déclencher le workflow
git commit --allow-empty -m "Test CI/CD"
git push origin main

# Vérifier le déploiement:
# GitHub -> Actions → Voir le workflow en cours
# Vercel -> Deployments → Vérifier le déploiement
```

## ✅ Résultat

- ✅ À chaque `git push origin main`
- ✅ GitHub Actions se déclenche
- ✅ Code déployé automatiquement sur Vercel
- ✅ App en ligne en 30 secondes

## 🎯 Alternative: Sans Secrets (Plus Simple)

Si vous avez du mal à configurer les secrets:

1. **Vercel Dashboard** → rh-behavana
2. **Settings** → Git
3. **Production Branch**: main
4. ✅ Auto-deploy activé par défaut!

Plus besoin de GitHub Actions ou de secrets.
