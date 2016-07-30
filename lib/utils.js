
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

    createLogFile: function(fileName, devMode)
    {
        if (fileName)
        {
            const filePath = helpers.buildLogFilePath(fileName, devMode);

            const stream = fs.createWriteStream(filePath, {flags: 'a', encoding: 'utf8'});

            stream.on('error', err =>
            {
                console.log('Error opening write stream "%s". %s', filePath, err);

                throw err;
            });

            return stream;
        }
        else
        {
            throw new Error('Missing parameters');
        }
    },

    writePidFile: function(name, devMode, log)
    {
        const pid     = process.pid.toString();
        let pidPath = name + '.pid';

        if (devMode === false)
        {
            pidPath = '/var/run/' + pidPath;
        }

        fs.writeFile(pidPath, pid, err =>
        {
            if (err)
            {
                log.fatal('[PROGENIC] Could not write PID file. Cause: %s', err);
            }
        });
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

    restartIfDead: function(worker, options, log)
    {
        let retries       = 10;
        let retryInterval = 1;  // Seconds...

        function waitForDeath()
        {
            if (worker.isDead())
            {
                if (options && options.restart && options.name)
                {
                    log.info('[PROGENIC] Trying to start a new one in its stead...');

                    /* Wait before restarting it,
                     * to avoid hogging the system
                     * with too much respawns: */
                    setTimeout( () => helpers.forkWorker(options.name, options.devMode, log, options.checkPingsEnabled) , RESPAWN_WAIT_TIME);
                }
                else
                {
                    log.error('[PROGENIC] Could not restart worker #%s: missing information to do so', worker.id);
                }
            }
            else if (retries)
            {
                // Retry
                log.warn('[PROGENIC] After %s seconds worker #%s is still alive. Waiting %s more second(s)...', retryInterval, worker.id, retryInterval);

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
                log.fatal('[PROGENIC] Could not kill worker #%s! Bringing the whole process down!', worker.id);

                process.exit(1);
            }
        }

        log.error('[PROGENIC] Worker #%s failed to respond to a check ping', worker.id);

        if (!worker.isDead())
        {
            log.info('[PROGENIC] Killing it and waiting for it to be dead for good...');

            worker.kill('SIGTERM');

            const timeout = setTimeout(waitForDeath, retryInterval * 1000);

            timeout.unref();
        }
        else
        {
            log.info('[PROGENIC] ... because it is dead...');
        }
    },

    check: function(worker, name, devMode, log)
    {
        log = log || module.exports.DUMMY_LOGGER;

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
                            helpers.restartIfDead(worker, {restart: true, name: name, devMode: devMode, checkPingsEnabled: true}, log);
                        }
                        else
                        {
                            log.info('[PROGENIC] Worker "%s" is alive and kicking...', worker.id);
                        }

                    }, waitTime * 1000);

                    timeout.unref();

                    worker.once('message', message =>
                    {
                        if (message && message.type === 'check' && message.status === 'ok')
                        {
                            answered = true;
                        }
                    });

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

    forkWorker: function(name, devMode, log, checkPingsEnabled)
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
                                    helpers.forkWorker(name, devMode, log, checkPingsEnabled)
                                    .then(resolve)
                                    .catch(reject);

                                }, RESPAWN_WAIT_TIME);
                            }
                        });
                    };

                    // Write logs to file
                    const fileName = name + '_' + worker.id;
                    const logFile  = helpers.createLogFile(fileName, devMode);
                    worker.process.stdout.pipe(logFile);
                    worker.process.stderr.pipe(logFile);

                    worker.on('message', helpers.relayMessage);

                    worker.on('listening', () =>
                    {
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

function expandLoggingFn(fn)
{
    let result;

    if (fn && fn.apply)
    {
        result = function()
        {
            const args = Array.prototype.slice.call(arguments);

            if (args && args[0])
            {
                args[0] = '[' + (new Date()) + '] ' + args[0];
            }

            fn.apply(null, args);
        };
    }

    return result;
}


module.exports =
{
    DUMMY_LOGGER:
    {
        trace: console.log,
        debug: console.log,
        info:  console.log,
        warn:  console.log,
        error: console.log,
        fatal: console.log
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
            result.logger  = options.logger  || module.exports.DUMMY_LOGGER;
        }

        return result;
    },

    enrichLogger: function(logger)
    {
        if (logger)
        {
            logger.trace = expandLoggingFn(logger.trace || module.exports.DUMMY_LOGGER.trace);
            logger.debug = expandLoggingFn(logger.debug || module.exports.DUMMY_LOGGER.debug);
            logger.info  = expandLoggingFn(logger.info  || module.exports.DUMMY_LOGGER.info);
            logger.warn  = expandLoggingFn(logger.warn  || module.exports.DUMMY_LOGGER.warn);
            logger.error = expandLoggingFn(logger.error || module.exports.DUMMY_LOGGER.error);
            logger.fatal = expandLoggingFn(logger.fatal || module.exports.DUMMY_LOGGER.fatal);
        }

        return logger;
    },

    buildLogFilePath: helpers.buildLogFilePath,

    createLogFile: helpers.createLogFile,

    /**
     * Creates the children workers when running as cluster master.
     * Runs the HTTP server otherwise.
     *
     * @param  {Number} count Number of workers to create.
     */
    createWorkers: function(count, name, main, devMode, log, checkPingsEnabled)
    {
        return new Promise( (resolve, reject) =>
        {
            if (cluster.isMaster)
            {
                log.info('[PROGENIC] Starting "%s" daemon with %s workers...', name, count);
                log.info('[PROGENIC] [from "%s"]', main);

                // Write the PID file:
                helpers.writePidFile(name, devMode, log);

                cluster.setupMaster({ silent: true });

                const promises = [];

                while (count-- > 0)
                {
                    log.info('[PROGENIC] Creating worker #%d...', (count + 1));

                    promises.push(helpers.forkWorker(name, devMode, log, checkPingsEnabled));
                }

                Promise.all(promises)
                .then(resolve)
                .catch(reject);
            }
            else
            {
                // Setup periodic check message listener
                process.on('message', message =>
                {
                    if (message && message.type === 'check')
                    {
                        process.send({type: 'check', status: 'ok'});
                    }
                });

                // Drop privileges if we are running as root
                if (process.getgid() === 0)
                {
                    process.setuid("nobody");

                    try
                    {
                        // RedHat-like:
                        process.setgid("nobody");
                    }
                    catch (err)
                    {
                        try
                        {
                            // Debian-like:
                            process.setgid("nogroup");
                        }
                        catch (err)
                        {
                            // I-don't-know-what-it's-like:
                        }
                    }
                }

                // Run the service actual code when started as a worker
                require(main);

                resolve();
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
