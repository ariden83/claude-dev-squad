const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();
const logger = require('./logger');

// Vérification de la présence de la clé API
if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Erreur: ANTHROPIC_API_KEY n\'est pas définie dans le fichier .env');
    process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('../frontend'));

// Middleware de logging
app.use(logger.http);

// Configuration
const ROLES = {
    PROJECT_MANAGER: 'project_manager',
    FRONTEND_DEVELOPER: 'frontend_developer',
    BACKEND_DEVELOPER: 'backend_developer',
    QA: 'qa',
    PRODUCT_OWNER: 'product_owner'
};

const CONFIG = {
    CLAUDE_TIMEOUT: 30000, // 30 secondes
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000, // 1 seconde
    MAX_QA_ATTEMPTS: 3, // Nombre maximum de tentatives de correction avant restauration
};

// Configuration des permissions Claude
const CLAUDE_SETTINGS = {
    permissions: {
        allow: [
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
        deny: [
            "Bash(git *:*)"
        ]
    }
};

// Fonction pour attendre un délai
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Fonction pour lire le prompt d'un rôle avec mise en cache
const promptCache = new Map();
async function getRolePrompt(role) {
    if (promptCache.has(role)) {
        return promptCache.get(role);
    }
    const promptPath = path.join(__dirname, '../prompts', `${role}.md`);
    const prompt = await fs.readFile(promptPath, 'utf8');
    promptCache.set(role, prompt);
    return prompt;
}

// Fonction pour créer ou mettre à jour le fichier mémoire d'un agent
async function updateAgentMemory(role, projectId, content) {
    const memoryDir = path.join(__dirname, '../tasks', projectId);
    await fs.mkdir(memoryDir, { recursive: true });
    const memoryPath = path.join(memoryDir, `${role}_memory.md`);
    await fs.writeFile(memoryPath, content, 'utf8');
}

// Fonction pour lire la mémoire d'un agent
async function readAgentMemory(role, projectId) {
    const memoryPath = path.join(__dirname, '../tasks', projectId, `${role}_memory.md`);
    try {
        return await fs.readFile(memoryPath, 'utf8');
    } catch (error) {
        return '';
    }
}

// Fonction pour créer ou mettre à jour le fichier de tâches d'un agent
async function updateAgentTasks(role, projectId, content) {
    const tasksDir = path.join(__dirname, '../tasks', projectId);
    await fs.mkdir(tasksDir, { recursive: true });
    const tasksPath = path.join(tasksDir, `${role}_tasks.md`);
    await fs.writeFile(tasksPath, content, 'utf8');
}

// Fonction pour lire les tâches d'un agent
async function readAgentTasks(role, projectId) {
    const tasksPath = path.join(__dirname, '../tasks', projectId, `${role}_tasks.md`);
    try {
        return await fs.readFile(tasksPath, 'utf8');
    } catch (error) {
        return '';
    }
}

// Fonction pour exécuter Claude avec retry et timeout
async function executeClaude(prompt, retries = CONFIG.MAX_RETRIES) {
    return new Promise((resolve, reject) => {
        const command = `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY} claude -p --output-format json --verbose "${prompt}"`;
        
        const timeout = setTimeout(() => {
            process.kill(childProcess.pid);
            reject(new Error('Claude execution timeout'));
        }, CONFIG.CLAUDE_TIMEOUT);

        const childProcess = exec(command, async (error, stdout, stderr) => {
            clearTimeout(timeout);
            
            if (error) {
                if (retries > 0) {
                    await delay(CONFIG.RETRY_DELAY);
                    try {
                        const result = await executeClaude(prompt, retries - 1);
                        resolve(result);
                    } catch (retryError) {
                        reject(retryError);
                    }
                } else {
                    reject(error);
                }
                return;
            }

            try {
                const response = JSON.parse(stdout);
                resolve(response);
            } catch (e) {
                reject(new Error('Invalid JSON response from Claude'));
            }
        });
    });
}

// Fonction pour générer un ID de projet unique
function generateProjectId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Fonction pour relancer le Chef de Projet après une tâche complétée
async function restartProjectManager(projectId, completionMessage) {
    try {
        const projectManagerPrompt = await getRolePrompt(ROLES.PROJECT_MANAGER);
        const projectManagerMemory = await readAgentMemory(ROLES.PROJECT_MANAGER, projectId);
        
        const fullPrompt = `${projectManagerPrompt}\n\nContexte précédent:\n${projectManagerMemory}\n\nNouvelle information:\n${completionMessage}`;
        
        const response = await executeClaude(fullPrompt);
        await updateAgentMemory(ROLES.PROJECT_MANAGER, projectId, `${projectManagerMemory}\n\n${completionMessage}\n\nRéponse du Chef de Projet:\n${response[0].result}`);
        
        return response[0].result;
    } catch (error) {
        console.error('Error restarting Project Manager:', error);
        throw new Error(`Failed to restart Project Manager: ${error.message}`);
    }
}

// Fonction pour lister les fichiers d'un projet
async function listProjectFiles(projectId) {
    const projectDir = path.join(__dirname, '../tasks', projectId);
    try {
        const files = await fs.readdir(projectDir);
        return files;
    } catch (error) {
        return [];
    }
}

// Endpoint pour récupérer l'état d'un projet
app.get('/api/project-status/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const files = await listProjectFiles(projectId);
        
        const projectStatus = {
            memories: {},
            tasks: {}
        };

        for (const file of files) {
            const filePath = path.join(__dirname, '../tasks', projectId, file);
            const content = await fs.readFile(filePath, 'utf8');
            
            if (file.endsWith('_memory.md')) {
                const role = file.replace('_memory.md', '');
                projectStatus.memories[role] = content;
            } else if (file.endsWith('_tasks.md')) {
                const role = file.replace('_tasks.md', '');
                projectStatus.tasks[role] = content;
            }
        }

        res.json(projectStatus);
    } catch (error) {
        console.error('Error fetching project status:', error);
        res.status(500).json({ error: error.message });
    }
});

