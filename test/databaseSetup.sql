/* Set up test database for unit tests */
DROP DATABASE IF EXISTS autopatcher_test;
CREATE DATABASE autopatcher_test;

CREATE USER 'autopatchertest'@'localhost' IDENTIFIED BY 'autopatchertest';

GRANT ALL PRIVILEGES ON autopatcher_test.* TO 'autopatchertest'@'localhost' WITH GRANT OPTION;
