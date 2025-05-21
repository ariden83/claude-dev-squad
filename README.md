# Claude Code Army

Un système multi-agents basé sur Claude pour la gestion et le développement de projets logiciels.

## Description

Claude Code Army est un système qui utilise plusieurs instances de Claude pour simuler une équipe de développement complète :
- Chef de Projet : Coordonne l'équipe et gère les tâches
- Développeurs Frontend et Backend : Implémentent les fonctionnalités
- QA : Assure la qualité du code
- Product Owner : Définit la vision produit

## Prérequis

- Node.js (v14 ou supérieur)
- npm ou yarn
- Une clé API Anthropic
- Make (pour utiliser les commandes make)

## Installation

1. Clonez le repository :
```bash
git clone https://github.com/votre-username/claude-army.git
cd claude-army
```

2. Installez les dépendances :
```bash
cd backend
npm install
cd ../frontend
npm install
```

3. Configurez le fichier .env :
```bash
cd backend
cp .env.example .env
```
Editez le fichier `.env` et ajoutez votre clé API Anthropic :
```
ANTHROPIC_API_KEY=votre_clé_api_ici
```

## Configuration

### Dossier de travail
Le système nécessite un dossier de travail valide avec les permissions appropriées. Ce dossier doit :
- Être un chemin absolu
- Avoir les permissions de lecture/écriture
- Contenir un dossier `.claude` avec le fichier `settings.local.json`

### Permissions Claude
Le fichier `.claude/settings.local.json` est automatiquement créé avec les permissions suivantes :
```json
{
  "permissions": {
    "allow": [
      "Bash(*)",
      "Bash(ls:*)",
      "Edit(*)",
      "Glob(*)",
      "Grep(*)",
      "LS(*)",
      "NotebookRead(*)",
      "NotebookEdit(*)",
      "Read(*)",
      "WebFetch(*)",
      "Write(*_test.go)"
    ],
    "deny": [
      "Bash(git *:*)"
    ]
  }
}
```

## Utilisation

1. Démarrez le serveur :
```bash
make start
```

2. Ouvrez votre navigateur à l'adresse : `http://localhost:3000`

3. Dans l'interface :
   - Spécifiez le dossier de travail
   - Validez le dossier
   - Entrez votre demande
   - Suivez les interactions entre les agents

## Fonctionnalités

### Gestion des tâches
- Création et suivi des tâches
- Attribution automatique aux développeurs appropriés
- Validation par le QA
- Gestion des bugs

### Système de backup
- Backup automatique après chaque tâche
- Restauration en cas de problème
- Limite de tentatives de correction

### Interface en temps réel
- Affichage des mémoires des agents
- Suivi des tâches en cours
- Historique des communications
- Statut du projet

## Structure du projet

```
claude-army/
├── backend/
│   ├── server.js
│   ├── .env
│   └── package.json
├── frontend/
│   ├── index.html
│   └── package.json
├── prompts/
│   ├── project_manager.md
│   ├── frontend_developer.md
│   ├── backend_developer.md
│   ├── qa.md
│   └── product_owner.md
├── tasks/
├── backups/
└── features/
```

## Développement

### Ajouter un nouvel agent
1. Créez un nouveau fichier de prompt dans `prompts/`
2. Ajoutez le rôle dans `ROLES` dans `server.js`
3. Mettez à jour l'interface frontend

### Modifier les permissions
1. Modifiez la constante `CLAUDE_SETTINGS` dans `server.js`
2. Les nouveaux paramètres seront appliqués au prochain démarrage

## Dépannage

### Erreurs courantes

1. "Le fichier backend/.env n'existe pas"
   - Solution : Créez le fichier .env avec votre clé API

2. "Le chemin doit être absolu"
   - Solution : Utilisez un chemin absolu pour le dossier de travail

3. "Pas de permission de lecture/écriture"
   - Solution : Vérifiez les permissions du dossier

## Contribution

Les contributions sont les bienvenues ! N'hésitez pas à :
1. Fork le projet
2. Créer une branche pour votre fonctionnalité
3. Commiter vos changements
4. Pousser vers la branche
5. Ouvrir une Pull Request

## Licence

MIT

## Contact

Pour toute question ou suggestion, n'hésitez pas à ouvrir une issue. 