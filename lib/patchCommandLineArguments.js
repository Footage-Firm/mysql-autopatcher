"use strict";

var path = require('path');

/**
 * @class
 *
 * Processes command line arguments for patch.js (or autopatcher) and makes the following parameters accessible:
 *      + profile (specifies which group of settings within the configuration file to use)
 *      + _configFile (full path to the autopatcher configuration file)
 *
 * 1) node patch.js {configFile}
 * 2) node patch.js {profile} {configFile}
 *
 * Some specific examples of each might be
 *
 * 1) autopatcher ../StockBlocks/Database/AudioBlocks/audioBlocksAutopatcherConfig.json
 * 2) autopatcher testing ../StockBlocks/Database/AudioBlocks/audioBlocksAutopatcherConfig.json
 *
 * Therefore we're expecting
 *      + the third (index 2) argument to be either profile or config file
 *      + the fourth (index 3) argument to be config file or not populated
 *
 */
var patchCommandLineArguments = function(commandLineArguments) {

    this._profile = commandLineArguments[2];
    this._configFile = commandLineArguments[3];

    var profileIsActuallyTheConfigFile = this._profile && this._profile.match(/\.(json|config)$/i);
    if (profileIsActuallyTheConfigFile) {
        this._configFile = this._profile;
        this._profile = null;
    }

    var defaultProfile = 'default';
    this._profile = this._profile || defaultProfile;

    var defaultConfigFile = path.resolve(__dirname,'config.json');
    this._configFile = this._configFile || defaultConfigFile;
};

patchCommandLineArguments.prototype = {
    getProfile : function() {
        return this._profile;
    },

    getConfigFile : function() {
        return this._configFile;
    }
};

module.exports = patchCommandLineArguments;