// Sample assembly for the mockup pipeline: a small ESP32 sensor enclosure.
// Render one part at a time with:  openscad -D 'part="lid"' -o lid.stl sensor_box.scad
// Convention: Z up, front face toward -Y (OpenSCAD's front view).

part = "all";
$fn = 48;

W = 70; D = 50; H = 22;     // outside
wall = 2; floor_t = 2; lid_t = 2;
r = 4;                       // corner radius
pcb_w = 60; pcb_d = 40; pcb_t = 1.6; standoff = 4;
pcb_z = floor_t + standoff;

module rbox(w, d, h, rr) {
  translate([-w/2 + rr, -d/2 + rr, 0])
    minkowski() { cube([w - 2*rr, d - 2*rr, h/2]); cylinder(r = rr, h = h/2); }
}

module base() {
  difference() {
    rbox(W, D, H - lid_t, r);
    translate([0, 0, floor_t]) rbox(W - 2*wall, D - 2*wall, H, r - wall);
    // RJ45 opening, front
    translate([-12, -D/2 - 1, pcb_z + pcb_t - 0.5]) cube([17, wall + 2, 14.5]);
    // USB-C opening, left side
    translate([-W/2 - 1, 4, pcb_z + pcb_t]) cube([wall + 2, 9.5, 3.8]);
    // vent slots, rear
    for (i = [-3:3]) translate([i * 6 - 1, D/2 - wall - 1, 8]) cube([2, wall + 2, 8]);
  }
  for (x = [-1, 1], y = [-1, 1])
    translate([x * (pcb_w/2 - 3.5), y * (pcb_d/2 - 3.5), floor_t])
      difference() { cylinder(d = 5.5, h = standoff); cylinder(d = 2.2, h = standoff + 1); }
}

module lid() {
  translate([0, 0, H - lid_t]) difference() {
    union() {
      rbox(W, D, lid_t, r);
      translate([0, 0, -2]) difference() {
        rbox(W - 2*wall - 0.4, D - 2*wall - 0.4, 2, r - wall);
        translate([0, 0, -1]) rbox(W - 2*wall - 3.2, D - 2*wall - 3.2, 4, r - wall - 1);
      }
    }
    for (i = [0:2]) translate([18 + i * 6, -10, -3]) cylinder(d = 3.2, h = 10);
  }
}

module pcb() {
  translate([-pcb_w/2, -pcb_d/2, pcb_z]) difference() {
    cube([pcb_w, pcb_d, pcb_t]);
    for (x = [3.5, pcb_w - 3.5], y = [3.5, pcb_d - 3.5]) translate([x, y, -1]) cylinder(d = 2.7, h = 4);
  }
}
module module_can() { translate([2, -4, pcb_z + pcb_t]) cube([18, 25.5, 3.2]); }
module rj45()       { translate([-11.5, -D/2 + wall + 0.2, pcb_z + pcb_t]) cube([16, 21, 13.5]); }
module usbc()       { translate([-pcb_w/2 - 0.8, 4.5, pcb_z + pcb_t]) cube([7.5, 8.9, 3.2]); }
module header()     { translate([-20, 12, pcb_z + pcb_t]) cube([25.4, 5, 8.5]); }
module leds()       { for (i = [0:2]) translate([18 + i * 6, -10, pcb_z + pcb_t]) cylinder(d = 3, h = 1.2); }
module pipes()      { for (i = [0:2]) translate([18 + i * 6, -10, pcb_z + pcb_t + 1.4]) cylinder(d = 3, h = H - pcb_z - pcb_t - 1.4); }

if (part == "base")   base();
if (part == "lid")    lid();
if (part == "pcb")    pcb();
if (part == "module") module_can();
if (part == "rj45")   rj45();
if (part == "usbc")   usbc();
if (part == "header") header();
if (part == "leds")   leds();
if (part == "pipes")  pipes();
if (part == "all") { base(); lid(); pcb(); module_can(); rj45(); usbc(); header(); leds(); pipes(); }
