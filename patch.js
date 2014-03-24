'use strict';

var fs = require('fs');
var path = require('path');

var autopatcher = require('./lib/autoPatcher');

/**
 * Reads in configuration and calls the autopatcher
 */
function exec() {

    var profile = process.argv[2];
    var configFile = process.argv[3];

    // If no config file but profile ends with .json or .config, user is only specifying a config file but no profile
    if (profile.match(/\.(json|config)$/i)) {
        configFile = profile;
        profile = null;
    }

    profile = profile || 'default';
    configFile = configFile || path.resolve(__dirname,'config.json');


    // Read in entire configuration

    if (!fs.existsSync(configFile)) {
        console.error('Missing config.json file');
        process.exit(1);
    }

    var universalConfig = JSON.parse(fs.readFileSync(configFile));

    // Load the config for the given profile

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
