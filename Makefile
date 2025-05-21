.PHONY: start check-env

check-env:
	@if [ ! -f backend/.env ]; then \
		echo "❌ Erreur: Le fichier backend/.env n'existe pas"; \
		echo "📝 Créez le fichier backend/.env avec votre clé API Anthropic:"; \
		echo "ANTHROPIC_API_KEY=votre_clé_api_ici"; \
		exit 1; \
	fi

start: check-env
	@echo "🚀 Démarrage de Claude Code Army..."
	@echo "📦 Installation des dépendances..."
	@cd backend && npm install
	@echo "🌐 Lancement du serveur..."
	@cd backend && node server.js 