
/**
 * @usage var progenic = require('progenic');
 *        progenic.run('myserver', 'lib/mycode.js', 4);
 **/


var cluster = require('cluster');
var path    = require('path');
var fs      = require('fs');


function workerExitRoutine(code, signal)
{
    if (code !== 0 || (signal && signal !== 'SIGTERM'))
    {
        console.log('Worker "%s" died with code "%d" and signal "%s" :(', this.id, code, signal);
        console.log('Restarting it...');


        // Replace the dead worker, we're not sentimental
        var worker = cluster.fork();

        worker.on('exit', workerExitRoutine);
    }
    else
    {
        console.log('Worker "%s" gracefully shut down with code "%d" :)', this.id, code);
    }
}

/**
 * Creates the children workers when running as cluster master.
 * Runs the HTTP server otherwise.
 *
 * @param  {Number} count Number of workers to create.
 */
function createWorkers(count, name, main)
{
    if (cluster.isMaster)
    {
        // Write the PID file:
        var pid = process.pid.toString();

        fs.writeFile('/var/run/' + name + '.pid', pid, function(err)
        {
            if (err)
            {
                console.log('Could not write PID file. Cause: %s', err);
            }
        });


        while (count-- > 0)
        {
            console.log('Creating worker #%d...', count);

            cluster.fork().on('exit', workerExitRoutine);
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
    run: function(name, main, workers)
    {
        if (name && main)
        {
            // Daemonization happens here
            require('daemon')();
            

            main = path.resolve(path.join(process.cwd(), main));
            
            console.log('Starting ' + name + ' daemon...');
            console.log('[from "%s"]', main);


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
                createWorkers(workersCount, name, main);
            });

            /**
             * Gracefully Shuts down the workers.
             */
            process.on('SIGTERM', function()
            {
                killAllWorkers('SIGTERM');
            });


            // Create a child for each CPU
            createWorkers(workersCount, name, main);
        }
    }
};
