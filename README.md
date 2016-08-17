# Progenic

Multi-workers daemon module with advanced options.


## Table of Contents

- [Table of Contents](#table-of-contents)
- [Getting Started](#getting-started)
- [Documentation](#documentation)
	- [Main options documentation](#main-options-documentation)
	- [Log files](#log-files)
	- [PID file](#pid-file)
	- [Check-pings](#check-pings)
	- [Rich-logging](#rich-logging)
- [License](#license)


## Getting Started

Install the module with: `npm install progenic`  
Then use it in your code to start a service with as many workers as needed:

```js
const progenic = require('progenic');

progenic.run({
    name: 'myServiceName',
    main: 'path/to/myServiceScript.js',
    workers: 4,
    devMode: false,
    logsBasePath: '/mnt/logs-volume',
    checkPingsEnabled: true,
	disableRichLogger: false
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

### Main options documentation

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


### Check-pings

When spawning workers progenic periodically checks whether they are still alive (and active) or not.
This is done by pinging each one of them and waiting for an answer to come within 30 seconds.  
If it fails to answer in time the worker gets killed and respawned.  
This feature is enabled by default and can be disabled by passing the option `checkPingsEnabled` set to `false`:
```js
progenic.run({
    name: 'myServiceName',
    main: 'path/to/myServiceScript.js',
    // [...]
    checkPingsEnabled: false
});
```


### Rich-logging

_Progenic_ usually adds a timestamp to each line logged by the master, like this:
```Bash
$ tailf /var/log/myServiceName_master.log
[Wed Aug 17 2016 09:05:45 GMT+0000 (UTC)] [PROGENIC] Worker "1" is alive and kicking...
[Wed Aug 17 2016 09:05:46 GMT+0000 (UTC)] [PROGENIC] Worker "2" is alive and kicking...
[Wed Aug 17 2016 09:05:47 GMT+0000 (UTC)] [PROGENIC] Worker "3" is alive and kicking...
[Wed Aug 17 2016 09:05:48 GMT+0000 (UTC)] [PROGENIC] Worker "4" is alive and kicking...
```

There are times when this may not be the desired behavior, like when some logging libraries used by your code already provide a timestamp.
Thus logging may become a bit too redundant (here using the [bunyan](https://github.com/trentm/node-bunyan) logging library):
```Bash
$ tailf /var/log/hephaestus.APTE_master.log | bunyan
[2016-08-17T09:05:45.500Z]  INFO: hephaestus/30956 on vp-pre1.xorovo.it: [Wed Aug 17 2016 09:05:45 GMT+0000 (UTC)] [PROGENIC] Worker "1" is alive and kicking...
```

At times like this the `disableRichLogger` option should be used, which provides a clean logger without additional information added to it:
```js
progenic.run({
    name: 'myServiceName',
    main: 'path/to/myServiceScript.js',
    // [...]
    disableRichLogger: true
});
```


## License

Copyright (c) 2016 Nicola Orritos  
Licensed under the MIT license.
