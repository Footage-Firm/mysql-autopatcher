'use strict';

var async = require('async');
var mysql = require('mysql');
var moment = require('moment');

//TODO: make this an EzMySql module itself

var EzMySql = function(options) {

    var mysqlOptions = {
        host     : options.host || '127.0.0.1',
        port     : options.port || 3306,
        user     : options.user,
        password : options.password,
        database : options.database,
        connectionLimit: options.connectionLimit || 1,
        timezone : moment().format('ZZ')
    };

    if (!mysqlOptions.user) {
        delete mysqlOptions.user;
    }
    if (!mysqlOptions.password) {
        delete mysqlOptions.password;
    }

    this.pool = mysql.createPool(mysqlOptions);

    this.profile(options.profile);
};

/**
 * Performs a multi row query, update, or delete. When querying, an array of the result rows is returned. When updating or deleting an object with modification stats is returned.
 * @param sql the sql to execute
 * @param callback function(err, queryResults)
 */
EzMySql.prototype.query = function(sql, callback) {

    var self = this;

    async.auto({
        getConnection: [function(next) {
            self.pool.getConnection(next);
        }],
        query: ['getConnection', function(next, results) {
            if (self.profile) {
                console.log('=============================');
                console.log(sql);
                console.log('=============================');
            }
            results.getConnection.query(sql, next);
        }]
    }, function(err, results) {
        var resultRows = results && results.query && results.query[0];
        var connection = results && results.getConnection;
        if (err) {
            console.error('SQL Error', {err: err, sql: sql});
        }
        if (connection) {
            connection.release();
        }
        callback(err, resultRows);
    });
};

/**
 * Queries for a single row. If more than one row is returned the rest are ignored.
 * @param sql the sql to execute
 * @param callback function(err, resultRow)
 */
EzMySql.prototype.queryOne = function(sql, callback) {

    var self = this;

    async.auto({
        query: [function(next) {
            self.query(sql, next);
        }]
    }, function(err, results) {
        var firstResult;
        var queryResult = results && results.query;
        if (queryResult instanceof Array) {
            firstResult = queryResult[0];
        } else {
            firstResult = queryResult;
        }

        if (typeof firstResult === 'undefined') {
            firstResult = null;
        }
        callback(err, firstResult);
    });
};

/**
 * Toggles profiling on/off; If profiling is on SQL statements will be output to console prior to execution
 * @param profile {boolean} whether or not to profile
 * @param [callback] {function} callback(err, wasProfiling)
 * @returns {boolean} whether or not profiling was active
 */
EzMySql.prototype.profile = function(profile, callback) {
    var wasProfiling = this.profile;
    this.profile = profile;
    if (callback) {
        callback(null, wasProfiling);
    }
    return wasProfiling;
};

/**
 * Formats and/or escapes a value for safe us with MySql
 * @param val {string|Date|number|boolean} value to format/escape
 * @returns {number|string} formatted/escaped value
 */
EzMySql.sqlVal = function(val) {
    if (typeof val === 'string') {
        val = mysql.escape(val);
    } else if (val instanceof Date) {
        val = '\''+val.getFullYear()+'-'+_pad(val.getMonth()+1,0,2)+'-'+_pad(val.getDate(),0,2)+' '+_pad(val.getHours(),0,2)+':'+_pad(val.getMinutes(),0,2)+':'+_pad(val.getSeconds(),0,2)+'\'';
    } else if (typeof val === 'undefined' || val === null) {
        val = 'NULL';
    }
    return val;
};

/**
 * Escapes multiple values for SQL and places them in a comma seperated list enclosed by parenthesises.
 * Null or undefined values will be converted to NULL. Numbers, dates, and strings handled appropriately.
 * @param vals {object..} values to format/escape for sql.
 * @returns {string} escaped sql values enclosed within parentheses
 */
EzMySql.sqlVals = function(vals) {
    var sqlValues = [];

    for (var i = 0; i < arguments.length; i += 1) {
        sqlValues.push(EzMySql.sqlVal(arguments[i]));
    }

    return '('+sqlValues.join(', ')+')';
};

/**
 * Escapes multiple values for SQL and places them in a comma seperated list enclosed by parenthesises with the VALUES keyword.
 * Null or undefined values will be converted to NULL. Numbers, dates, and strings handled appropriately.
 * @param values {object..} values to format/escape for sql.
 * @returns {string} escaped sql VALUES clause
 */
EzMySql.sqlValues = function(values) {
    return 'VALUES '+(EzMySql.sqlVals.apply(this, arguments));
};

// Also make available on the object
EzMySql.prototype.sqlVal = EzMySql.sqlVal;
EzMySql.prototype.sqlVals = EzMySql.sqlVals;
EzMySql.prototype.sqlValues = EzMySql.sqlValues;

/**
 * Closes the database connection
 */
EzMySql.prototype.close = function(callback) {
    this.pool.end(callback);
};

/**
 * Left pads a string with the given value up to the given length
 * @param str {string} string to pad
 * @param val {string|Number} string to pad
 * @param length length to pad to
 * @returns {string} padded string
 * @private
 */
function _pad(str, val, length) {
    var left = length >= 0;
    var padding = '';
    var needed = Math.ceil(Math.abs(length || 0) - (str && (''+str).length || 0), 0);

    while(needed-- > 0) {
        padding += ''+val;
    }

    str = left ? padding+str : str+padding;

    return str;
}

module.exports = EzMySql;