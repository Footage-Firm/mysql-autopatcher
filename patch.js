'use strict';

var fs = require('fs');
var path = require('path');

var patchCommandLineArguments = require('./lib/patchCommandLineArguments');
var Autopatcher = require('./lib/autoPatcher');
var AutopatcherConfiguration = require('./lib/autopatcherConfiguration');

/**
 * Reads in configuration and calls the autopatcher
 */
function exec() {

    var commandLineArguments = new patchCommandLineArguments(process.argv);

    try {
        var autopatcherConfiguration = new AutopatcherConfiguration(commandLineArguments);
    }
    catch (err) {
        console.log(err.message);
        process.exit(err.code);
    }

    var autopatcher = new Autopatcher(autopatcherConfiguration);
    autopatcher.patch();
}

exec();
