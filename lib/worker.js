'use strict';

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
require(process.argv[2]);