// Fonction pour vérifier et créer le fichier settings.local.json
async function ensureClaudeSettings(workingDir) {
    try {
        const claudeDir = path.join(workingDir, '.claude');
        const settingsPath = path.join(claudeDir, 'settings.local.json');

        // Créer le dossier .claude s'il n'existe pas
        await fs.mkdir(claudeDir, { recursive: true });

        // Vérifier si le fichier settings.local.json existe
        try {
            await fs.access(settingsPath);
            // Le fichier existe, vérifier son contenu
            const currentSettings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
            if (JSON.stringify(currentSettings) !== JSON.stringify(CLAUDE_SETTINGS)) {
                // Les paramètres sont différents, mettre à jour le fichier
                await fs.writeFile(settingsPath, JSON.stringify(CLAUDE_SETTINGS, null, 2), 'utf8');
                console.log('Fichier settings.local.json mis à jour avec les nouvelles permissions');
            }
        } catch (error) {
            // Le fichier n'existe pas, le créer
            await fs.writeFile(settingsPath, JSON.stringify(CLAUDE_SETTINGS, null, 2), 'utf8');
            console.log('Fichier settings.local.json créé avec les permissions nécessaires');
        }
    } catch (error) {
        console.error('Erreur lors de la configuration des permissions Claude:', error);
        throw new Error(`Impossible de configurer les permissions Claude: ${error.message}`);
    }
}

