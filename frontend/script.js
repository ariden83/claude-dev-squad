let currentProjectId = null;
let isProcessing = false;
let statusUpdateInterval = null;
let currentWorkingDir = null;

function updateProjectInfo(projectId) {
    const projectInfo = document.getElementById('project-info');
    const projectIdSpan = document.getElementById('project-id');
    
    if (projectId) {
        projectIdSpan.textContent = projectId;
        projectInfo.classList.add('visible');
        startStatusUpdates();
    } else {
        projectInfo.classList.remove('visible');
        stopStatusUpdates();
    }
}

function setLoading(isLoading) {
    const button = document.getElementById('send-button');
    const loadingIndicator = document.createElement('span');
    loadingIndicator.className = 'loading';
    
    if (isLoading) {
        button.disabled = true;
        button.appendChild(loadingIndicator);
    } else {
        button.disabled = false;
        const loading = button.querySelector('.loading');
        if (loading) {
            loading.remove();
        }
    }
}

async function validateWorkingDir() {
    const workingDir = document.getElementById('working-dir').value.trim();
    if (!workingDir) {
        addResponseToDisplay('Erreur:', 'Veuillez spécifier un dossier de travail.', 'error');
        return;
    }

    try {
        const response = await fetch('/api/validate-working-dir', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ workingDir })
        });

        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }

        currentWorkingDir = workingDir;
        document.getElementById('send-button').disabled = false;
        addResponseToDisplay('Système', `Dossier de travail validé: ${workingDir}`, 'success');
    } catch (error) {
        console.error('Error:', error);
        addResponseToDisplay('Erreur:', error.message, 'error');
        document.getElementById('send-button').disabled = true;
    }
}

async function sendPrompt() {
    if (isProcessing) return;
    
    const prompt = document.getElementById('prompt').value;
    if (!prompt.trim()) {
        addResponseToDisplay('Erreur', 'Veuillez entrer une demande.', 'error');
        return;
    }

    if (!currentWorkingDir) {
        addResponseToDisplay('Erreur', 'Veuillez d\'abord valider un dossier de travail.', 'error');
        return;
    }

    isProcessing = true;
    setLoading(true);
    
    try {
        const result = await fetch('/api/prompt', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                prompt,
                workingDir: currentWorkingDir
            }),
        });
        
        if (!result.ok) {
            throw new Error(`HTTP error! status: ${result.status}`);
        }
        
        const data = await result.json();
        currentProjectId = data.projectId;
        updateProjectInfo(currentProjectId);
        
        addResponseToDisplay('Chef de Projet', data.response, 'success');
        handleAgentCommunication(data.response);
    } catch (error) {
        addResponseToDisplay('Erreur', 'Erreur lors de l\'envoi de la demande: ' + error.message, 'error');
    } finally {
        isProcessing = false;
        setLoading(false);
    }
}

async function handleAgentCommunication(response) {
    const agentPatterns = {
        'frontend_developer': /frontend|interface|UI|design/i,
        'backend_developer': /backend|API|serveur|base de données/i,
        'qa': /test|qualité|bug|vérification/i,
        'product_owner': /fonctionnalité|priorité|vision|business/i
    };

    for (const [role, pattern] of Object.entries(agentPatterns)) {
        if (pattern.test(response)) {
            await communicateWithAgent('project_manager', role, response);
        }
    }
}

function addResponseToDisplay(role, content, type = '') {
    const responseContainer = document.getElementById('response-container');
    const responseDiv = document.createElement('div');
    responseDiv.className = `response ${type}`;
    
    const header = document.createElement('div');
    header.className = 'response-header';
    
    const roleSpan = document.createElement('span');
    roleSpan.textContent = `${role}:`;
    
    const timestamp = document.createElement('span');
    timestamp.className = 'response-timestamp';
    timestamp.textContent = new Date().toLocaleTimeString();
    
    header.appendChild(roleSpan);
    header.appendChild(timestamp);
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'response-content';
    contentDiv.textContent = content;
    
    responseDiv.appendChild(header);
    responseDiv.appendChild(contentDiv);
    responseContainer.appendChild(responseDiv);
    
    // Scroll to bottom
    responseContainer.scrollTop = responseContainer.scrollHeight;
}

