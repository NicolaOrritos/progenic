
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
                const filePath = utils.buildLogFilePath(fileName, options.devMode);

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
                options.logger.info('Changing to folder "%s"...', basePath);

                process.chdir(basePath);
            }

            options.main = path.join(basePath, options.main);


            process.env.NODE_ENV = options.devMode ? 'development' : 'production';


            /**
             * Restarts the workers
             */
            process.on('SIGHUP', () =>
            {
                utils.killAllWorkers('SIGTERM');
                utils.createWorkers(options.workers, options.name, options.main, options.devMode, options.logger);
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
            utils.createWorkers(options.workers, options.name, options.main, options.devMode, options.logger);
        }
    }
};
