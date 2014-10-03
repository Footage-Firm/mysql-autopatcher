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
function Autopatcher(autopatcherConfiguration) {
    this.config = autopatcherConfiguration.getConfigOptions();
    this.db = this._getDbConnection();

    this.trackingTablePatchLevelColumns = this._getTrackingTablePatchLevelColumns();
}

Autopatcher.prototype = {
    patch: function() {
        console.log('Starting autopatcher');

        var self = this;

        async.auto({
            ensureDbTrackingTableExists: [function(next){
                self._ensureDbTrackingTableExists(next);
            }],
            ensureDbTrackingTableMatchesNumberOfPatchLevels: ['ensureDbTrackingTableExists', function(next){
                self._ensureDbTrackingTableMatchesNumberOfPatchLevels(next);
            }],
            getCurrentPatchLevel: ['ensureDbTrackingTableMatchesNumberOfPatchLevels', function(next) {
                self._getCurrentPatchLevel(next);
            }],
            executeNewPatches: ['getCurrentPatchLevel', function(next, results) {
                self._executeNewPatches(results.getCurrentPatchLevel, next);
            }]
        }, function(err){
            self._handleErrorsPrintFeedbackAndExit(err)
        });
    },

    _getDbConnection: function() {
        var mysqlOptions = new EzMySqlOptions(this.config);
        var db = new EzMySql(mysqlOptions);
        return db;
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
     * Note, this function changes based on config.numberOfPatchLevels by adding columns:
     *      (1) major
     *      (2) minor
     *      (3) level3
     *      (4) level4
     *      ...
     *
     * @param callback(err, results) - next from async.auto
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
     * Returns an error through callback if the columns in DB tracking table do not match this.config.numberOfPatchLevels
     *
     * @param callback(err, results) - next from async.auto
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
                return callback(err);
            }
        }.bind(this));
    },

    /**
     * Returns the current patch level row, e.g., :
     * {
     *      major: 5,
     *      minor: 2,
     *      level3: 1
     * }
     *
     * @param callback(err, results) - next from async.auto
     */
    _getCurrentPatchLevel: function(callback) {

        var self = this;

        async.auto({
            executeQueryForPatchLevel: [function(next) {
                self._executeQueryForPatchLevel(next);
            }],
            extractPatchLevelFromQueryResults: ['executeQueryForPatchLevel', function(next, results) {
                var patchLevelRow = results.executeQueryForPatchLevel;
                self._extractPatchLevelFromQueryResults(patchLevelRow, next);
            }]
        }, function(err, results) {
            var patchLevelRow = results && results.extractPatchLevelFromQueryResults;
            callback(err, patchLevelRow);
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
    _extractPatchLevelFromQueryResults: function(patchLevelRow, callback) {

        var thereIsADefinedPatchLevel = patchLevelRow !== null;
        var patchLevelObject = {};
        var patchLevelArray = [];

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
                patchLevelObject[column] = patchLevelRow[column];
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
    _executeNewPatches: function(currentPatchLevelObject, callback) {
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

        var patchFileRegex = this._getPatchFileRegex();
        var patchFiles = [];

        fs.readdirSync(patchDirFullPath).forEach(function(patchFileName) {
            var regexMatchArray = patchFileName.match(patchFileRegex);
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

    /**
     * Generates a regex to check against patch files.  Extracts the #'s so we can leverage them.
     * Note, for congig.numberOfPatchLevels = n, the output is...
     *      + (1): ^patch\D+(\d+)\D
     *      + (2): ^patch\D+(\d+)(\D+(\d+))?\D
     *      + (3): ^patch\D+(\d+)(\D+(\d+))?(\D+(\d+))?\D
     *
     * Numbers should be index 1,3,5,... using return from .match()
     */
    _getPatchFileRegex: function() {
        var regexPrefix = '^patch\\D+';
        var regexFirstDigit = '(\\d+)';
        var regexNextDigits = '';
        var regexSuffix = '\\D';

        // For every extra patch level over 1, we need to add a regex group (\D+(\d+))?
        for (var i = 1; i < this.config.numberOfPatchLevels; i++) {
            regexNextDigits += '(\\D+(\\d+))?'
        }

        var regexString = regexPrefix + regexFirstDigit + regexNextDigits + regexSuffix;
        var patchFileRegex = new RegExp(regexString, 'i');

        return patchFileRegex;
    },

    _addPatchLevelDataToPatchFiles: function(allPatchFiles) {
        var allPatchFilesWithPatchLevelData = [];
        var self = this;

        allPatchFiles.forEach(function(patchFile){

            var patchNumberRegex = /\D+(\d+)/g;

            var patchNumberRegexMatchArray;
            var column;
            var patchNumber;

            // Extract each patch number one at a time.  See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec for details on the RegExp.exec function
            for (var i=0; i < self.trackingTablePatchLevelColumns.length; i++) {

                var shouldExtractAnotherDigit = (i == 0 || patchNumberRegexMatchArray !== null); // Ugh...hate having to do this but exec function loops around to the beginning of the string after hitting NULL
                if(shouldExtractAnotherDigit) {
                    patchNumberRegexMatchArray = patchNumberRegex.exec(patchFile.fileName);
                }

                var digitWasExtracted = (patchNumberRegexMatchArray !== null);
                if(digitWasExtracted) {
                    patchNumber = parseInt(patchNumberRegexMatchArray[1], 10); // The digit (in parens in patchNumberRegex) will always be the second element in the match array
                }
                else {
                    patchNumber = 0;
                }

                column = self.trackingTablePatchLevelColumns[i];
                patchFile[column] = patchNumber;
            }

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
        var self = this;
        patchFilesToExecute.sort(function(a, b){
            for(var i=0; i<self.trackingTablePatchLevelColumns.length; i++) {
                var column = self.trackingTablePatchLevelColumns[i];
                var delta = a[column] - b[column];
                if (delta !== 0) {
                    return delta;
                }
            }
            return 0; // If we didn't return in the loop, then all patch levels are the same
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
     *  minor: $minor,
     *  level3: $level3,
     *  ...
     * }
     * @param callback {function} callback(err, success)
     */
    _applyPatch: function(patch, callback) {
        var self = this;
        async.auto({
            executeSqlForSinglePatch: [function(next) { self._executeSqlForSinglePatch(patch, next)}],
            updatePatchLevelInDb: ['executeSqlForSinglePatch', function(next) { self._updatePatchLevelInDb(patch, next)}]
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
        this._executeSqlCommands(patch, commands, callback);
    },

    _executeSqlCommands: function(patch, commands, callback) {
        var self = this;

        async.eachSeries(commands, function(command, eachNext) {

            command = command.trim();

            // execute the command
            self.db.query(command, function(err) {
                if (err) {
                    console.error('Error encountered processing '+patch.fileName);
                    console.error(err);
                    console.error('Error SQL:');
                    console.error(command);
                }
                eachNext(err);
            });

        }
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
        var valuesString = this.db.sqlValues.apply(this.db, valuesArray);

        var sql = 'INSERT INTO database_patches ('+insertColumnListString+') \n'
                    + valuesString;

        this.db.query(sql, callback);
    },

    /**
     * Cleans up SQL by removing comments and trimming excess whitespace and returns array of individual commands
     * @param sql {string} the SQL to clean up and extract commands from
     * @returns {string[]} array of cleaned up SQL commands
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
        var self = this;
        if(!err || (err && err.code !== BAD_DB_TABLE_ERROR_CODE)) {
            this._errorOccured = err ? true : false;
            this._getCurrentPatchLevel(function(levelErr, patchLevel){
                self._printErrorMessagesAndExit(levelErr, patchLevel);
            });
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

module.exports = Autopatcher;
