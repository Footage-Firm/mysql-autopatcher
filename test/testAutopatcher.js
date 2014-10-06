'use strict';

var fs = require('fs-extra');
var path = require('path');
var spawn = require('child_process').spawn;

var async = require('async');
var NodeunitAsync = require('nodeunit-async');
var EzMySql = require('../lib/ezMySql');

var CONFIG_PATH = path.resolve(__dirname,'configForTest.json');

var config = fs.readJsonFileSync(CONFIG_PATH);
var db = new EzMySql({
    host: config.profiles.default.host,
    port: config.profiles.default.port,
    database: config.profiles['test-profile'].database,
    user: config.profiles.default.user,
    password: config.profiles.default.password
});

// Create our "test helper" (a.k.a "th")
var th = new NodeunitAsync({
    fixtureTeardown: function() {
        if (db) {
            db.close();
        }
    }
});

// Test out the autopatcher
module.exports.testAutopatcher = function(test) {

    // prep a future patch to be added later
    var newPatchFile = 'patch_0003__bobby-tables.sql';
    var newPatchPath = path.resolve(__dirname,'patchdirs','major',newPatchFile);
    if (fs.existsSync(newPatchPath)) {
        fs.unlinkSync(newPatchPath);
    }

    var newPatchFile2 = 'patch_0003_0_1.sql';
    var newPatchPath2 = path.resolve(__dirname,'patchdirs','level3',newPatchFile2);
    if (fs.existsSync(newPatchPath2)) {
        fs.unlinkSync(newPatchPath2);
    }


    test.expect(12);

    th.runTest(test, {
        dropTables: [function(next) {
            async.eachSeries(['database_patches', 'colors', 'people'], function(table, eachNext) {
                db.query('DROP TABLE IF EXISTS '+table, eachNext);
            }, function(err) {
                next(err);
            });
        }],
        runAutopatcher: ['dropTables', function(next) {
            _runAutopatcher(CONFIG_PATH, 'test-profile', next);
        }],
        checkDb: ['runAutopatcher', function(next) {
            db.queryOne('SELECT SUM(power_level) AS the_sum FROM people', next);
        }],
        runNewPatch: ['checkDb', function(next) {
            fs.copySync(path.join(path.dirname(newPatchPath),'future-'+newPatchFile), newPatchPath);
            _runAutopatcher(CONFIG_PATH, 'test-profile', next);
        }],
        checkUpdatedDb: ['runNewPatch', function(next) {
            db.queryOne('SELECT SUM(power_level) AS the_sum FROM people', next);
        }],
        runAutopatcherLevel3ShouldBreak: ['checkUpdatedDb', function(next) {
            _runAutopatcher(CONFIG_PATH, 'level3-profile', next);
        }],
        dropTables2: ['runAutopatcherLevel3ShouldBreak', function(next) {
            async.eachSeries(['database_patches', 'colors', 'people'], function(table, eachNext) {
                db.query('DROP TABLE IF EXISTS '+table, eachNext);
            }, function(err) {
                next(err);
            });
        }],
        runAutopatcherLevel3: ['dropTables2', function(next) {
            _runAutopatcher(CONFIG_PATH, 'level3-profile', next);
        }],
        checkColorTable: ['runAutopatcherLevel3', function(next) {
           db.queryOne('SELECT COUNT(*) as numRowsInColorTable FROM colors', next);
        }],
        checkPeoplePower: ['checkColorTable', function(next) {
            db.queryOne('SELECT SUM(power_level) AS the_sum FROM people', next);
        }],
        getBeforeWeaklingId: ['checkPeoplePower', function(next) {
            db.queryOne('SELECT id FROM people WHERE name="Before Weakling"', next);
        }],
        getWeaklingId: ['getBeforeWeaklingId', function(next) {
            db.queryOne('SELECT id FROM people WHERE name="Weakling"', next);
        }],
        runAutopatcherLevel2ShouldBreak:  ['getWeaklingId', function(next) {
            _runAutopatcher(CONFIG_PATH, 'test-profile', next);
        }],
        runNewPatch2: ['runAutopatcherLevel2ShouldBreak', function(next) {
            fs.copySync(path.join(path.dirname(newPatchPath2),'future-'+newPatchFile2), newPatchPath2);
            _runAutopatcher(CONFIG_PATH, 'level3-profile', next);
        }],
        checkNewColor: ['runNewPatch2', function(next) {
            db.queryOne('SELECT COUNT(*) as numCyanColors FROM colors c JOIN people p ON c.person_id = p.id WHERE p.name="John Smith" AND c.color="cyan"', next);
        }],
        assertResults: ['checkNewColor', function(next, results) {

            // Level 2 tests ( 5 assertions )
            test.equal(0, results.runAutopatcher.code);
            test.equal(0, results.runNewPatch.code);
            test.equal(1, results.runAutopatcherLevel3ShouldBreak.code);
            test.equal(31000, results.checkDb.the_sum);
            test.equal(40000, results.checkUpdatedDb.the_sum);


            // Level 3 tests ( 5 assertions )
            test.equal('numberOfPatchLevels (3) does not match number of tracking columns in database_patches (2).\n'
                        + 'To use specified profile, please re-create your DB from scratch.', results.runAutopatcherLevel3ShouldBreak.stderr);
            test.equal(0, results.runAutopatcherLevel3.code);
            test.equal(3, results.checkColorTable.numRowsInColorTable);
            test.equal(42000, results.checkPeoplePower.the_sum);
            test.ok(results.getBeforeWeaklingId.id < results.getWeaklingId.id);

            // Level 2 tests - second go around ( 1 assertion )
            test.equal('numberOfPatchLevels (2) does not match number of tracking columns in database_patches (3).\n'
                + 'To use specified profile, please re-create your DB from scratch.', results.runAutopatcherLevel2ShouldBreak.stderr);

            // Level 3 test - should've run another patch which added cyan color ( 1 assertion )
            test.equal(1, results.checkNewColor.numCyanColors);

            next();
        }]
    });
};

/**
 * Helper function that runs the autopatcher logging any of its output to the console
 *
 * @param configFileFullPath - path to the AP configuration file that we'll pass to node patch.js {profile} {configFileFullPath}
 * @param profile - profile we want to select within AP config file that we'll pass to node patch.js {profile} {configFileFullPath}
 * @param callback {function} callback(err, exitCode)
 * @private
 */
function _runAutopatcher(configFileFullPath, profile, callback) {

    var autopatcher = spawn('node', ['patch.js', profile, configFileFullPath], {cwd: path.resolve(__dirname,'..')});

    var stdout = '';
    var stderr = '';

    autopatcher.stdout.on('data', function (data) {
        var str = (''+data).trim();
        if (str) {
            console.log(str);
            stdout += str;
        }
    });

    autopatcher.stderr.on('data', function (data) {
        var str = (''+data).trim();
        if (str) {
            console.error(str);
            stderr += str;
        }
    });

    autopatcher.on('close', function (code) {
        callback(null, {code:code, stdout: stdout, stderr: stderr});
    });
}
