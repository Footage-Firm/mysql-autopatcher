'use strict';

var fs = require('fs');
var os = require('os');

var DEFAULT_MYSQL_SOCKET = '/tmp/mysql.sock';
var DEFAULT_MAMP_SOCKET = '/Applications/MAMP/tmp/mysql/mysql.sock';

var ezMySqlOptions = function(config) {

    this.config = config;

    this.host = config.host;
    this.port = config.port;
    this.user = config.user;
    this.password = config.password;
    this.database = config.database;

    this._addSocketOptionsIfNecessary();
};

ezMySqlOptions.prototype = {

    /**
     * Modifies options to connect over local sockets instead of TCP if config specifies a local connection
     */
    _addSocketOptionsIfNecessary: function() {
        var useSocketsOnValidSocketPlatform = this.config.useSocketIfUnix && !os.platform().match(/^win(32|64)/); // sockets not valid on Windows
        if (useSocketsOnValidSocketPlatform) {
            this._addSocketOptions();
        }
    },

    _addSocketOptions: function () {
        var socketPathNotProvided = !this.config.socketPath;
        if (socketPathNotProvided) {
            this._addDefaulSocketPathToConfigIfNecessary();
        }
        this._removeTcpOptions();
        this.socketPath = this.config.socketPath;
    },

    _addDefaulSocketPathToConfigIfNecessary: function () {
        var doesDefaultMampSocketExist = fs.existsSync(DEFAULT_MAMP_SOCKET);
        if (doesDefaultMampSocketExist) {
            this.config.socketPath = DEFAULT_MAMP_SOCKET;
        }
        else {
            this.config.socketPath = DEFAULT_MYSQL_SOCKET;
        }
    },

    _removeTcpOptions: function (mysqlOptions) {
        delete this.host;
        delete this.port;
    }
};

module.exports = ezMySqlOptions;