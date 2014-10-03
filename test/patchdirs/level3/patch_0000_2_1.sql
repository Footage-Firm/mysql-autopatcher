INSERT INTO colors (person_id, color)
SELECT id, 'green' FROM people WHERE name = 'John Smith';