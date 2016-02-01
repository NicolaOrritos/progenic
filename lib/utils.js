
'use strict';

var fs      = require('fs');
var path    = require('path');
var cluster = require('cluster');


function consoleWrapper()
{
    console.log.apply(console, arguments);
}

function createLogFileForWorker(basePath, serviceName, workerID)
{
    var result;

    if (basePath && serviceName && (workerID || workerID === 0))
    {
        var filePath = path.resolve(path.join(basePath, serviceName + '_' + workerID + '.log'));

        result = fs.createWriteStream(filePath, {flags: 'a', encoding: 'utf8'});
    }
    else
    {
        throw new Error('Missing parameters');
    }

    return result;
}

function writePidFile(name, devMode, log)
{
    var pid     = process.pid.toString();
    var pidPath = name + '.pid';

    if (devMode === false)
    {
        pidPath = '/var/run/' + pidPath;
    }

    fs.writeFile(pidPath, pid, function(err)
    {
        if (err)
        {
            log.fatal('Could not write PID file. Cause: %s', err);
        }
    });
}

/**
 * Relays messages received from the workers up to the calling process.
 *
 * @param  {Object} msg The message to be relayed.
 */
function relayMessage(msg)
{
    // When child process.send is undefined
    if (cluster.isMaster && process.send)
    {
        process.send(msg);
    }
}


module.exports =
{
    DUMMY_LOGGER:
    {
        trace: consoleWrapper,
        debug: consoleWrapper,
        info:  consoleWrapper,
        warn:  consoleWrapper,
        error: consoleWrapper,
        fatal: consoleWrapper
    },

    /**
     * Creates the children workers when running as cluster master.
     * Runs the HTTP server otherwise.
     *
     * @param  {Number} count Number of workers to create.
     */
    createWorkers: function(count, name, main, devMode, log)
    {
        function workerExitRoutine(code, signal)
        {
            if (code !== 0 || (signal && signal !== 'SIGTERM'))
            {
                log.error('Worker "%s" died with code "%d" and signal "%s" :(', cluster.worker.id, code, signal);
                log.info('Restarting it...');


                // Replace the dead worker, we're not sentimental
                var worker = cluster.fork();

                worker.on('exit',    workerExitRoutine);
                worker.on('message', relayMessage);
            }
            else
            {
                log.info('Worker "%s" gracefully shut down with code "%d" :)', cluster.worker.id, code);
            }
        }

        if (cluster.isMaster)
        {
            // Write the PID file:
            writePidFile(name, devMode, log);

            cluster.setupMaster({ silent: true });

            while (count-- > 0)
            {
                log.info('Creating worker #%d...', count);

                var worker = cluster.fork();

                worker.on('exit',    workerExitRoutine);
                worker.on('message', relayMessage);

                // Write logs to file
                var logPath = (devMode === false) ? '/var/log': './';
                worker.process.stdout.pipe(createLogFileForWorker(logPath, name, worker.id));
            }
        }
        else
        {
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
        var uniqueID;
        var worker;

        for (uniqueID in cluster.workers)
        {
            if (cluster.workers.hasOwnProperty(uniqueID))
            {
                worker = cluster.workers[uniqueID];

                worker.kill(signal);
            }
        }
    }
};