// Modifier la fonction validateWorkingDir pour inclure la vérification des permissions
async function validateWorkingDir(workingDir) {
    try {
        // Vérifier si le chemin est absolu
        if (!path.isAbsolute(workingDir)) {
            throw new Error('Le chemin doit être absolu');
        }

        // Nettoyer le chemin (supprimer les points superflus, normaliser les séparateurs)
        const cleanPath = path.normalize(workingDir);

        // Vérifier si le dossier existe
        try {
            const stats = await fs.stat(cleanPath);
            if (!stats.isDirectory()) {
                throw new Error('Le chemin spécifié n\'est pas un dossier');
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw new Error(`Le dossier n'existe pas: ${cleanPath}`);
            }
            throw error;
        }

        // Vérifier les permissions
        try {
            await fs.access(cleanPath, fs.constants.R_OK | fs.constants.W_OK);
        } catch (error) {
            throw new Error('Pas de permission de lecture/écriture sur le dossier');
        }

        // Vérifier et configurer les permissions Claude
        await ensureClaudeSettings(cleanPath);

        return true;
    } catch (error) {
        logger.error('Erreur de validation du dossier', { 
            workingDir,
            error: error.message,
            code: error.code
        });
        throw new Error(`Erreur de validation du dossier: ${error.message}`);
    }
}

// Endpoint pour valider le dossier de travail
app.post('/api/validate-working-dir', async (req, res) => {
    try {
        const { workingDir } = req.body;
        logger.info('Validation du dossier de travail', { workingDir });
        if (!workingDir) {
            return res.status(400).json({ error: 'Dossier de travail non spécifié' });
        }

        await validateWorkingDir(workingDir);
        res.json({ success: true });
    } catch (error) {
        logger.error('Erreur lors de la validation du dossier', { error: error.message });
        res.status(400).json({ error: error.message });
    }
});

