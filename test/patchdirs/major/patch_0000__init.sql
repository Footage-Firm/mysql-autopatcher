/* Create a table */
CREATE TABLE people (
	id int NOT NULL PRIMARY KEY AUTO_INCREMENT,
	name varchar(63) NOT NULL
);

/* Now lets make another table; and have hopefuly this in-comment semicolon doesn't mess up the autopatcher! */
CREATE TABLE colors (
	id int NOT NULL PRIMARY KEY AUTO_INCREMENT,
	person_id int NOT NULL,
	color varchar(40) NOT NULL,
	CONSTRAINT fk_colors_people FOREIGN KEY (person_id) REFERENCES people (id)
);

