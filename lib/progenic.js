
'use strict';

/**
 * @usage let progenic = require('progenic');
 *        progenic.run('myserver', 'lib/mycode.js', 4);
 **/


const path  = require('path');
const utils = require('./utils');


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


            const log = logger || utils.DUMMY_LOGGER;


            // Write logs to file
            const fileName = name + '_' + 'master';
            const logFile  = utils.createLogFile(fileName, devMode);
            process.stdout.pipe(logFile);
            process.stderr.pipe(logFile);


            let basePath;

            if (module.parent.filename)
            {
                const filenameIndex = module.parent.filename.lastIndexOf('/');
                basePath = module.parent.filename.slice(0, filenameIndex);
            }
            else
            {
                basePath = __dirname;
            }

            if (basePath)
            {
                log.info('Changing to folder "%s"...', basePath);

                process.chdir(basePath);
            }

            main = path.join(basePath, main);


            process.env.NODE_ENV = devMode ? 'development' : 'production';


            // Number of CPUs when no number provided
            const workersCount = workers || require('os').cpus().length;


            /**
             * Restarts the workers
             */
            process.on('SIGHUP', () =>
            {
                utils.killAllWorkers('SIGTERM');
                utils.createWorkers(workersCount, name, main, devMode, log);
            });

            /**
             * Gracefully shuts down the workers
             */
            process.on('SIGTERM', () =>
            {
                utils.killAllWorkers('SIGTERM');

                process.exit(0);
            });


            // Create a child for each CPU
            utils.createWorkers(workersCount, name, main, devMode, log);
        }
    }
};
