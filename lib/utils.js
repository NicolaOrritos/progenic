
'use strict';

const fs      = require('fs');
const path    = require('path');
const cluster = require('cluster');


const MAX_RESPAWNS      = 300;
const RESPAWN_WAIT_TIME = 1000;  // One second


let respawns = 0;


const helpers =
{
    buildLogFilePath: function(fileName, devMode, basePath)
    {
        if (fileName)
        {
            basePath = basePath || ((devMode === true) ? './' : '/var/log');

            const filePath = path.resolve(path.join(basePath, fileName + '.log'));

            return filePath;
        }
        else
        {
            throw new Error('Missing parameters');
        }
    },

    createLogFile: function(fileName, devMode, logsBasePath)
    {
        if (fileName)
        {
            const filePath = helpers.buildLogFilePath(fileName, devMode, logsBasePath);

            const stream = fs.createWriteStream(filePath, {flags: 'a', encoding: 'utf8'});

            /* Only log errors, because they can be caused by the process trying to log
             * atfer the stream has already been closed and the whole process is being brougth down;
             * Re-throwing them may cause the master process to crash with an unhandled exception,
             * typically a "write after end" one. */
            stream.on('error', err => console.log('Error on write stream "%s". %s', filePath, err) );

            return stream;
        }
        else
        {
            throw new Error('Missing parameters');
        }
    },

    writePidFile: function(name, devMode, log)
    {
        if (devMode === false)
        {
            const pid     = process.pid.toString();
            const pidPath = '/var/run/' + name + '.pid';

            fs.writeFile(pidPath, pid, err =>
            {
                if (err)
                {
                    log.fatal('[PROGENIC] Could not write PID file. Cause: %s', err);
                }
            });
        }
        else
        {
            // Do not write PID in dev-mode
        }
    },

    /**
     * Relays messages received from the workers up to the calling process.
     *
     * @param  {Object} msg The message to be relayed.
     */
    relayMessage: function(msg)
    {
        // When child process.send is undefined
        if (cluster.isMaster && process.send)
        {
            process.send(msg);
        }
    },

    restartIfDead: function(worker, options)
    {
        let retries       = 10;
        let retryInterval = 1;  // Seconds...

        function waitForDeath()
        {
            options.logger.info('[PROGENIC] Waiting the death of worker #%s...', worker.id);

            if (worker.isDead())
            {
                if (options && options.restart && options.name)
                {
                    options.logger.info('[PROGENIC] Trying to start a new one in its stead...');

                    /* Wait before restarting it,
                     * to avoid hogging the system
                     * with too much respawns: */
                    setTimeout( () => helpers.forkWorker(options.name, options.devMode, options.logger, options.logsBasePath, options.checkPingsEnabled) , RESPAWN_WAIT_TIME);
                }
                else
                {
                    options.logger.error('[PROGENIC] Could not restart worker #%s: missing information to do so', worker.id);
                }
            }
            else if (retries)
            {
                // Retry
                options.logger.warn('[PROGENIC] After %s seconds worker #%s is still alive. Waiting %s more second(s)...', retryInterval, worker.id, retryInterval);

                retries--;

                const timeout = setTimeout( () =>
                {
                    // Resend termination message to be sure:
                    worker.kill('SIGTERM');

                    waitForDeath();

                }, retryInterval * 1000);

                timeout.unref();
            }
            else
            {
                options.logger.fatal('[PROGENIC] Could not kill worker #%s! Bringing the whole process down!', worker.id);

                process.exit(1);
            }
        }

        options.logger.error('[PROGENIC] Worker #%s failed to respond to a check ping', worker.id);

        if (!worker.isDead())
        {
            options.logger.info('[PROGENIC] Killing it and waiting %s seconds for it to be dead for good...', retryInterval);

            worker.kill('SIGTERM');

            const timeout = setTimeout(waitForDeath, retryInterval * 1000);

            timeout.unref();
        }
        else
        {
            options.logger.info('[PROGENIC] ... because it is dead...');
        }
    },

    check: function(worker, name, devMode, log)
    {
        log = log || module.exports.CONSOLE_LOGGER;

        if (worker && worker.id && worker.send && !worker.isDead())
        {
            const checkInterval = 30; // Seconds...

            const interval = setInterval( () =>
            {
                if (worker && !worker.isDead())
                {
                    const waitTime = 10;    // Seconds...
                    let   answered = false;

                    const timeout = setTimeout( () =>
                    {
                        if (!answered)
                        {
                            helpers.restartIfDead(worker,
                            {
                                restart: true,
                                name: name,
                                devMode: devMode,
                                checkPingsEnabled: true,
                                logger: log
                            });
                        }
                        else
                        {
                            log.info('[PROGENIC] Worker "%s" is alive and kicking...', worker.id);
                        }

                    }, waitTime * 1000);

                    timeout.unref();

                    worker.once('message', message => answered = (message && message.type === 'check' && message.status === 'ok') );

                    worker.send({type: 'check'});
                }
                else
                {
                    clearInterval(interval);
                }

            }, checkInterval * 1000);

            interval.unref();
        }
        else
        {
            throw new Error('Could not create check procedure: malformed worker');
        }
    },

    forkWorker: function(name, devMode, log, logsBasePath, checkPingsEnabled)
    {
        return new Promise( (resolve, reject) =>
        {
            if (name && log)
            {
                if (respawns < MAX_RESPAWNS)
                {
                    const worker = cluster.fork();

                    respawns++;

                    const workerExitRoutine = function(code, signal)
                    {
                        return new Promise( (resolve, reject) =>
                        {
                            if (code === 0 || signal === 'SIGTERM')
                            {
                                log.info('[PROGENIC] Worker "%s" gracefully shut down with code "%d" :)', worker.id, code);
                                log.info('[PROGENIC] No worker will be started in its stead');
                            }
                            else
                            {
                                log.error('[PROGENIC] Worker "%s" died with code "%d" and signal "%s" :(', worker.id, code, signal);
                                log.info('[PROGENIC] Starting a new one in its stead...');

                                /* Wait before restarting it,
                                 * to avoid hogging the system
                                 * with too much respawns: */
                                setTimeout( () =>
                                {
                                    helpers.forkWorker(name, devMode, log, logsBasePath, checkPingsEnabled)
                                    .then(resolve)
                                    .catch(reject);

                                }, RESPAWN_WAIT_TIME);
                            }
                        });
                    };

                    // Write logs to file
                    const fileName = name + '_' + worker.id;
                    const logFile  = helpers.createLogFile(fileName, devMode, logsBasePath);
                    worker.process.stdout.pipe(logFile);
                    worker.process.stderr.pipe(logFile);

                    worker.on('message', helpers.relayMessage);

                    worker.on('listening', () =>
                    {
                        log.info('[PROGENIC] Enabling check pings for worker #%s...', worker.id);

                        if (checkPingsEnabled)
                        {
                            helpers.check(worker, name, devMode, log);
                        }

                        resolve(worker.id);
                    });

                    worker.on('exit', (code, signal) =>
                    {
                        workerExitRoutine(code, signal)
                        .then( id =>
                        {
                            log.info('[PROGENIC] The new worker has been succesfully started with ID "%s"', id);
                        })
                        .catch( err => log.error('[PROGENIC] %s', err) );
                    });
                }
                else
                {
                    reject(new Error('The maximum number of respawns has been exceeded. Refusing to fork...'));
                }
            }
            else
            {
                reject(new Error('Missig parameters "name" and/or "log"'));
            }
        });
    }
};

