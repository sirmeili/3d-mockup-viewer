# Manifest reference

A mockup is described by one `manifest.json`. Paths are relative to the manifest. Every field is optional except `parts`.

```json
{
  "name": "RNET Bridge Case",
  "subtitle": "Ethernet on the front, DB9 out the back.",
  "eyebrow": "3D mockup",
  "up": "z",
  "units": "mm",
  "parts": [
    { "id": "base", "name": "Case base", "group": "base", "material": "finish",
      "scad": { "file": "case.scad", "defines": { "part": "base" } } },
    { "id": "lid", "name": "Lid", "group": "lid", "material": "finish", "file": "lid.stl" }
  ],
  "groups": {
    "base": { "label": "Case base", "explode": [0, 0, 0] },
    "lid":  { "label": "Lid", "explode": [0, 0, 45], "inside": "hide" }
  },
  "views": ["front", "rear", "left", "top", "iso", { "name": "Port side", "dir": [-1, -0.3, 0.4] }],
  "defaultView": "iso",
  "finishes": [{ "name": "Graphite", "color": "#3a3e41" }, { "name": "Bone white", "color": "#e4e1d8" }],
  "spec": [
    { "title": "Size and fit", "rows": [["Outside", "37 × 147 × 27 mm"]] },
    { "title": "Ports", "items": ["RJ45, front", "DB9, rear"] },
    { "title": "Printing", "text": "Print upright, no supports." }
  ]
}
```

## Top level

| Field | Meaning |
|---|---|
| `name`, `subtitle`, `eyebrow` | Page heading text. `name` is also the page title of a built mockup. |
| `up` | Model up axis: `"z"` (OpenSCAD, default) or `"y"` (most GLB files). Front faces −Y in Z-up models. |
| `units` | Shown after the overall size. Default `mm`. |
| `views` | Camera buttons, in order. Stock names: `front`, `rear`, `left`, `right`, `top`, `bottom`, `iso` (shown as 3/4). Custom: `{ "name", "dir": [x, y, z] }`, a direction in model axes pointing from the model toward the camera. |
| `defaultView` | View on load. Default: the first in `views`, else `iso`. |
| `finishes` | Swatches. They recolour every part whose material is `finish`. The first is the default. |
| `spec` | Spec sheet sections. Each has a `title` and one of `rows` (label/value pairs), `items` (bullets) or `text`. A "Model data" section with size, part and triangle counts is always added. |

## Parts

| Field | Meaning |
|---|---|
| `id` | Unique, stable id. Used for file names (`<id>.stl`) and for remembered edits. |
| `name` | Shown in the parts list. |
| `group` | Group id. Parts in a group move together. Default: the part is its own group. |
| `material` | `finish`, `pcb-green`, `pcb-red`, `pcb-blue`, `pcb-black`, `pcb-purple`, `metal`, `brass`, `plastic-black`, `plastic-white`, `rubber`, `led`, `clear`, `#rrggbb`, or `keep` (GLB's own material). Default: guessed from the name. |
| `file` | STL, 3MF or GLB. Default `<id>.stl`. A 3MF with several objects becomes several parts (`<id>-1`, `<id>-2`, …). |
| `scad` | `{ "file", "defines" }`. `mockup build` renders it with these `-D` values and writes `<id>.stl`. The OpenSCAD edition renders it in the browser. |

## Groups

| Field | Meaning |
|---|---|
| `label` | Group heading. |
| `explode` | `[x, y, z]` offset in model units for the Exploded view. Groups without one are stacked automatically along the up axis, with the bulkiest group fixed. |
| `inside` | Behaviour in "See inside": `"hide"`, `"ghost"` (see-through) or `"none"`. Default: hide a group named lid/top/cover/cap, otherwise ghost the topmost group. |

## Getting a manifest without writing JSON

- `mockup init --scad case.scad` fills `parts` from the file's part selector (`part == "lid"` …).
- In either viewer, **Arrange** lets you set groups, offsets, materials and names visually; **Copy manifest** gives you the JSON.

## OpenSCAD conventions that work best

```openscad
part = "all";                 // selector; mockup renders each value as its own part
/* [Case] */
width = 70;  // [40:120]      ranges become number fields with limits
wall  = 2;   // Wall thickness  (a comment becomes the field's hint)
/* [Options] */
light_pipes = true;           // checkbox
style = "round"; // [round, square]   dropdown
/* [Hidden] */
eps = 0.01;                   // not shown

if (part == "base") base();
if (part == "lid")  lid();
if (part == "all")  { base(); lid(); }
```

Model boards and connectors as simple boxes in their real positions. They make the mockup readable.