// Endpoint pour recevoir les prompts initiaux
app.post('/api/prompt', async (req, res) => {
    try {
        const { prompt, workingDir } = req.body;
        logger.info('Nouvelle demande reçue', { prompt, workingDir });
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }
        if (!workingDir) {
            return res.status(400).json({ error: 'Working directory is required' });
        }

        // Valider le dossier de travail
        await validateWorkingDir(workingDir);

        const projectId = generateProjectId();
        const projectManagerPrompt = await getRolePrompt(ROLES.PROJECT_MANAGER);
        const initialMessage = `Nouveau projet (ID: ${projectId})\n\nDossier de travail: ${workingDir}\n\nDemande de l'utilisateur:\n${prompt}`;
        
        await updateAgentMemory(ROLES.PROJECT_MANAGER, projectId, initialMessage);
        const fullPrompt = `${projectManagerPrompt}\n\n${initialMessage}`;
        
        const response = await executeClaude(fullPrompt);
        await updateAgentMemory(ROLES.PROJECT_MANAGER, projectId, `${initialMessage}\n\nRéponse du Chef de Projet:\n${response[0].result}`);
        
        res.json({ 
            response: response[0].result,
            projectId: projectId
        });
    } catch (error) {
        logger.error('Erreur lors du traitement de la demande', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// Fonction pour proposer une nouvelle tâche au Chef de Projet
async function proposeTaskToProjectManager(projectId, taskProposal) {
    try {
        const projectManagerPrompt = await getRolePrompt(ROLES.PROJECT_MANAGER);
        const projectManagerMemory = await readAgentMemory(ROLES.PROJECT_MANAGER, projectId);
        const projectManagerTasks = await readAgentTasks(ROLES.PROJECT_MANAGER, projectId);
        
        const fullPrompt = `${projectManagerPrompt}\n\nContexte précédent:\n${projectManagerMemory}\n\nTâches actuelles:\n${projectManagerTasks}\n\nNouvelle proposition de tâche du Product Owner:\n${taskProposal}\n\nVeuillez évaluer cette proposition et mettre à jour la liste des tâches si nécessaire.`;
        
        const response = await executeClaude(fullPrompt);
        const updatedTasks = response[0].result;
        
        // Mettre à jour les tâches du Chef de Projet
        await updateAgentTasks(ROLES.PROJECT_MANAGER, projectId, updatedTasks);
        
        // Mettre à jour la mémoire du Chef de Projet
        await updateAgentMemory(ROLES.PROJECT_MANAGER, projectId, 
            `${projectManagerMemory}\n\nProposition de tâche du Product Owner:\n${taskProposal}\n\nRéponse du Chef de Projet:\n${response[0].result}`);
        
        return response[0].result;
    } catch (error) {
        console.error('Error proposing task to Project Manager:', error);
        throw new Error(`Failed to propose task: ${error.message}`);
    }
}

// Fonction pour créer un backup des fichiers
async function createBackup(projectId, developerRole) {
    try {
        const backupDir = path.join(__dirname, '../backups', projectId);
        await fs.mkdir(backupDir, { recursive: true });
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(backupDir, `${developerRole}_${timestamp}`);
        
        // Copier les fichiers du projet
        const projectDir = path.join(__dirname, '..');
        await fs.cp(projectDir, backupPath, { recursive: true });
        
        return backupPath;
    } catch (error) {
        console.error('Error creating backup:', error);
        throw new Error(`Failed to create backup: ${error.message}`);
    }
}

// Fonction pour restaurer un backup
async function restoreBackup(projectId, developerRole) {
    try {
        const backupDir = path.join(__dirname, '../backups', projectId);
        const backups = await fs.readdir(backupDir);
        
        // Trouver le dernier backup pour ce développeur
        const developerBackups = backups
            .filter(b => b.startsWith(developerRole))
            .sort()
            .reverse();
        
        if (developerBackups.length === 0) {
            throw new Error('No backup found for this developer');
        }
        
        const latestBackup = developerBackups[0];
        const backupPath = path.join(backupDir, latestBackup);
        const projectDir = path.join(__dirname, '..');
        
        // Restaurer les fichiers
        await fs.cp(backupPath, projectDir, { recursive: true });
        
        return latestBackup;
    } catch (error) {
        console.error('Error restoring backup:', error);
        throw new Error(`Failed to restore backup: ${error.message}`);
    }
}

// Fonction pour lire la liste des features
async function readFeatures() {
    try {
        const featuresPath = path.join(__dirname, '../features/features.md');
        return await fs.readFile(featuresPath, 'utf8');
    } catch (error) {
        console.error('Error reading features:', error);
        return '';
    }
}

// Fonction pour mettre à jour une feature
async function updateFeature(featureName, status, lastCheck) {
    try {
        const featuresPath = path.join(__dirname, '../features/features.md');
        let content = await fs.readFile(featuresPath, 'utf8');
        
        // Mettre à jour le statut et la date de vérification
        const featureRegex = new RegExp(`### \\[${featureName}\\]([\\s\\S]*?)(?=###|$)`, 'g');
        content = content.replace(featureRegex, (match) => {
            return match
                .replace(/- \*\*Statut\*\*: .*/, `- **Statut**: ${status}`)
                .replace(/- \*\*Dernière vérification\*\*: .*/, `- **Dernière vérification**: ${lastCheck}`);
        });
        
        await fs.writeFile(featuresPath, content, 'utf8');
    } catch (error) {
        console.error('Error updating feature:', error);
        throw new Error(`Failed to update feature: ${error.message}`);
    }
}

// Fonction pour gérer un signalement de bug avec compteur de tentatives
async function handleBugReport(projectId, bugReport, qaAttempts = 0) {
    try {
        const projectManagerPrompt = await getRolePrompt(ROLES.PROJECT_MANAGER);
        const projectManagerMemory = await readAgentMemory(ROLES.PROJECT_MANAGER, projectId);
        const projectManagerTasks = await readAgentTasks(ROLES.PROJECT_MANAGER, projectId);
        const features = await readFeatures();
        
        // Déterminer quel développeur doit corriger le bug
        const targetDeveloper = bugReport.toLowerCase().includes('frontend') ? 
            ROLES.FRONTEND_DEVELOPER : ROLES.BACKEND_DEVELOPER;
        
        // Si on a dépassé le nombre maximum de tentatives, restaurer le backup
        if (qaAttempts >= CONFIG.MAX_QA_ATTEMPTS) {
            const restoredBackup = await restoreBackup(projectId, targetDeveloper);
            const restorationMessage = `Le code est devenu inutilisable après ${qaAttempts} tentatives de correction. Restauration du backup ${restoredBackup}.`;
            
            await updateAgentMemory(ROLES.PROJECT_MANAGER, projectId, 
                `${projectManagerMemory}\n\n${restorationMessage}\n\nSignalement de bug du QA:\n${bugReport}`);
            
            // Mettre à jour le statut des features
            const currentDate = new Date().toISOString().split('T')[0];
            await updateFeature('Backup et Restauration', '✅ Fonctionnelle', currentDate);
            await updateFeature('Gestion des Bugs', '❌ Cassée', currentDate);
            
            return {
                projectManagerResponse: `Le code a été restauré à son état précédent suite à des problèmes persistants. ${restorationMessage}`,
                developerResponse: `Votre code a été restauré à son état précédent. Veuillez reprendre le développement à partir de ce point.`,
                restored: true
            };
        }
        
        const fullPrompt = `${projectManagerPrompt}\n\nContexte précédent:\n${projectManagerMemory}\n\nTâches actuelles:\n${projectManagerTasks}\n\nFeatures existantes:\n${features}\n\nSignalement de bug du QA (tentative ${qaAttempts + 1}/${CONFIG.MAX_QA_ATTEMPTS}):\n${bugReport}\n\nVeuillez créer une nouvelle tâche pour le ${targetDeveloper} afin de corriger ce bug.`;
        
        const response = await executeClaude(fullPrompt);
        const updatedTasks = response[0].result;
        
        // Mettre à jour les tâches du Chef de Projet
        await updateAgentTasks(ROLES.PROJECT_MANAGER, projectId, updatedTasks);
        
        // Mettre à jour la mémoire du Chef de Projet
        await updateAgentMemory(ROLES.PROJECT_MANAGER, projectId, 
            `${projectManagerMemory}\n\nSignalement de bug du QA:\n${bugReport}\n\nRéponse du Chef de Projet:\n${response[0].result}`);
        
        // Créer une tâche pour le développeur concerné
        const developerPrompt = await getRolePrompt(targetDeveloper);
        const developerMemory = await readAgentMemory(targetDeveloper, projectId);
        const developerTasks = await readAgentTasks(targetDeveloper, projectId);
        
        const developerFullPrompt = `${developerPrompt}\n\nContexte précédent:\n${developerMemory}\n\nTâches actuelles:\n${developerTasks}\n\nFeatures existantes:\n${features}\n\nNouvelle tâche de correction de bug (tentative ${qaAttempts + 1}/${CONFIG.MAX_QA_ATTEMPTS}):\n${bugReport}\n\nVeuillez mettre à jour votre liste de tâches avec cette nouvelle tâche de correction.`;
        
        const developerResponse = await executeClaude(developerFullPrompt);
        await updateAgentTasks(targetDeveloper, projectId, developerResponse[0].result);
        await updateAgentMemory(targetDeveloper, projectId, 
            `${developerMemory}\n\nNouvelle tâche de correction de bug:\n${bugReport}\n\nRéponse du développeur:\n${developerResponse[0].result}`);
        
        return {
            projectManagerResponse: response[0].result,
            developerResponse: developerResponse[0].result,
            qaAttempts: qaAttempts + 1
        };
    } catch (error) {
        console.error('Error handling bug report:', error);
        throw new Error(`Failed to handle bug report: ${error.message}`);
    }
}

// Fonction pour lancer la recette QA après une tâche de développeur
async function triggerQATesting(projectId, developerRole, taskCompletion) {
    try {
        const qaPrompt = await getRolePrompt(ROLES.QA);
        const qaMemory = await readAgentMemory(ROLES.QA, projectId);
        const qaTasks = await readAgentTasks(ROLES.QA, projectId);
        const features = await readFeatures();
        
        const fullPrompt = `${qaPrompt}\n\nContexte précédent:\n${qaMemory}\n\nTâches actuelles:\n${qaTasks}\n\nFeatures existantes:\n${features}\n\nNouvelle tâche de recette:\nLe ${developerRole} vient de terminer une tâche. Veuillez effectuer une recette complète qui inclut:\n1. Vérification de la nouvelle fonctionnalité\n2. Tests de régression sur toutes les features existantes\n\nVoici les détails de la tâche terminée:\n${taskCompletion}\n\nVeuillez tester le code et signaler tout bug trouvé en commençant votre message par "Bug détecté :". Si aucun bug n'est trouvé, signalez simplement que la recette est passée avec succès.`;
        
        const response = await executeClaude(fullPrompt);
        await updateAgentMemory(ROLES.QA, projectId, `${qaMemory}\n\nNouvelle tâche de recette pour le ${developerRole}:\n${taskCompletion}\n\nRéponse du QA:\n${response[0].result}`);
        
        // Si la recette est réussie, mettre à jour le statut des features
        if (!response[0].result.toLowerCase().includes('bug détecté')) {
            const currentDate = new Date().toISOString().split('T')[0];
            await updateFeature('Backup et Restauration', '✅ Fonctionnelle', currentDate);
            await updateFeature('Gestion des Bugs', '✅ Fonctionnelle', currentDate);
        }
        
        return response[0].result;
    } catch (error) {
        console.error('Error triggering QA testing:', error);
        throw new Error(`Failed to trigger QA testing: ${error.message}`);
    }
}

// Modifier l'endpoint de communication entre agents
app.post('/api/agent-communication', async (req, res) => {
    try {
        const { fromRole, toRole, projectId, message, workingDir } = req.body;
        
        if (!fromRole || !toRole || !projectId || !message || !workingDir) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        // Valider le dossier de travail
        await validateWorkingDir(workingDir);

        if (!Object.values(ROLES).includes(fromRole) || !Object.values(ROLES).includes(toRole)) {
            return res.status(400).json({ error: 'Invalid role specified' });
        }

        const agentMemory = await readAgentMemory(toRole, projectId);
        const agentPrompt = await getRolePrompt(toRole);
        const fullMessage = `Message de ${fromRole}:\n${message}\n\nContexte précédent:\n${agentMemory}`;
        
        await updateAgentMemory(toRole, projectId, fullMessage);
        const fullPrompt = `${agentPrompt}\n\n${fullMessage}`;
        
        const response = await executeClaude(fullPrompt);
        await updateAgentMemory(toRole, projectId, `${fullMessage}\n\nRéponse de ${toRole}:\n${response[0].result}`);
        
        // Si un développeur termine sa tâche, créer un backup avant la recette QA
        if ((fromRole === ROLES.FRONTEND_DEVELOPER || fromRole === ROLES.BACKEND_DEVELOPER) && 
            message.toLowerCase().includes('tâche terminée')) {
            const backupPath = await createBackup(projectId, fromRole);
            const qaResponse = await triggerQATesting(projectId, fromRole, response[0].result);
            
            // Si le QA détecte un bug, le traiter automatiquement
            if (qaResponse.toLowerCase().includes('bug détecté')) {
                const bugReportResponse = await handleBugReport(projectId, qaResponse);
                res.json({
                    response: response[0].result,
                    qaResponse: qaResponse,
                    projectManagerResponse: bugReportResponse.projectManagerResponse,
                    developerResponse: bugReportResponse.developerResponse,
                    backupCreated: backupPath,
                    restored: bugReportResponse.restored || false,
                    projectId: projectId
                });
            } else {
                // Si pas de bug, notifier le Chef de Projet
                const completionMessage = `Le QA a validé le code du ${fromRole}:\n${qaResponse}`;
                const projectManagerResponse = await restartProjectManager(projectId, completionMessage);
                
                res.json({
                    response: response[0].result,
                    qaResponse: qaResponse,
                    projectManagerResponse: projectManagerResponse,
                    backupCreated: backupPath,
                    projectId: projectId
                });
            }
        }
        // Si le QA signale un bug
        else if (fromRole === ROLES.QA && message.toLowerCase().includes('bug détecté')) {
            const bugReportResponse = await handleBugReport(projectId, response[0].result);
            res.json({ 
                response: response[0].result,
                projectManagerResponse: bugReportResponse.projectManagerResponse,
                developerResponse: bugReportResponse.developerResponse,
                restored: bugReportResponse.restored || false,
                projectId: projectId
            });
        }
        // Si le Product Owner propose une nouvelle tâche
        else if (fromRole === ROLES.PRODUCT_OWNER && message.toLowerCase().includes('nouvelle tâche')) {
            const projectManagerResponse = await proposeTaskToProjectManager(projectId, response[0].result);
            res.json({ 
                response: response[0].result,
                projectManagerResponse: projectManagerResponse,
                projectId: projectId
            });
        }
        // Si un autre agent termine sa tâche
        else if (toRole !== ROLES.PROJECT_MANAGER) {
            const completionMessage = `L'agent ${toRole} a terminé sa tâche et répond:\n${response[0].result}`;
            const projectManagerResponse = await restartProjectManager(projectId, completionMessage);
            
            res.json({ 
                response: response[0].result,
                projectManagerResponse: projectManagerResponse,
                projectId: projectId
            });
        } else {
            res.json({ 
                response: response[0].result,
                projectId: projectId
            });
        }
    } catch (error) {
        console.error('Error in /api/agent-communication:', error);
        res.status(500).json({ error: error.message });
    }
});

// Fonction pour arrêter tous les processus Claude
async function killAllClaudeProcesses() {
    try {
        // Sur Linux/Unix
        const { exec } = require('child_process');
        return new Promise((resolve, reject) => {
            exec('pkill -f claude', (error, stdout, stderr) => {
                if (error) {
                    // Si pkill retourne une erreur (aucun processus trouvé), ce n'est pas grave
                    if (error.code === 1) {
                        resolve('Aucun processus Claude en cours d\'exécution.');
                    } else {
                        reject(error);
                    }
                } else {
                    resolve('Processus Claude arrêtés avec succès.');
                }
            });
        });
    } catch (error) {
        throw new Error(`Erreur lors de l'arrêt des processus Claude: ${error.message}`);
    }
}

// Endpoint pour arrêter tous les processus Claude
app.post('/api/kill-claude', async (req, res) => {
    try {
        logger.info('Arrêt des processus Claude demandé');
        const result = await killAllClaudeProcesses();
        logger.info('Processus Claude arrêtés avec succès');
        res.json({ message: result });
    } catch (error) {
        logger.error('Erreur lors de l\'arrêt des processus', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// Endpoint pour obtenir le chemin absolu d'un dossier
app.post('/api/get-absolute-path', async (req, res) => {
    try {
        const { dirName } = req.body;
        logger.info('Demande de conversion de chemin', { dirName });

        // Obtenir le chemin absolu du dossier de travail actuel
        const currentDir = process.cwd();
        
        // Construire le chemin absolu en utilisant path.join pour gérer correctement les séparateurs
        const absolutePath = path.join(currentDir, dirName);
        
        // Normaliser le chemin pour gérer les points et les séparateurs
        const normalizedPath = path.normalize(absolutePath);
        
        logger.info('Chemin absolu généré', { 
            originalPath: dirName,
            absolutePath: normalizedPath
        });
        
        res.json({ absolutePath: normalizedPath });
    } catch (error) {
        logger.error('Erreur lors de la conversion du chemin', { 
            error: error.message,
            dirName: req.body.dirName
        });
        res.status(500).json({ error: error.message });
    }
});

// Middleware de gestion des erreurs
app.use(logger.errorHandler);

// Gestion des erreurs 404
app.use((req, res, next) => {
    logger.warn('Route non trouvée', { url: req.url, method: req.method });
    res.status(404).json({ error: 'Route non trouvée' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info(`Serveur démarré sur le port ${PORT}`);
}); 