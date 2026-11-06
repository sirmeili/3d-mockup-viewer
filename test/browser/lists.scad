// List values for the browser tests (planned item 10): which lists become fields, and how.

/* [Lists] */
// corner posts, x and y
posts = [[0, 0], [20, 0], [0, 12]];
labels = ["PWR", "LNK"];
size = [6, 4, 2.5];          // [1:0.5:30]
five = [1, 2, 3, 4, 5];      // [a, b]
// a table over several lines
table = [
    [2, 3, "a"],   // first row
    // a comment line inside
    [4, 5, "b;c // d"]
];
note = "semi; colon // not a comment";

/* [Hidden] */
secret = [1, 2];

/* [Calculated] */
moved = [size[0] + 1, 2];
spread = [for (i = [0:2]) i * 2];

module post(p) { translate([p[0], p[1], 0]) cube(size); }
for (p = posts) post(p);