async function communicateWithAgent(fromRole, toRole, message) {
    try {
        const response = await fetch('/api/agent-communication', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fromRole,
                toRole,
                projectId: currentProjectId,
                message
            })
        });

        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }

        // Ajouter la réponse à l'affichage
        addResponseToDisplay(`${toRole} répond:`, data.response);

        // Si c'est un développeur qui termine une tâche
        if ((fromRole === 'frontend_developer' || fromRole === 'backend_developer') && 
            message.toLowerCase().includes('tâche terminée')) {
            if (data.backupCreated) {
                addResponseToDisplay('Système', `Backup créé: ${data.backupCreated}`, 'info');
            }
            if (data.qaResponse) {
                addResponseToDisplay('Le QA effectue la recette:', data.qaResponse);
            }
            if (data.projectManagerResponse) {
                addResponseToDisplay('Le Chef de Projet répond:', data.projectManagerResponse);
            }
            if (data.developerResponse) {
                addResponseToDisplay('Le développeur concerné répond:', data.developerResponse);
            }
            if (data.restored) {
                addResponseToDisplay('Système', 'Le code a été restauré à son état précédent suite à des problèmes persistants.', 'warning');
            }
        }
        // Si c'est un signalement de bug du QA
        else if (fromRole === 'QA' && message.toLowerCase().includes('bug détecté')) {
            if (data.projectManagerResponse) {
                addResponseToDisplay('Le Chef de Projet répond:', data.projectManagerResponse);
            }
            if (data.developerResponse) {
                addResponseToDisplay('Le développeur concerné répond:', data.developerResponse);
            }
            if (data.restored) {
                addResponseToDisplay('Système', 'Le code a été restauré à son état précédent suite à des problèmes persistants.', 'warning');
            }
        }
        // Si c'est une proposition de tâche du Product Owner
        else if (fromRole === 'Product Owner' && message.toLowerCase().includes('nouvelle tâche')) {
            if (data.projectManagerResponse) {
                addResponseToDisplay('Le Chef de Projet répond:', data.projectManagerResponse);
            }
        }
        // Si un agent termine sa tâche
        else if (toRole !== 'Project Manager' && data.projectManagerResponse) {
            addResponseToDisplay('Le Chef de Projet répond:', data.projectManagerResponse);
        }

        // Analyser la réponse pour détecter de nouvelles tâches
        if (data.response) {
            handleAgentCommunication(data.response);
        }
    } catch (error) {
        console.error('Error:', error);
        addResponseToDisplay('Erreur:', error.message);
    }
}

function addResponse(role, content, type = '') {
    const responseContainer = document.getElementById('response-container');
    const responseDiv = document.createElement('div');
    responseDiv.className = `response ${type}`;
    
    const header = document.createElement('div');
    header.className = 'response-header';
    
    const roleSpan = document.createElement('span');
    roleSpan.textContent = `Réponse de ${role}:`;
    
    const timestamp = document.createElement('span');
    timestamp.className = 'response-timestamp';
    timestamp.textContent = new Date().toLocaleTimeString();
    
    header.appendChild(roleSpan);
    header.appendChild(timestamp);
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'response-content';
    contentDiv.textContent = content;
    
    responseDiv.appendChild(header);
    responseDiv.appendChild(contentDiv);
    responseContainer.appendChild(responseDiv);
    
    // Scroll to bottom
    responseContainer.scrollTop = responseContainer.scrollHeight;
}

// Fonction pour mettre à jour l'état du projet
async function updateProjectStatus() {
    if (!currentProjectId) return;

    try {
        const response = await fetch(`/api/project-status/${currentProjectId}`);
        if (!response.ok) throw new Error('Failed to fetch project status');
        
        const data = await response.json();
        updateMemoriesDisplay(data.memories);
        updateTasksDisplay(data.tasks);
    } catch (error) {
        console.error('Error updating project status:', error);
    }
}

// Fonction pour mettre à jour l'affichage des mémoires
function updateMemoriesDisplay(memories) {
    const container = document.getElementById('memories-content');
    container.innerHTML = '';

    const roles = {
        'project_manager': 'Chef de Projet',
        'frontend_developer': 'Développeur Frontend',
        'backend_developer': 'Développeur Backend',
        'qa': 'QA',
        'product_owner': 'Product Owner'
    };

    for (const [role, content] of Object.entries(memories)) {
        const agentDiv = document.createElement('div');
        agentDiv.className = `agent-status tab-content ${role === 'project_manager' ? 'active' : ''}`;
        agentDiv.id = `memories-${role}`;

        const title = document.createElement('h3');
        title.textContent = roles[role] || role;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'agent-content';
        contentDiv.textContent = content;

        agentDiv.appendChild(title);
        agentDiv.appendChild(contentDiv);
        container.appendChild(agentDiv);
    }
}

// Fonction pour mettre à jour l'affichage des tâches
function updateTasksDisplay(tasks) {
    const container = document.getElementById('tasks-content');
    container.innerHTML = '';

    const roles = {
        'project_manager': 'Chef de Projet',
        'frontend_developer': 'Développeur Frontend',
        'backend_developer': 'Développeur Backend',
        'qa': 'QA',
        'product_owner': 'Product Owner'
    };

    for (const [role, content] of Object.entries(tasks)) {
        const agentDiv = document.createElement('div');
        agentDiv.className = `agent-status tab-content ${role === 'project_manager' ? 'active' : ''}`;
        agentDiv.id = `tasks-${role}`;

        const title = document.createElement('h3');
        title.textContent = roles[role] || role;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'agent-content';
        contentDiv.textContent = content;

        agentDiv.appendChild(title);
        agentDiv.appendChild(contentDiv);
        container.appendChild(agentDiv);
    }
}