function expandLoggingFn(fn, options)
{
    let result;

    if (fn && fn.apply && options)
    {
        if (options.disableRichLogger)
        {
            result = fn;
        }
        else
        {
            const thisArg = options.logger;

            result = function()
            {
                const args = Array.prototype.slice.call(arguments);

                if (args && args[0])
                {
                    args[0] = '[' + (new Date()) + '] ' + args[0];
                }

                fn.apply(thisArg, args);
            };
        }
    }

    return result;
}


module.exports =
{
    CONSOLE_LOGGER:
    {
        trace: console.trace,
        debug: console.log,
        info:  console.info,
        warn:  console.warn,
        error: console.error,
        fatal: console.error
    },

    normalizeOptions: function(options)
    {
        // Options are: name, main, workers, devMode, logger
        const result = {};

        if (options)
        {
            result.name = options.name;
            result.main = options.main;

            // Number of CPUs when no number provided
            result.workers = options.workers || 'auto';

            if (isNaN(result.workers) && result.workers !== 'auto')
            {
                result.workers = 'auto';
            }

            // When "auto", try to spawn NUM_CPUs - 1 workers:
            if (result.workers === 'auto')
            {
                result.workers = Math.max(1, (require("os").cpus().length - 1));
            }

            result.devMode = options.devMode || false;
            result.logger  = options.logger  || module.exports.CONSOLE_LOGGER;

            result.logsBasePath      = options.logsBasePath || (result.devMode ? './' : '/var/log');
            result.checkPingsEnabled = options.checkPingsEnabled || true;

            result.disableRichLogger = options.disableRichLogger || false;
        }

        return result;
    },

    enrichLogger: function(options)
    {
        if (options.logger === undefined || options.logger === null)
        {
            options.logger = {};
        }

        options.logger.trace = expandLoggingFn(options.logger.trace || module.exports.CONSOLE_LOGGER.trace, options);
        options.logger.debug = expandLoggingFn(options.logger.debug || module.exports.CONSOLE_LOGGER.debug, options);
        options.logger.info  = expandLoggingFn(options.logger.info  || module.exports.CONSOLE_LOGGER.info,  options);
        options.logger.warn  = expandLoggingFn(options.logger.warn  || module.exports.CONSOLE_LOGGER.warn,  options);
        options.logger.error = expandLoggingFn(options.logger.error || module.exports.CONSOLE_LOGGER.error, options);
        options.logger.fatal = expandLoggingFn(options.logger.fatal || module.exports.CONSOLE_LOGGER.fatal, options);
    },

    buildLogFilePath: helpers.buildLogFilePath,

    createLogFile: helpers.createLogFile,

    /**
     * Creates the children workers when running as cluster master.
     * Runs the HTTP server otherwise.
     *
     * @param  {Number} count Number of workers to create.
     */
    createWorkers: function(options)
    {
        return new Promise( (resolve, reject) =>
        {
            if (options)
            {
                options.logger.info('[PROGENIC] Starting "%s" daemon with %s workers...', options.name, options.workers);
                options.logger.info('[PROGENIC] [from "%s"]', options.main);

                // Write the PID file:
                helpers.writePidFile(options.name, options.devMode, options.logger);

                cluster.setupMaster(
                {
                    exec: path.join(__dirname, 'worker.js'),
                    args: [options.main, process.env.INSTANCE_NAME],
                    silent: true
                });

                const promises = [];

                let count = options.workers;

                while (count-- > 0)
                {
                    options.logger.info('[PROGENIC] Creating  worker #%s...', (options.workers - count));

                    promises.push(helpers.forkWorker(options.name, options.devMode, options.logger, options.logsBasePath, options.checkPingsEnabled));
                }

                Promise.all(promises)
                .then(resolve)
                .catch(reject);
            }
            else
            {
                reject(new Error('Missing options'));
            }
        });
    },

    /**
     * Kills all workers with the given signal.
     * @param  {Number} signal
     */
    killAllWorkers: function(signal)
    {
        return new Promise( resolve =>
        {
            for (let uniqueID in cluster.workers)
            {
                if (cluster.workers.hasOwnProperty(uniqueID))
                {
                    const worker = cluster.workers[uniqueID];

                    worker.kill(signal);
                }
            }

            resolve();
        });
    }
};
