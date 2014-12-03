
/**
 * @usage var progenic = require('progenic');
 *        progenic.run('myserver', 'lib/mycode.js', 4);
 **/


var cluster = require('cluster');
var path    = require('path');
var fs      = require('fs');


function consoleWrapper()
{
    console.log.apply(console, arguments);
}

var DUMMY_LOGGER =
{
    trace: consoleWrapper,
    debug: consoleWrapper,
    info:  consoleWrapper,
    warn:  consoleWrapper,
    error: consoleWrapper,
    fatal: consoleWrapper
};


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

/**
 * Creates the children workers when running as cluster master.
 * Runs the HTTP server otherwise.
 *
 * @param  {Number} count Number of workers to create.
 */
function createWorkers(count, name, main, devMode, log)
{
    function workerExitRoutine(code, signal)
    {
        if (code !== 0 || (signal && signal !== 'SIGTERM'))
        {
            log.error('Worker "%s" died with code "%d" and signal "%s" :(', this.id, code, signal);
            log.info('Restarting it...');


            // Replace the dead worker, we're not sentimental
            var worker = cluster.fork();

            worker.on('exit', workerExitRoutine);
        }
        else
        {
            log.info('Worker "%s" gracefully shut down with code "%d" :)', this.id, code);
        }
    }
    
    if (cluster.isMaster)
    {
        // Write the PID file:
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

        cluster.setupMaster({ silent: true });

        while (count-- > 0)
        {
            log.info('Creating worker #%d...', count);
            
            var worker = cluster.fork();
            
            worker.on('exit', workerExitRoutine);
            
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
}

/**
 * Kills all workers with the given signal.
 * @param  {Number} signal
 */
function killAllWorkers(signal)
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


module.exports =
{
    run: function(name, main, workers, devMode, logger)
    {
        if (name && main)
        {
            if (devMode === false)
            {
                // Daemonization happens here
                require('daemon')();
            }
            
            
            var log = logger || DUMMY_LOGGER;
            

            main = path.resolve(path.join(process.cwd(), main));
            
            log.info('Starting ' + name + ' daemon...');
            log.info('[from "%s"]', main);


            // Load and apply some bare-bones config:
            var sjl = require('sjl');

            var defaults = {'ENVIRONMENT': 'development'};
            var CONF = sjl('/etc/' + name + '.conf', defaults);

            process.env.NODE_ENV = CONF.ENVIRONMENT;


            // Number of CPUs when no number provided
            var workersCount = workers || require('os').cpus().length;
            

            /**
             * Restarts the workers.
             */
            process.on('SIGHUP', function()
            {
                killAllWorkers('SIGTERM');
                createWorkers(workersCount, name, main, devMode, log);
            });

            /**
             * Gracefully Shuts down the workers.
             */
            process.on('SIGTERM', function()
            {
                killAllWorkers('SIGTERM');
            });


            // Create a child for each CPU
            createWorkers(workersCount, name, main, devMode, log);
        }
    }
};
