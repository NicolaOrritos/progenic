
'use strict';

/**
 * @usage const progenic = require('progenic');
 *        progenic.run({
 *            name:    'myserver',
 *            main:    'lib/mycode.js',
 *            workers: 4,
 *            devMode: false});
 **/


const fs    = require('fs');
const path  = require('path');
const utils = require('./utils');


module.exports =
{
    run: function(options)
    {
        options = utils.normalizeOptions(options);

        if (options.name && options.main)
        {
            if (options.devMode === false)
            {
                // Write master logs to file
                const fileName = options.name + '_' + 'master';
                const filePath = utils.buildLogFilePath(fileName, options.devMode, options.logsBasePath);

                const logFile = fs.openSync(filePath, 'a');

                // Daemonization happens here
                require('daemon')({
                    stdout: logFile,
                    stderr: logFile
                });
            }


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
                options.logger.info('[PROGENIC] Changing to folder "%s"...', basePath);

                process.chdir(basePath);
            }

            options.main = path.join(basePath, options.main);


            process.env.NODE_ENV = options.devMode ? 'development' : 'production';


            /**
             * Restarts the workers
             */
            process.on('SIGHUP', () =>
            {
                utils.killAllWorkers('SIGTERM')
                .then( () =>
                {
                    // Wait a bit before restarting all of them:
                    setTimeout( () =>
                    {
                        options.logger.info('[PROGENIC] Now restarting all workers...');

                        utils.createWorkers(options.workers, options.name, options.main, options.devMode, options.logger);

                    }, 1000);
                })
                .catch( (err) =>
                {
                    options.logger.fatal('[PROGENIC] Could not kill old workers! %s', err);

                    process.exit(1);
                });
            });

            /**
             * Gracefully shuts down the workers
             */
            process.on('SIGTERM', () =>
            {
                utils.killAllWorkers('SIGTERM')
                .then( () =>
                {
                    options.logger.info('[PROGENIC] Gracefully shut down all workers. Now exiting...');

                    process.exit(0);
                })
                .catch( (err) =>
                {
                    options.logger.fatal('[PROGENIC] Could not kill workers! %s', err);

                    process.exit(1);
                });
            });


            // Create a child for each CPU
            utils.createWorkers(options.workers, options.name, options.main, options.devMode, options.logger)
            .then( () =>
            {
                options.logger.info('[PROGENIC] All workers have been started');
            })
            .catch( err =>
            {
                options.logger.error('[PROGENIC] Could not start workers. %s', err);
            });
        }
    }
};
