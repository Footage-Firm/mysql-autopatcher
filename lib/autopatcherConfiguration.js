'use strict';

var fs = require('fs');
var path = require('path');

/**
 * Constructor
 * @param patchCommandLineArguments patchCommandLineArguments
 */
var autopatcherConfiguration = function(patchCommandLineArguments) {
    this._configFile = patchCommandLineArguments.getConfigFile();
    this._profile = patchCommandLineArguments.getProfile();

    this._ensureConfigurationFileExists();

    this._configurationProfiles = this._getConfigurationProfilesFromConfigFile();
    this._ensureConfigurationProfilesValid();

    this._loadConfigurationSettings();
    this._ensureConfigurationSettingsValid();
};

autopatcherConfiguration.prototype = {

    /**
     * @returns
     * {
     *      host: string,
     *      port: string,
     *      user: string,
     *      password: string,
     *      database: string,
     *      useSocketIfUnix: boolean,
     *      patchDirs: Array,
     *      numberOfPatchLevels: number,
     *      configDir: string
     *  }
     */
    getConfigOptions: function() {
        return this._configOptions;
    },

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
            throw new Error('Invalid profile ' + this._profile + '. Specify one of the following available profiles: ' + validConfigurationProfilesAsString);
        }
    },

    /**
     * Configures the "public" properties enumerated above
     * @private
     */
    _loadConfigurationSettings: function() {

        // Default settings for configuration
        this._configOptions = this._getDefaultConfigOptions();

        var defaultProfile = this._configurationProfiles && this._configurationProfiles.default || {};
        var specificProfile = this._configurationProfiles && this._configurationProfiles[this._profile] || {};

        // Configure _configOptions with all the settings in the default profile
        Object.keys(defaultProfile).forEach(function(key){
             this._configOptions[key] = defaultProfile[key];
        }.bind(this));

        // override _configOptions parameters with specificProfile parameters (if supplied)
        Object.keys(specificProfile).forEach(function(key) {
            this._configOptions[key] = specificProfile[key];
        }.bind(this));

        // include directory of configuration file for resolving paths
        this._configOptions.configDir = path.dirname(this._configFile);
    },

    _getDefaultConfigOptions: function() {
        return {

            host: '127.0.0.1',
            port: '3306',
            user: 'user',
            password: 'password',
            database: 'database',
            useSocketIfUnix: true,
            patchDirs: [],
            numberOfPatchLevels: 2, // Default is 2 so we don't accidentally insert seed data (level 3) on production

            // Computed.  Shouldn't be included in the actual config file
            configDir: ''
        };
    },

    _ensureConfigurationSettingsValid: function() {
        var errMsg = null;
        var err = null;

        var noPatchDirectoriesProvided = this._configOptions.patchDirs.length === 0;
        if (noPatchDirectoriesProvided) {
            throw new Error('Must supply at least one directory in patchDirs array');
        }

        var numberOfPatchLevelsInvalid = this._configOptions.numberOfPatchLevels !== parseInt(this._configOptions.numberOfPatchLevels)
                                        || this._configOptions.numberOfPatchLevels < 1
        if (numberOfPatchLevelsInvalid) {
            throw new Error('numberOfPatchLevels must be an integer >= 1');
        }
    }
};

module.exports = autopatcherConfiguration;