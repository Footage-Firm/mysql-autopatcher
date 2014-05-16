'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');

var async = require('async');

var EzMySql = require('./ezMySql');

// Patch file name convention patch_MAJOR_MINOR__patch-description
var PATCH_LEVEL_REGEX = /^patch\D+(\d+)(\D+(\d+))?\D/i;

var DEFAULT_MYSQL_SOCKET = '/tmp/mysql.sock';
var DEFAULT_MAMP_SOCKET = '/Applications/MAMP/tmp/mysql/mysql.sock';

/**
 * Executes autopatcher using a given config and profile
 */
function patch(config) {

    var db;

    var mysqlOptions = {
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database
    };

    // Ability to use sockets instead of TCP protocol for communicating with MySQL
    if (config.useSocketIfUnix && !os.platform().match(/^win(32|64)/)) {
        // see if a mamp socket exists
        if (!config.socketPath) {
            if (fs.existsSync(DEFAULT_MAMP_SOCKET)) {
                //use crazy mamp socket
                config.socketPath = DEFAULT_MAMP_SOCKET;
            } else {
                config.socketPath = DEFAULT_MYSQL_SOCKET;
            }
        }

        delete mysqlOptions.host;
        delete mysqlOptions.port;

        mysqlOptions.socketPath = config.socketPath;
    }

    db = new EzMySql(mysqlOptions);

    console.log('Starting autopatcher');

    async.auto({
        ensureInfrastructure: [function(next) {

            var sql = 'CREATE TABLE IF NOT EXISTS database_patches ( \n'
                + '    major int unsigned NOT NULL, \n'
                + '    minor int unsigned NOT NULL, \n'
                + '    file varchar(255) NOT NULL, \n'
                + '    date_applied timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, \n'
                + '    CONSTRAINT pk_database_patches PRIMARY KEY (major, minor) \n'
                + ')';

            db.query(sql, next);
        }],
        currentPatchLevel: ['ensureInfrastructure', function(next) {
            _extractPatchLevel(db, next);
        }],
        executePatches: ['currentPatchLevel', function(next, results) {

            var startingMajor = results.currentPatchLevel.major;
            var startingMinor = results.currentPatchLevel.minor;
            var patches = [];
            var numApplied = 0;

            console.log('Current patch level is '+results.currentPatchLevel.str);

            // Read all patches from all patch directories, parsing the file name into major and minor versions
            (config.patchDirs || []).forEach(function(patchDir) {
                var patchPath = path.resolve(config.configDir, patchDir);

                console.log('Examining '+patchPath);
                fs.readdirSync(patchPath).forEach(function(patchFile) {
                    var match = patchFile.match(PATCH_LEVEL_REGEX);
                    var major;
                    var minor;
                    if (match) {
                        major = parseInt(match[1], 10);
                        minor = match[3] && parseInt(match[3], 10) || 0;
                        // Any patch with a higher major version or equal major version but higher minor version should be applied
                        if (major > startingMajor || (major === startingMajor && minor > startingMinor)) {
                            patches.push({
                                filePath: path.join(patchPath, patchFile),
                                major: major,
                                minor: minor
                            });
                        } else {
                            numApplied += 1;
                        }
                    } else {
                        // Ignore files in the patch directory that don't fit our pattern
                        console.warn('Ignoring file', patchFile);
                    }
                });
            });

            // Sort patches in order of major and minor versions ascending
            patches.sort(function(a, b) {
                var result = a.major - b.major;
                if (result === 0) {
                    result = a.minor - b.minor;
                }
                return result;
            });

            console.log(numApplied+' patch'+(numApplied !== 1 ? 'es have' : 'has')+' been applied');
            console.log(patches.length+' new patch'+(patches.length !== 1 ? 'es' : '')+' will be applied');

            // Apply patches that are new
            async.eachSeries(patches, function(patch, eachNext) {
                console.log('applying', path.basename(patch.filePath));
                _applyPatch(db, patch.filePath, patch.major, patch.minor, eachNext);
            }, function(err) {
                next(err);
            });
        }]
    }, function(err) {
        _extractPatchLevel(db, function(levelErr, patchLevel) {
           if (patchLevel) {
               console.log('Patch level is now '+patchLevel.str);
               db.close();
               if (err) {
                   console.log('Autopatcher encountered errors');
                   process.exit(1);
               } else {
                   console.log('Autopatcher executed successfully');
                   process.exit(0);
               }
           }
        });
    });
}

