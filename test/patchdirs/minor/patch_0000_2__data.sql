/* Let's insert some data */
INSERT INTO people (name)
VALUES ('John Smith');

INSERT INTO colors (person_id, color)
SELECT id, 'red' FROM people WHERE name = 'John Smith'
UNION ALL
SELECT id, 'blue' FROM people WHERE name = 'John Smith';