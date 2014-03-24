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


    test.expect(4);

    th.runTest(test, {
        dropTables: [function(next) {
            async.eachSeries(['database_patches', 'colors', 'people'], function(table, eachNext) {
                db.query('DROP TABLE IF EXISTS '+table, eachNext);
            }, function(err) {
                next(err);
            });
        }],
        runAutopatcher: ['dropTables', function(next) {
            _runAutopatcher(next);
        }],
        checkDb: ['runAutopatcher', function(next) {
            db.queryOne('SELECT SUM(power_level) AS the_sum FROM people', next);
        }],
        runNewPatch: ['checkDb', function(next) {
            fs.copySync(path.join(path.dirname(newPatchPath),'future-'+newPatchFile), newPatchPath);
            _runAutopatcher(next);
        }],
        checkUpdatedDb: ['runNewPatch', function(next) {
            db.queryOne('SELECT SUM(power_level) AS the_sum FROM people', next);
        }],
        assertResults: ['checkUpdatedDb', function(next, results) {

            test.equal(0, results.runAutopatcher);
            test.equal(0, results.runNewPatch);

            test.equal(31000, results.checkDb.the_sum);
            test.equal(40000, results.checkUpdatedDb.the_sum);

            next();
        }]
    });
};

/**
 * Helper function that runs the autopatcher logging any of its output to the console
 * @param callback {function} callback(err, exiteCode)
 * @private
 */
function _runAutopatcher(callback) {

    var autopatcher = spawn('node', ['patch.js', 'test-profile', CONFIG_PATH], {cwd: path.resolve(__dirname,'..')});

    autopatcher.stdout.on('data', function (data) {
        var str = (''+data).trim();
        if (str) {
            console.log(str);
        }
    });

    autopatcher.stderr.on('data', function (data) {
        var str = (''+data).trim();
        if (str) {
            console.error(str);
        }
    });

    autopatcher.on('close', function (code) {
        callback(null, code);
    });
}
