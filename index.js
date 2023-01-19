const { exec } = require('child_process');
const fs = require('fs');
const cron = require('node-cron');
const winston = require('winston');
const { createLogger, format, transports } = winston;
const { combine, timestamp, label, printf } = format;
const myFormat = printf(({ level, message, timestamp }) => {
    return `${timestamp} ${level}: ${message}`;
});

const logger = createLogger({
    format: combine(
        timestamp(),
        myFormat
    ),
    transports: [new transports.Console()]
});

require('dotenv').config();

const sourceDbString = process.env.DATABASE_URL_SOURCE;
const targetDbString = process.env.DATABASE_URL_TARGET;
const backupFile = `${new Date().toISOString()}.sql`;

const retry = (fn, retriesLeft = 5, interval = 1000) => {
    while (retriesLeft) {
        try {
            fn();
            return;
        } catch (error) {
            logger.error(`Error: ${error}`);
            retriesLeft--;
            if (retriesLeft) {
                logger.warn(`Retrying in ${interval}ms: ${error}`);
                setTimeout(() => { }, interval);
            }
            if (retriesLeft === 0) {
                logger.error(`Retries exhausted, giving up: ${error}`);
                return;
            }
        }
    }
};

const createBackup = () => {
    logger.info(`Database ${sourceDbString} backup is being created at ${backupFile}`);
    exec(`pg_dump --dbname=${sourceDbString} --clean --if-exists -f ${backupFile}`, {maxBuffer: 1024 * 500000}, (error, stdout, stderr) => {
        if (error) {
            throw new Error(`Error creating backup: ${error}`);
        }
        logger.info(`Backup created at ${backupFile}`);
        restoreDb();
    });
};

const restoreDb = () => {
    logger.info(`Database ${targetDbString} is being restored with backup ${backupFile}`);
    exec(`psql --dbname=${targetDbString} --no-owner --no-acl -f ${backupFile}`, {maxBuffer: 1024 * 500000}, (error, stdout, stderr) => {
        if (error) {
            throw new Error(`Error restoring database: ${error}`);
        }
        logger.info(`Database ${targetDbString} restored`);
        removeBackup();
    });
};

const removeBackup = () => {
    logger.info(`Backup ${backupFile} is being deleted`);
    fs.unlink(backupFile, (err) => {
        if (err) {
            throw new Error(`Error deleting backup file: ${error}`);
        } else {
            logger.info(`Backup file ${backupFile} deleted`);
        }
    });
};

const run = () => {
    if (process.env.FAILOVER_RETRIES && process.env.FAILOVER_RETRY_DELAY_MS) {
        retry(createBackup, process.env.FAILOVER_RETRIES, process.env.FAILOVER_RETRY_DELAY_MS);
    } else {
        retry(createBackup);
    }
};

cron.schedule(process.env.SCHEDULE_TIME, () => {
    run();
}, {
    scheduled: true,
    timezone: process.env.SCHEDULE_TIMEZONE
});

if (process.env.RUN_ON_STARTUP === 'true') {
    run();
}

// Require the framework and instantiate it
const fastify = require('fastify')({ logger: true })

// Declare a route
fastify.get('/', async (request, reply) => {
  return { sync: 'ok' }
})

// Run the server!
const start = async () => {
  try {
    await fastify.listen({ port: process.env.PORT || 3000 , hostname: '0.0.0.0'})
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}
start()