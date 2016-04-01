# Progenic

Multi-workers daemon module with advanced options.

## Table of Contents

- [Table of Contents](#table-of-contents)
- [Getting Started](#getting-started)
- [Documentation](#documentation)
	- [Options documentation](#options-documentation)
	- [Log files](#log-files)
	- [PID file](#pid-file)
- [License](#license)

## Getting Started

Install the module with: `npm install progenic`  
Then use it to start a service with as many workers as needed:

```js
const progenic = require('progenic');

progenic.run({
    name: 'myServiceName',
    main: 'path/to/myServiceScript.js',
    workers: 4,
    devMode: false,
    logsBasePath: '/mnt/logs-volume'
});
```

## Documentation

```js
// Import progenic module
const progenic = require('progenic');

// Define an options object
const options = {
    name: '',         // MANDATORY
    main: '',         // MANDATORY
    workers: 'auto',  // OPTIONAL, defaults to 'auto'
    devMode: false,   // OPTIONAL, defaults to 'false'
    logsBasePath: ''  // OPTIONAL, defaults to '/var/log'
};

// Use the method 'run()' to start the service with the given options
progenic.run(options);
```

The progenic module starts a given service as a daemon, by spawning a configurable number of children that will act as workers.
The father process is the one balancing the work among them.

### Options documentation

The **mandatory** `name` parameter is the name the service will be started with.
It affects the process' PID file name (under _/var/run_) as well as the log files names.

The **mandatory** `main` parameter points to the JS file that is actually the service code.  
This code will be spawned exactly `workers`-times in different processes children of the service containing the progenic code.

The **optional** `workers` parameter tells progenic how many workers ave to be spawn.
When omitted progenic will assume the value `'auto'`, spawning exactly `require('os').cpus().length - 1` workers (i.e. the number of CPUs of the system minus 1).

The **optional** `devMode` parameter tells progenic whether to start in development mode or in production one.  
When `devMode = true` the following happens:
- The main process doesn't daemonize
- The PID file is written to the same folder the server is started from
- Log files are written to the process' working directory as well
- `process.env.NODE_ENV` is set to `'development'` (instead of `'production'`)

### Log files

By default your service will have log files created under _/var/log_, simply by running progenic like this:
```js
progenic.run({
    name: 'myServiceName',
    main: 'path/to/myServiceScript.js',
    workers: 1
});
// => $ ls -lah /var/log/myServiceName*
//      -rw-r--r--   1 root    root             262 30 mar 02.26 myServiceName_1.log
//      -rw-r--r--   1 root    root             381 30 mar 02.26 myServiceName_master.log
```
We got two files created: one for the worker and one for the master process.
First one will get the actual logs of your service while the latter logs startup info and all the actions
that progenic takes in order to ensure that your service stays up,
as well as the results of a periodic check on the workers to verify whether they are alive and running.

Each child worker gets its own log file.

The path where log files are created can be customized by passing in the _logsBasePath_ option, like this:
```js
progenic.run({
    name: 'myServiceName',
    main: 'path/to/myServiceScript.js',
    workers: 2,
    logsBasePath: '/mnt/logs-volume'
});
// => $ ls -lah /mnt/logs-volume/myServiceName*
//      -rw-r--r--   1 root    root             122 30 mar 02.41 myServiceName_1.log
//      -rw-r--r--   1 root    root             122 30 mar 02.41 myServiceName_2.log
//      -rw-r--r--   1 root    root             240 30 mar 02.41 myServiceName_master.log
```

### PID file
Finally progenic will write one PID file for your process, under _/var/run_:
```Bash
$ cat /var/run/myServiceName.pid
  4320
```
The PID file will **not** be deleted when your service exits.

## License

Copyright (c) 2016 Nicola Orritos  
Licensed under the MIT license.
