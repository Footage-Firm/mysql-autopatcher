'use strict';

var fs = require('fs');
var path = require('path');

/**
 * Constructor
 * @param patchCommandLineArguments patchCommandLineArguments
 *
 * Can have the following "public" properties:
 *      + host
 *      + port
 *      + user
 *      + password
 *      + database
 *      + useSocketIfUnix
 *      + patchDirs
 *
 */
var autopatcherConfiguration = function(patchCommandLineArguments) {
    this._configFile = patchCommandLineArguments.getConfigFile();
    this._profile = patchCommandLineArguments.getProfile();

    this._ensureConfigurationFileExists();

    this._configurationProfiles = this._getConfigurationProfilesFromConfigFile();
    this._ensureConfigurationProfilesValid();

    this._loadConfigurationSettings();
};

autopatcherConfiguration.prototype = {

    host : '127.0.0.1',
    port : '3306',
    user : 'user',
    password : 'password',
    database : 'database',
    useSocketIfUnix : true,
    patchDirs : [],
    configDir : '',

    _ensureConfigurationFileExists: function()  {
        if (!fs.existsSync(this._configFile)) {
            var err = new Error('Missing config.json file');
            err.code = 1;
            throw err;
        }
    },

    _getConfigurationProfilesFromConfigFile: function() {
        var configuration = JSON.parse(fs.readFileSync(this._configFile));
        return configuration.profiles || {};
    },

    _ensureConfigurationProfilesValid: function() {
        var profileNotPresentInConfiguration = !this._configurationProfiles[this._profile];

        if (profileNotPresentInConfiguration) {
            var validConfigurationProfilesAsString = Object.keys(this._configurationProfiles || {}).join(', ');
            var errMsg = 'Invalid profile ' + this._profile + '. Specify one of the following available profiles: ' + validConfigurationProfilesAsString;
            var err = new Error(errMsg);
            err.code = 2;
            throw err;
        }
    },

    /**
     * Configures the "public" properties enumerated above
     * @private
     */
    _loadConfigurationSettings: function() {

        var defaultConfiguration = this._configurationProfiles && this._configurationProfiles.default || {};
        var specificConfiguration = this._configurationProfiles && this._configurationProfiles[this._profile] || {};

        var autopatcherConfiguration = defaultConfiguration; // Initially gets set to default. Specific parameters merged in below

        // Configure {this} with all the settings in the default configuration
        Object.keys(defaultConfiguration).forEach(function(key){
             this[key] = defaultConfiguration[key];
        }.bind(this));

        // override autopatcherConfiguration parameters with specificConfiguration parameters (if supplied)
        Object.keys(specificConfiguration).forEach(function(key) {
            this[key] = specificConfiguration[key];
        }.bind(this));

        // include directory of configuration file for resolving paths
        this.configDir = path.dirname(this._configFile);
    }
};

module.exports = autopatcherConfiguration;