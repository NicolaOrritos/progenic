
'use strict';

var fs   = require('fs');
var path = require('path');


function consoleWrapper()
{
    console.log.apply(console, arguments);
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

    createLogFileForWorker: function(basePath, serviceName, workerID)
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
};
