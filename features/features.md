# Liste des Features

Ce fichier est maintenu par le Chef de Projet et le QA. Il contient la liste de toutes les features fonctionnelles du projet et les tests associés pour vérifier leur bon fonctionnement.

## Format d'une Feature

```markdown
### [Nom de la Feature]
- **Description**: Description courte de la feature
- **Statut**: ✅ Fonctionnelle / 🚧 En cours / ❌ Cassée
- **Dernière vérification**: [Date]
- **Tests de régression**:
  1. [Description du test 1]
  2. [Description du test 2]
  ...
- **Dépendances**: [Liste des features dont celle-ci dépend]
```

## Features

### [Backup et Restauration]
- **Description**: Système de backup automatique et restauration en cas de problème
- **Statut**: ✅ Fonctionnelle
- **Dernière vérification**: [Date]
- **Tests de régression**:
  1. Vérifier qu'un backup est créé quand un développeur termine une tâche
  2. Vérifier que le backup contient tous les fichiers nécessaires
  3. Vérifier que la restauration fonctionne après 3 tentatives de correction échouées
- **Dépendances**: Aucune

### [Gestion des Bugs]
- **Description**: Système de détection et correction des bugs
- **Statut**: ✅ Fonctionnelle
- **Dernière vérification**: [Date]
- **Tests de régression**:
  1. Vérifier que le QA peut signaler un bug
  2. Vérifier que le développeur reçoit la notification
  3. Vérifier que le Chef de Projet est notifié
  4. Vérifier que le processus de correction est lancé
- **Dépendances**: Backup et Restauration 