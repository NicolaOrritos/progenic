
'use strict';

/**
 * @usage var progenic = require('progenic');
 *        progenic.run('myserver', 'lib/mycode.js', 4);
 **/


var utils = require('./utils');


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


            var log = logger || utils.DUMMY_LOGGER;


            var basePath;

            if (module.parent.filename)
            {
                var filenameIndex = module.parent.filename.lastIndexOf('/');
                basePath = module.parent.filename.slice(0, filenameIndex);
            }
            else
            {
                basePath = __dirname;
            }

            if (basePath)
            {
                process.chdir(basePath);
            }

            main = './' + main;


            process.env.NODE_ENV = devMode ? 'development' : 'production';


            // Number of CPUs when no number provided
            var workersCount = workers || require('os').cpus().length;


            /**
             * Restarts the workers.
             */
            process.on('SIGHUP', function()
            {
                utils.killAllWorkers('SIGTERM');
                utils.createWorkers(workersCount, name, main, devMode, log);
            });

            /**
             * Gracefully Shuts down the workers.
             */
            process.on('SIGTERM', function()
            {
                utils.killAllWorkers('SIGTERM');
            });


            log.info('Starting ' + name + ' daemon...');
            log.info('[from "%s"]', main);


            // Create a child for each CPU
            utils.createWorkers(workersCount, name, main, devMode, log);
        }
    }
};
