'use strict';

var fs = require('fs');
var path = require('path');

var async = require('async');

var EzMySqlOptions = require('./ezMySqlOptions');
var EzMySql = require('./ezMySql');

/**
 * Autopatcher constructor
 *
 * EXPORTED
 *
 * @param autopatcherConfiguration - should be of type autopatcherConfiguration
 */
var autopatcher = function(autopatcherConfiguration) {
    this.config = autopatcherConfiguration;
    this.db = this._getDbConnection();

    this.patchLevelRegex = /^patch\D+(\d+)(\D+(\d+))?\D/i;
};

autopatcher.prototype = {
    patch: function() {
        console.log('Starting autopatcher');

        async.auto({
            ensureDbTrackingTableExists: [this._ensureDbTrackingTableExists.bind(this)],
            getCurrentPatchLevel: ['ensureDbTrackingTableExists', this._getCurrentPatchLevel.bind(this)],
            executeNewPatches: ['getCurrentPatchLevel', this._executeNewPatches.bind(this)]
        }, this._handleErrorsPrintFeedbackAndExit.bind(this));
    },

    _getDbConnection: function() {
        var mysqlOptions = new EzMySqlOptions(this.config);
        var db = new EzMySql(mysqlOptions);
        return db;
    },

    /**
     * Used in async.auto call
     */
    _ensureDbTrackingTableExists: function(next) {
        var sql = 'CREATE TABLE IF NOT EXISTS database_patches ( \n'
            + '    major int unsigned NOT NULL, \n'
            + '    minor int unsigned NOT NULL, \n'
            + '    file varchar(255) NOT NULL, \n'
            + '    date_applied timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, \n'
            + '    CONSTRAINT pk_database_patches PRIMARY KEY (major, minor) \n'
            + ')';

        this.db.query(sql, next);
    },

    /**
     * Used in async.auto call
     */
    _getCurrentPatchLevel: function(callback) {

        var db = this.db;

        async.auto({
            queryForPatchLevel: [function(next) {
                var sql = 'SELECT major, max(minor) AS minor \n'
                    + 'FROM database_patches \n'
                    + 'WHERE major = (SELECT max(major) FROM database_patches)';

                db.queryOne(sql, next);
            }],
            extractPatchLevelFromQueryResults: ['queryForPatchLevel', function(next, results) {
                var major = results.queryForPatchLevel && results.queryForPatchLevel.major;
                var minor = results.queryForPatchLevel && results.queryForPatchLevel.minor;

                if (major === null) {
                    major = -1;
                    minor = -1;
                }

                var results = {
                    major: major,
                    minor: minor,
                    str: major >= 0 ? major+'.'+minor : '(none)'
                };
                next(null, results);

            }]
        }, function(err, results) {
            var patchLevelObject = results && results.extractPatchLevelFromQueryResults;
            callback(err, patchLevelObject);
        });
    },

    /**
     * Used in async.auto call
     */
    _executeNewPatches: function(callback, results) {
        var currentPatchLevelObject = results.getCurrentPatchLevel;
        var patchesToExecute = this._getPatchesToExecute(currentPatchLevelObject);

        async.eachSeries(patchesToExecute, this._applyPatch.bind(this), callback);
    },

    _getPatchesToExecute: function(currentPatchLevelObject) {

        console.log('Current patch level is ' + currentPatchLevelObject.str);

        var allPatchFiles = this._readPatchFilesFromDirectories();
        var allPatchFilesWithPatchLevelData = this._addPatchLevelDataToPatchFiles(allPatchFiles);
        var patchFilesToExecute = this._removePatchFilesAlreadyExecuted(allPatchFilesWithPatchLevelData, currentPatchLevelObject);
        var sortedPatchFilesToExecute = this._sortPatchFilesToExecute(patchFilesToExecute);

        var numPatchesAlreadyExecuted = allPatchFiles.length - sortedPatchFilesToExecute.length;
        var numNewPatchesToExecute = sortedPatchFilesToExecute.length;

        console.log(numPatchesAlreadyExecuted+' patch'+(numPatchesAlreadyExecuted !== 1 ? 'es have' : 'has')+' been applied');
        console.log(numNewPatchesToExecute+' new patch'+(numNewPatchesToExecute !== 1 ? 'es' : '')+' will be applied');

        return sortedPatchFilesToExecute;
    },

    _readPatchFilesFromDirectories: function(currentPatchLevelObject) {
        var baseDirectory = this.config.configDir;
        var relativePatchDirectories = this.config.patchDirs || [];
        var allPatchFiles = [];

        relativePatchDirectories.forEach(function(relativePatchDir) {
            var patchDirFullPath = path.resolve(baseDirectory, relativePatchDir);
            var patchFilesFromSingleDir = this._readPatchFilesFromSingleDirectory(patchDirFullPath);
            allPatchFiles = allPatchFiles.concat(patchFilesFromSingleDir);
        }.bind(this));

        return allPatchFiles;
    },

    _readPatchFilesFromSingleDirectory: function(patchDirFullPath) {
        console.log('Examining ' + patchDirFullPath);

        var patchLevelRegex = this.patchLevelRegex;
        var patchFiles = [];

        fs.readdirSync(patchDirFullPath).forEach(function(patchFileName) {
            var regexMatchArray = patchFileName.match(patchLevelRegex);
            var isFileAPatch = regexMatchArray ? true : false;

            if(isFileAPatch) {
                patchFiles.push({
                    fileName: patchFileName,
                    filePath: path.join(patchDirFullPath, patchFileName)
                });
            }
            else {
                console.warn('Ignoring file', patchFileName);
            }
        });

        return patchFiles;
    },

    _addPatchLevelDataToPatchFiles: function(allPatchFiles) {
        var patchLevelRegex = this.patchLevelRegex;
        var allPatchFilesWithPatchLevelData = [];

        allPatchFiles.forEach(function(patchFile){

            // 'patch_0001_1.'.match( /^patch\D+(\d+)(\D+(\d+))?\D/i ) --> ['patch_0001_1.', '0001', '_1', '1']
            var regexMatchArray = patchFile.fileName.match(patchLevelRegex);

            var major = parseInt(regexMatchArray[1], 10);
            var minor = regexMatchArray[3] && parseInt(regexMatchArray[3], 10) || 0;

            patchFile.major = major;
            patchFile.minor = minor;

            allPatchFilesWithPatchLevelData.push(patchFile);
        });

        return allPatchFilesWithPatchLevelData;
    },

    _removePatchFilesAlreadyExecuted: function(allPatchFilesWithPatchLevelData, currentPatchLevelObject) {
        var startingMajor = currentPatchLevelObject.major;
        var startingMinor = currentPatchLevelObject.minor;
        var patchesToExecute = [];

        allPatchFilesWithPatchLevelData.forEach(function(patchFile) {
            var patchFileShouldBeExecuted = patchFile.major > startingMajor ||
                                            (patchFile.major === startingMajor && patchFile.minor > startingMinor);
            if (patchFileShouldBeExecuted) {
                patchesToExecute.push(patchFile);
            }
        });

        return patchesToExecute;
    },

    _sortPatchFilesToExecute: function(patchFilesToExecute) {
        patchFilesToExecute.sort(function(a, b){
            var result = a.major - b.major;
            if (result === 0) {
                result = a.minor - b.minor;
            }
            return result;
        });

        return patchFilesToExecute;
    },

    /**
     * Applies one patch
     * @param patch
     * {
     *  fileName: $fileName,
     *  filePath: $filePath,
     *  major: $major,
     *  minor: $minor
     * }
     * @param callback {function} callback(err, success)
     * @private
     */
    _applyPatch: function(patch, callback) {

        var filePath = patch.filePath;
        var major = patch.major;
        var minor = patch.minor;

        async.auto({
            executeSql: [function(next) {

                var filename = path.basename(filePath);

                // read in patch's SQL
                var allSql = fs.readFileSync(filePath, 'utf8');

                // strip out comments and leading and trailing whitespace
                var commands = this._extractSqlCommands(allSql);

                async.eachSeries(commands, function(command, eachNext) {

                    command = command.trim();

                    // execute the command
                    this.db.query(command, function(err) {
                        if (err) {
                            console.error('Error encountered processing '+filename);
                            console.error(err);
                            console.error('Error SQL:');
                            console.error(command);
                        }
                        eachNext(err);
                    });

                }.bind(this), function(err) {
                    next(err);
                });
            }.bind(this)],
            updateLevel: ['executeSql', function(next) {

                //
                var filename = path.basename(filePath);

                var sql = 'INSERT INTO database_patches (major, minor, file) \n'
                    + this.db.sqlValues(major, minor, filename);

                this.db.query(sql, next);
            }.bind(this)]
        }, function(err, results) {
            callback(err, results && results.updateLevel && results.updateLevel.affectedRows === 1);
        });

    },

    /**
     * Cleans up SQL by removing comments and trimming excess whitespace and returns array of individual commands
     * @param sql {string} the SQL to clean up and extract commands from
     * @returns {string[]} array of cleaned up SQL commands
     * @private
     */
    _extractSqlCommands: function(sql) {

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
    },

    _handleErrorsPrintFeedbackAndExit: function(err) {
        this._errorOccured = err ? true : false;
        this._getCurrentPatchLevel(this._printErrorMessagesAndExit.bind(this));
    },

    _printErrorMessagesAndExit: function(levelErr, patchLevel) {
        if (patchLevel) {
            console.log('Patch level is now '+patchLevel.str);
            this.db.close();
            if (this._errorOccured) {
                console.log('Autopatcher encountered errors');
                process.exit(1);
            } else {
                console.log('Autopatcher executed successfully');
                process.exit(0);
            }
        }
    }
};

module.exports = autopatcher;
