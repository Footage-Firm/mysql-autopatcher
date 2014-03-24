mysql-autopatcher
=================

Simple autopatcher for MySQL patches with support for major and minor versions as well as multiple directories. Uses patch naming convetion and dynamically created MySQL database table to track which patches have already been applied and which patches should be applied. It will then attempt to apply the new patches.

This auto patcher is written in [node.js](http://nodejs.org/) and requires node to run. Following node convention, node modules are not checked in. These can be downloaded and installed using the command ```npm install``` within the root directory.

## Patch Naming Convetion

The autopatcher expects patches to have the following naming convention: patch-*&lt;major&gt;*-*&lt;minor&gt;*-*&lt;description&gt;*
Note that instead of hyphons any non-digit character will suffice. Minor versions, description, and seperation between "patch" and the major version are all optional. If no minor version is present, a minor version of 0 will be assumed.

Patches are executed in order of major versions with ties broken by minor versions.

Example patch file name: ```patch_0004_9__this-does-cool-things.sql```

Configuration
=================

Configuratino uses a JSON file that has an object which contains one or more profiles. The name of the profile is the name of the top level property. Its value are the options to use for the autopatcher. If a default profile is present, its options will be inherited by other profiles which don't explicitly specify a value for that option.

### Options

* **database** - MySQL database to run commands against *(required)*
* **patchDirs** - One or more directories where patch files can be found *(required)*
* **host** - host name for the MySQL Database *(default: '127.0.0.1')*
* **port** - port for the MySQL Database *(default: 3306)*
* **user** - MySQL user to use *(default: none)*
* **password** - MySQL password to use *(default: none)*

### Example config.json

```json
  {
    "profiles": {
        "default": {
            "host": "127.0.0.1",
            "port": 3306,
            "user": "autopatchertest",
            "password": "autopatchertest"
        },
        "test-profile": {
            "database": "autopatcher_test",
            "patchDirs": ["patchDirs/major",
                          "patchDirs/minor"]
        }
    }
}
```

Execution
=================

The core executable is ```autopatcher```.

    node autopatcher

Two optional arguments are the profile to use (default is "default") and configuration file to use (default is "./config.json"). If the file has write permissions, you should be able to execute it directory without node.

    autopatcher my-profile /path/to/config/file.json

Testing
============
Testing uses [nodeunit](https://github.com/caolan/nodeunit), which you can install globally.

     npm install -g nodeunit

To run the tests, execute:

     nodeunit test/
