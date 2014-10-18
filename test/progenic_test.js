/* global describe, it */

'use strict';

var assert   = require('assert');
var progenic = require('../lib/progenic.js');

describe('progenic node module.', function()
{
    it('must be not null', function()
    {
        assert(progenic);
    });
});
