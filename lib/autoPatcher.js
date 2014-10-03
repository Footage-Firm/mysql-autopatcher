'use strict';

var fs = require('fs');
var path = require('path');

var async = require('async');

var EzMySqlOptions = require('./ezMySqlOptions');
var EzMySql = require('./ezMySql');

var BAD_DB_TABLE_ERROR_CODE = 1000;

/**
 * Autopatcher constructor
 *
 * EXPORTED
 *
 * @param autopatcherConfiguration - should be of type autopatcherConfiguration
 */
var autopatcher = function(autopatcherConfiguration) {
    this.config = autopatcherConfiguration.getConfigOptions();
    this.db = this._getDbConnection();

    this.patchLevelRegex = this._getPatchLevelRegex();
    this.trackingTablePatchLevelColumns = this._getTrackingTablePatchLevelColumns();
};

autopatcher.prototype = {
    patch: function() {
        console.log('Starting autopatcher');

        async.auto({
            ensureDbTrackingTableExists: [this._ensureDbTrackingTableExists.bind(this)],
            ensureDbTrackingTableMatchesNumberOfPatchLevels: ['ensureDbTrackingTableExists', this._ensureDbTrackingTableMatchesNumberOfPatchLevels.bind(this)],
            getCurrentPatchLevel: ['ensureDbTrackingTableMatchesNumberOfPatchLevels', this._getCurrentPatchLevel.bind(this)],
            executeNewPatches: ['getCurrentPatchLevel', this._executeNewPatches.bind(this)]
        }, this._handleErrorsPrintFeedbackAndExit.bind(this));
    },

    _getDbConnection: function() {
        var mysqlOptions = new EzMySqlOptions(this.config);
        var db = new EzMySql(mysqlOptions);
        return db;
    },

    /**
     * Generates a regex to check against patch files.  Extracts the #'s so we can leverage them.
     * Note, for congig.numberOfPatchLevels = n, the output is...
     *      + (1): ^patch\D+(\d+)\D
     *      + (2): ^patch\D+(\d+)(\D+(\d+))?\D
     *      + (3): ^patch\D+(\d+)(\D+(\d+))?(\D+(\d+))?\D
     *
     * Numbers should be index 1,3,5,... using return from .match()
     */
    _getPatchLevelRegex: function() {
        var regexPrefix = '^patch\\D+';
        var regexFirstDigit = '(\\d+)';
        var regexNextDigits = '';
        var regexSuffix = '\\D';

        // For every extra patch level over 1, we need to add a regex group (\D+(\d+))?
        for (var i = 1; i < this.config.numberOfPatchLevels; i++) {
            regexNextDigits += '(\\D+(\\d+))?'
        }

        var regexString = regexPrefix + regexFirstDigit + regexNextDigits + regexSuffix;
        var regex = new RegExp(regexString, 'i');

        return regex;
    },

    _getTrackingTablePatchLevelColumns: function() {
        var trackingTablePatchLevelColumns = ['major'];

        if (this.config.numberOfPatchLevels >= 2) {
            trackingTablePatchLevelColumns.push('minor');
        }
        for (var i=3; i <= this.config.numberOfPatchLevels; i++) {
            trackingTablePatchLevelColumns.push('level'+i);
        }
        return trackingTablePatchLevelColumns;
    },

    /**
     * Used in async.auto (1: no dependencies)
     *
     * Note, this function changes based on config.numberOfPatchLevels by adding columns:
     *      (1) major
     *      (2) minor
     *      (3) level3
     *      (4) level4
     *      ...
     *
     * MUST BE CALLED IN CONTEXT OF autopatcher OBJECT
     */
    _ensureDbTrackingTableExists: function(callback) {

        var trackerLevelsColumnSql = '';
        this.trackingTablePatchLevelColumns.forEach(function(column) {
           trackerLevelsColumnSql += column + ' int unsigned NOT NULL, \n';
        });

        var primaryKeyColumnList = this.trackingTablePatchLevelColumns.join(',');

        var sql = 'CREATE TABLE IF NOT EXISTS database_patches ( \n'
             +           trackerLevelsColumnSql
             +    '      file varchar(255) NOT NULL, \n'
             +    '      date_applied timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, \n'
             +    '      CONSTRAINT pk_database_patches PRIMARY KEY ('+primaryKeyColumnList+') \n'
             + ')';

        this.db.query(sql, callback);
    },


    /**
     * Used in async.auto (2: _ensureDbTrackingTableExists)
     *
     * Returns an error through callback if the columns in DB tracking table do not match this.config.numberOfPatchLevels
     * MUST BE CALLED IN CONTEXT OF autopatcher OBJECT
     *
     * @param callback - next from async.auto
     * @private
     */
    _ensureDbTrackingTableMatchesNumberOfPatchLevels: function(callback) {
        var trackingTablePatchLevelColumnsInQuotes = [];
        this.trackingTablePatchLevelColumns.forEach(function(column) {
            trackingTablePatchLevelColumnsInQuotes.push('"'+column+'"');
        });
        var columnNameInClauseList = trackingTablePatchLevelColumnsInQuotes.join(',');

        var sql = 'SELECT COUNT(*) as numPatchColumns \n'
                + 'FROM information_schema.columns \n'
                + 'WHERE table_schema = ' + '"' + this.config.database + '" \n'
                + '     AND table_name = "database_patches" \n'
                + '     AND column_name IN (' + columnNameInClauseList + ') \n';

        this.db.queryOne(sql, function(err, resultRow){
            if (err) {
                return callback(err, null);
            }

            var trackingTableMatchesNumberOfPatchLevels = resultRow && resultRow.numPatchColumns
                                                      && resultRow.numPatchColumns === this.config.numberOfPatchLevels;
            if (trackingTableMatchesNumberOfPatchLevels) {
                return callback(null,null);
            }
            else {
                err = new Error(
                    'numberOfPatchLevels does not match number of columns in database_patches. '
                    + 'To use current numberOfPatchLevels, please re-create your DB from scratch'
                );
                err.code = BAD_DB_TABLE_ERROR_CODE;
                return callback(err, null);
            }
        }.bind(this));
    },

    /**
     * Used in async.auto call
     */
    _getCurrentPatchLevel: function(callback) {
        async.auto({
            executeQueryForPatchLevel: [this._executeQueryForPatchLevel.bind(this)],
            extractPatchLevelFromQueryResults: ['executeQueryForPatchLevel', this._extractPatchLevelFromQueryResults.bind(this)]
        }, function(err, results) {
            var patchLevelObject = results && results.extractPatchLevelFromQueryResults;
            callback(err, patchLevelObject);
        });
    },

    /**
     * Executes SQL query to fetch current patch level
     * Does so simply using an ORDER BY clause and a limit of 1 result
     */
    _executeQueryForPatchLevel: function(callback) {
        var selectColumnListString = this.trackingTablePatchLevelColumns.join(',');

        // ORDER BY major DESC, minor DESC, level3 DESC, ...
        var orderByColumnList = [];
        this.trackingTablePatchLevelColumns.forEach(function(column){
            orderByColumnList.push(column+' DESC');
        });
        var orderByColumnListString = orderByColumnList.join(',');

        var sql = 'SELECT '+selectColumnListString+' \n'
            + 'FROM database_patches \n'
            + 'ORDER BY '+orderByColumnListString+' \n'
            + 'LIMIT 1';

        this.db.queryOne(sql, callback);
    },

    /**
     * Returns a patch level object via results to callback function:
     *
     * {
     *      major: 10,
     *      minor: 5,
     *      level3: 2
     * }
     */
    _extractPatchLevelFromQueryResults: function(callback, results) {

        var thereIsADefinedPatchLevel = results.executeQueryForPatchLevel !== null;
        var patchLevelObject = {};
        var patchLevelArray = []

        /**
         * Creates an two things:
         *
         *  1) Object like:
         *
         *      {
         *          major: 10,
         *          minor: 5,
         *          level3: 2
         *      }
         *  2) Array of values: [10, 5, 2]
         */
        this.trackingTablePatchLevelColumns.forEach(function(column) {
            if(thereIsADefinedPatchLevel) {
                patchLevelObject[column] = results.executeQueryForPatchLevel && results.executeQueryForPatchLevel[column];
                patchLevelArray.push(patchLevelObject[column]);
            }
            else {
                patchLevelObject[column] = -1;
            }
        });

        // If there are values defined, then define the patchLevelStr (e.g., 10.5.2)
        var patchLevelStr = '(none)';
        if (patchLevelArray.length > 0) {
            patchLevelStr = patchLevelArray.join('.');
        }
        patchLevelObject.str = patchLevelStr;

        callback(null, patchLevelObject);
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

            /**
             * 'patch_0001_1.'.match( /^patch\D+(\d+)(\D+(\d+))?\D/i ) --> ['patch_0001_1.', '0001', '_1', '1']
             * Therefore the numbers we care about are in indexes 1, 3, 5...
             */
            var regexMatchArray = patchFile.fileName.match(patchLevelRegex);

            this.trackingTablePatchLevelColumns.forEach(function(column, i) {
                var patchLevelValue = parseInt(regexMatchArray[2*i + 1], 10) || 0; // 2i+1 gives us the indexes as described in comment above
                patchFile[column] = patchLevelValue;
            });

            allPatchFilesWithPatchLevelData.push(patchFile);
        }.bind(this));

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
            for(var i=0; i<this.trackingTablePatchLevelColumns.length; i++) {
                var column = this.trackingTablePatchLevelColumns[i];
                var delta = a[column] - b[column];
                if (delta !== 0) {
                    return delta;
                }
            }
            return 0; // If we didn't return in the loop, then all patch levels are the same
        }.bind(this));

        return patchFilesToExecute;
    },

    /**
     * Applies one patch
     * @param patch
     * {
     *  fileName: $fileName,
     *  filePath: $filePath,
     *  major: $major,
     *  minor: $minor,
     *  level3: $level3,
     *  ...
     * }
     * @param callback {function} callback(err, success)
     * @private
     */
    _applyPatch: function(patch, callback) {
        async.auto({
            executeSqlForSinglePatch: [function(next) { this._executeSqlForSinglePatch(patch, next)}.bind(this)],
            updatePatchLevelInDb: ['executeSqlForSinglePatch', function(next) { this._updatePatchLevelInDb(patch, next)}.bind(this)]
        }, function(err, results) {
            callback(err, results && results.updatePatchLevelInDb && results.updatePatchLevelInDb.affectedRows === 1);
        });
    },

    _executeSqlForSinglePatch: function(patch, callback) {

        console.log('Applying patch ' + patch.fileName);

        // read in patch's SQL
        var allSql = fs.readFileSync(patch.filePath, 'utf8');

        // strip out comments and leading and trailing whitespace
        var commands = this._extractSqlCommands(allSql);

        async.eachSeries(commands, function(command, eachNext) {

            command = command.trim();

            // execute the command
            this.db.query(command, function(err) {
                if (err) {
                    console.error('Error encountered processing '+patch.fileName);
                    console.error(err);
                    console.error('Error SQL:');
                    console.error(command);
                }
                eachNext(err);
            });

        }.bind(this)
        , function(err) {
            callback(err);
        });
    },

    _updatePatchLevelInDb: function(patch, callback) {

        // major, minor, level3, ..., file
        var insertColumnListString = this.trackingTablePatchLevelColumns.join(',') + ', file';

        var valuesArray = [];
        this.trackingTablePatchLevelColumns.forEach(function(column) {
            valuesArray.push(patch[column]);
        });
        valuesArray.push(patch.fileName);

        var sql = 'INSERT INTO database_patches ('+insertColumnListString+') \n'
            + this.db.sqlValues.apply(this.db, valuesArray);

        this.db.query(sql, callback);
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
        if(!err || (err && err.code !== BAD_DB_TABLE_ERROR_CODE)) {
            this._errorOccured = err ? true : false;
            this._getCurrentPatchLevel(this._printErrorMessagesAndExit.bind(this));
        }
        else { // Only do this when we cannot select from DB table b/c # of patch levels inconsistent
            console.log('Autopatcher encountered errors');
            console.warn(err.message);
            process.exit(1);
        }
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
