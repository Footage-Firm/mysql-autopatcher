'use strict';

var fs = require('fs');
var path = require('path');

var autopatcher = require('./lib/autoPatcher');

/**
 * Reads in configuration and calls the autopatcher
 */
function exec() {

    var profile = process.argv[2] || 'default';
    var configFile = process.argv[3] || path.resolve(__dirname,'config.json');

    if (!fs.existsSync(configFile)) {
        console.error('Missing config.json file');
        process.exit(1);
    }

    var universalConfig = JSON.parse(fs.readFileSync(configFile));

    if (!universalConfig.profiles[profile]) {
        console.err('Invalid profile '+profile+'. Specify one of the following available profiles: '+Object.keys(universalConfig.profiles || {}).join(', '));
        process.exit(2);
    }

    var config = universalConfig.profiles && universalConfig.profiles.default || {};
    var profileConfig = universalConfig.profiles && universalConfig.profiles[profile] || {};

    // override defaults with anything profile specific
    Object.keys(profileConfig).forEach(function(key) {
        config[key] = profileConfig[key];
    });

    // include directory of configuration file for resolving paths
    config.configDir = path.dirname(configFile);

    autopatcher.patch(config);
}

exec();
