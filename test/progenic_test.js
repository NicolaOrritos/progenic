
'use strict';

/* global describe, it */

const assert   = require('assert');
const progenic = require('../lib/progenic.js');

describe('progenic node module.', () =>
{
    it('must be not null', () =>
    {
        assert(progenic);
    });
});
