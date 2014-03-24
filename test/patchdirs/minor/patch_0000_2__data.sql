/* Let's insert some data */
INSERT INTO people (name)
VALUES ('John Smith');

-- This should be cool
INSERT INTO colors (person_id, color)
SELECT id, 'red' FROM people WHERE name = 'John Smith' --love that color!
UNION ALL
SELECT id, 'blue' FROM people WHERE name = 'John Smith';