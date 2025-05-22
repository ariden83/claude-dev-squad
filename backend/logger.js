const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Créer le dossier logs s'il n'existe pas
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// Configuration des formats de log
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// Configuration des transports (où les logs seront écrits)
const transports = [
    // Écrire tous les logs dans combined.log
    new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
        level: 'info',
        maxsize: 5242880, // 5MB
        maxFiles: 5,
    }),
    // Écrire les erreurs dans error.log
    new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5,
    }),
    // Afficher les logs dans la console en mode développement
    new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        ),
    }),
];

// Créer le logger
const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: logFormat,
    transports,
    // Ne pas quitter en cas d'erreur
    exitOnError: false,
});

// Ajouter des méthodes utilitaires
logger.stream = {
    write: (message) => {
        logger.info(message.trim());
    },
};

// Fonction pour logger les requêtes HTTP
logger.http = (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info({
            method: req.method,
            url: req.url,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip,
            userAgent: req.get('user-agent'),
        });
    });
    next();
};

// Fonction pour logger les erreurs
logger.errorHandler = (err, req, res, next) => {
    logger.error({
        error: err.message,
        stack: err.stack,
        method: req.method,
        url: req.url,
        body: req.body,
        query: req.query,
        params: req.params,
    });
    next(err);
};

module.exports = logger; 