function _extractPatchLevel(db, callback) {

    async.auto({
        query: [function(next) {
            var sql = 'SELECT major, max(minor) AS minor \n'
                + 'FROM database_patches \n'
                + 'WHERE major = (SELECT max(major) FROM database_patches)';

            db.queryOne(sql, next);
        }],
        format: ['query', function(next, results) {
            var major = results.query && results.query.major;
            var minor = results.query && results.query.minor;

            if (major === null) {
                major = -1;
                minor = -1;
            }

            next(null, {major: major, minor: minor, str: major >= 0 ? major+'.'+minor : '(none)'});

        }]
    }, function(err, results) {
        callback(err, results && results.format);
    });
}

/**
 * Applies one patch
 * @param db {EzMySql} database to use
 * @param filePath {string} full path to the patch file
 * @param major {string} major version of the patch
 * @param minor {number} minor version of the patch
 * @param callback {function} callback(err, success)
 * @private
 */
function _applyPatch(db, filePath, major, minor, callback) {

    async.auto({
        executeSql: [function(next) {

            var filename = path.basename(filePath);

            // read in patch's SQL
            var allSql = fs.readFileSync(filePath, 'utf8');

            // strip out comments and leading and trailing whitespace
            var commands = _extractSqlCommands(allSql);

            async.eachSeries(commands, function(command, eachNext) {

                command = command.trim();

                // execute the command
                db.query(command, function(err) {
                    if (err) {
                        console.error('Error encountered processing '+filename);
                        console.error(err);
                        console.error('Error SQL:');
                        console.error(command);
                    }
                    eachNext(err);
                });

            }, function(err) {
                next(err);
            });
        }],
        updateLevel: ['executeSql', function(next) {

            //
            var filename = path.basename(filePath);

            var sql = 'INSERT INTO database_patches (major, minor, file) \n'
                    + db.sqlValues(major, minor, filename);

            db.query(sql, next);
        }]
    }, function(err, results) {
        callback(err, results && results.updateLevel && results.updateLevel.affectedRows === 1);
    });

}

/**
 * Cleans up SQL by removing comments and trimming excess whitespace and returns array of individual commands
 * @param sql {string} the SQL to clean up and extract commands from
 * @returns {string[]} array of cleaned up SQL commands
 * @private
 */
function _extractSqlCommands(sql) {

    var i;
    var inStringChar = false;
    var inCommentChar = false;
    var prevChar = '';
    var nextChar = '';
    var currChar;
    var includeCurrChar = false;
    var endCommand = false;

    var commands = [];

    var currCommand = '';

    for (i = 0; i < sql.length; i += 1) {
        currChar = sql[i];
        nextChar = sql[i+1];
        includeCurrChar = true;
        endCommand = false;

        if (inStringChar) {
            // in a string, sql counts
            // lets see if string ended
            if (currChar === inStringChar && prevChar !== '\\') {
                inStringChar = false;
            }
        } else if (inCommentChar) {
            // in a comment, sql ignored
            includeCurrChar = false;
            // lets see if comment ended
            if ((inCommentChar === '#' || inCommentChar === '-') && currChar === '\n') {
                // single line comment, ended by newline
                inCommentChar = false;
            } else if (inCommentChar === '/' && currChar === '/' && prevChar === '*') {
                // multi line comment ended by closing astericks and slash
                inCommentChar = false;
            }
        } else {
            // not in comment or string, see if one is beginning or if command is ending
            if (currChar === '\'' || currChar === '"' || currChar === '`') {
                // starting a string
                inStringChar = currChar;
            } else if (currChar === '#' || currChar === '/' && nextChar === '*' || currChar === '-' && nextChar === '-') {
                // starting a comment
                inCommentChar = currChar;
                // we don't want to include comment start
                includeCurrChar = false;
            } else if (currChar === ';' || i === sql.length-1) {
                endCommand = true;
                includeCurrChar = false;
            }
        }

        if (includeCurrChar) {
            currCommand += currChar;
        }

        if (endCommand) {
            currCommand = currCommand.trim();
            if (currCommand) {
                commands.push(currCommand);
            }
            currCommand = '';
        }

        prevChar = currChar;
    }

    return commands;
}

module.exports = {
    patch: patch
};
