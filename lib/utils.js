
'use strict';

const fs      = require('fs');
const path    = require('path');
const cluster = require('cluster');


const helpers =
{
    buildLogFilePath: function(fileName, devMode)
    {
        if (fileName)
        {
            const basePath = (devMode === true) ? './' : '/var/log';

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
                log.fatal('Could not write PID file. Cause: %s', err);
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
        let retries = 3;

        function waitForDeath()
        {
            if (worker.isDead())
            {
                if (options && options.restart && options.name && options.devMode)
                {
                    log.info('Trying to restart it...');

                    helpers.forkWorker(options.name, options.devMode, log);
                }
                else
                {
                    log.error('Could not restart worker: missing information to do so');
                }
            }
            else if (retries)
            {
                // Retry
                log.warn('After 1 second it\'s still alive. Waiting one more second...');

                retries--;

                const timeout = setTimeout(waitForDeath, 1 * 1000);

                timeout.unref();
            }
            else
            {
                log.fatal('Could not kill worker! Briging the whole process down!');

                process.exit(1);
            }
        }

        log.error('Worker "%s" failed to respond to a check ping', worker.id);

        worker.kill('SIGKILL');

        const timeout = setTimeout(waitForDeath, 1 * 1000);

        timeout.unref();
    },

    check: function(worker, name, devMode, log)
    {
        log = log || module.exports.DUMMY_LOGGER;

        if (worker && worker.id && worker.send && !worker.isDead())
        {
            const interval = setInterval( () =>
            {
                let answered = false;

                const timeout = setTimeout( () =>
                {
                    if (!answered)
                    {
                        helpers.restartIfDead(worker, {restart: true, name: name, devMode: devMode}, log);
                    }
                    else
                    {
                        log.info('Worker "%s" is alive and kicking...', worker.id);
                    }

                }, 10);

                timeout.unref();

                worker.once('message', message =>
                {
                    if (message && message.type === 'check' && message.status === 'ok')
                    {
                        answered = true;
                    }
                });

                worker.send({type: 'check'});

            }, 30 * 1000);

            interval.unref();
        }
        else
        {
            throw new Error('Could not create check procedure: malformed worker');
        }
    },

    forkWorker: function(name, devMode, log)
    {
        const worker = cluster.fork();

        function workerExitRoutine(code, signal)
        {
            if (code === 0 || signal === 'SIGTERM')
            {
                log.info('Worker "%s" gracefully shut down with code "%d" :)', worker.id, code);
            }
            else
            {
                log.error('Worker "%s" died with code "%d" and signal "%s" :(', worker.id, code, signal);
                log.info('Restarting it...');

                helpers.forkWorker(name, devMode, log);
            }
        }

        // Write logs to file
        const fileName = name + '_' + worker.id;
        const logFile  = helpers.createLogFile(fileName, devMode);
        worker.process.stdout.pipe(logFile);
        worker.process.stderr.pipe(logFile);

        worker.on('exit',    workerExitRoutine);
        worker.on('message', helpers.relayMessage);

        helpers.check(worker, name, devMode, log);
    }
};


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

    buildLogFilePath: helpers.buildLogFilePath,
    
    createLogFile: helpers.createLogFile,

    /**
     * Creates the children workers when running as cluster master.
     * Runs the HTTP server otherwise.
     *
     * @param  {Number} count Number of workers to create.
     */
    createWorkers: function(count, name, main, devMode, log)
    {
        if (cluster.isMaster)
        {
            log.info('Starting "%s" daemon with %s workers...', name, count);
            log.info('[from "%s"]', main);

            // Write the PID file:
            helpers.writePidFile(name, devMode, log);

            cluster.setupMaster({ silent: true });

            while (count-- > 0)
            {
                log.info('Creating worker #%d...', count);

                helpers.forkWorker(name, devMode, log);
            }
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
                process.setgid("nobody");
                process.setuid("nobody");
            }

            // Run the service actual code when started as a worker
            require(main);
        }
    },

    /**
     * Kills all workers with the given signal.
     * @param  {Number} signal
     */
    killAllWorkers: function(signal)
    {
        for (let uniqueID in cluster.workers)
        {
            if (cluster.workers.hasOwnProperty(uniqueID))
            {
                const worker = cluster.workers[uniqueID];

                worker.kill(signal);
            }
        }
    }
};