// Fonction pour changer d'onglet
function switchTab(type, role) {
    // Mettre à jour les onglets
    const tabs = document.querySelectorAll(`.${type} .tab`);
    tabs.forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');

    // Mettre à jour le contenu
    const contents = document.querySelectorAll(`#${type}-content .tab-content`);
    contents.forEach(content => content.classList.remove('active'));
    document.getElementById(`${type}-${role}`).classList.add('active');
}

// Fonction pour démarrer la mise à jour périodique
function startStatusUpdates() {
    if (statusUpdateInterval) {
        clearInterval(statusUpdateInterval);
    }
    statusUpdateInterval = setInterval(updateProjectStatus, 2000); // Mise à jour toutes les 2 secondes
}

// Fonction pour arrêter la mise à jour périodique
function stopStatusUpdates() {
    if (statusUpdateInterval) {
        clearInterval(statusUpdateInterval);
        statusUpdateInterval = null;
    }
}

async function killAllClaudeProcesses() {
    if (!confirm('Êtes-vous sûr de vouloir arrêter tous les processus Claude ?')) {
        return;
    }

    try {
        const response = await fetch('/api/kill-claude', {
            method: 'POST'
        });

        if (!response.ok) {
            throw new Error('Erreur lors de l\'arrêt des processus');
        }

        const data = await response.json();
        addResponseToDisplay('Système', `Tous les processus Claude ont été arrêtés. ${data.message}`, 'success');
        
        // Réinitialiser l'interface
        currentProjectId = null;
        updateProjectInfo(null);
        document.getElementById('send-button').disabled = true;
        document.getElementById('prompt').value = '';
        
    } catch (error) {
        console.error('Error:', error);
        addResponseToDisplay('Erreur', error.message, 'error');
    }
}

async function selectDirectory() {
    try {
        // Vérifier si l'API est supportée
        if (!window.showDirectoryPicker) {
            throw new Error('La sélection de dossier n\'est pas supportée dans votre navigateur. Veuillez entrer le chemin manuellement.');
        }

        // Ouvrir le sélecteur de dossier
        const dirHandle = await window.showDirectoryPicker();
        
        // Obtenir le chemin du dossier via une requête au serveur
        const response = await fetch('/api/get-absolute-path', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                dirName: dirHandle.name,
                dirHandle: dirHandle
            })
        });

        if (!response.ok) {
            throw new Error('Erreur lors de la récupération du chemin absolu');
        }

        const data = await response.json();
        
        // Mettre à jour le champ de saisie avec le chemin absolu
        document.getElementById('working-dir').value = data.absolutePath;
        
        // Valider automatiquement le dossier
        await validateWorkingDir();
        
    } catch (error) {
        console.error('Error:', error);
        if (error.name === 'AbortError') {
            // L'utilisateur a annulé la sélection
            return;
        }
        addResponseToDisplay('Erreur:', error.message, 'error');
    }
}

async function markAllTasksAsCompleted() {
    if (!currentProjectId) {
        addResponseToDisplay('Erreur', 'Aucun projet en cours', 'error');
        return;
    }

    if (!confirm('Êtes-vous sûr de vouloir marquer toutes les tâches comme terminées ?')) {
        return;
    }

    try {
        const response = await fetch('/api/mark-all-tasks-completed', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ projectId: currentProjectId })
        });

        if (!response.ok) {
            throw new Error('Erreur lors de la mise à jour des tâches');
        }

        const data = await response.json();
        addResponseToDisplay('Système', 'Toutes les tâches ont été marquées comme terminées', 'success');
        
        // Mettre à jour l'affichage
        updateProjectStatus();
        
    } catch (error) {
        console.error('Error:', error);
        addResponseToDisplay('Erreur', error.message, 'error');
    }
}

async function resetAllTasks() {
    if (!currentProjectId) {
        addResponseToDisplay('Erreur', 'Aucun projet en cours', 'error');
        return;
    }

    if (!confirm('Êtes-vous sûr de vouloir réinitialiser toutes les tâches et les mémoires ? Cette action est irréversible.')) {
        return;
    }

    try {
        const response = await fetch('/api/reset-all-tasks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ projectId: currentProjectId })
        });

        if (!response.ok) {
            throw new Error('Erreur lors de la réinitialisation des tâches');
        }

        const data = await response.json();
        addResponseToDisplay('Système', 'Toutes les tâches et mémoires ont été réinitialisées', 'success');
        
        // Mettre à jour l'affichage
        updateProjectStatus();
        
    } catch (error) {
        console.error('Error:', error);
        addResponseToDisplay('Erreur', error.message, 'error');
    }
} 