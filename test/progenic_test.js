
'use strict';

/* global describe, it */


const assert   = require('assert');
const spawn    = require('child_process').spawn;
const progenic = require('../lib/progenic.js');


describe('progenic node module', () =>
{
    it('must be not null', () =>
    {
        assert(progenic);
    });

    it('must start (with one worker) a simple runnable that terminates after a few milliseconds', function(done)
    {
        spawn('test/run', ['runnable.js']);

        setTimeout( () =>
        {
            done();

        }, 250);
    });

    it('must start (with one worker) a simple runnable that hangs in an infinite loop after 70 seconds', function(done)
    {
        this.timeout(90 * 1000);

        spawn('test/run', ['runnable_stucking.js']);

        setTimeout( () =>
        {
            done();

        }, 80 * 1000);
    });
});
