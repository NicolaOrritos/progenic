# Progenic

Multi-workers daemon module


## Getting Started

Install the module with: `npm install progenic`  
Then use it to start a service with as many workers as needed:

```js
var progenic = require('progenic');
var numberOfWorkers = 4;
var devMode         = false;
progenic.run('myServiceName', 'path/to/myServiceScript.js', numberOfWorkers, devMode);
```


## Documentation

```js
progenic.run(serviceName, pathToService, [numberOfWorkers, [devMode]]);
```

The progenic module starts a given service as a daemon, by spawning N children that will act as workers.

The `serviceName` parameter is the name the service will be started with.
It affects the process' PID file name (under _/var/run_) as well as the log files names under _/var/log_.
I.e. a service named "funnyService" with 2 workers will have PID file _/var/run/funnyService.pid_ and log files _/var/log/funnyService_0.log_ and _/var/log/funnyService_1.log_.

The `pathToService` parameter points to the JS file that is actually the service code.
This service code will be spawned exactly `numberOfWorkers` times in different workers, children of the service containing the progenic-related code.

The **optional** `numberOfWorkers` parameter tells progenic how many workers ave to be spawn.
When omitted progenic will spawn exactly `require('os').cpus().length` workers.

The **optional** `devMode` parameter tells progenic whether to start in development mode.

When `devMode = true` the following happens:
- The main process doesn't daemonize
- The PID file is written to the same folder the server is started from
- Log files are written to the process' working directory as well
- `process.env.NODE_ENV` is set to `'development'` (instead of `'production'`)


## Contributing

In lieu of a formal styleguide, take care to maintain the existing coding style. Add unit tests for any new or changed functionality. Lint and test your code using [Grunt](http://gruntjs.com).


## License

Copyright (c) 2014 Nicola Orritos  
Licensed under the MIT license.
