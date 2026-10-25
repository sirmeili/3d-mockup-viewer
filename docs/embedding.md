# Embedding the viewer in another app

A host page can put the viewer in an iframe and drive it with `postMessage`: load a model, switch views, open Arrange, and get the edited manifest back. The helper `embed.js` wraps the messages in a small promise API.

Embedding is **off by default**. A viewer page only listens to a parent frame whose origin you allowed, so the published Claude artifacts and ordinary mockup pages are unaffected.

## Quick start

```js
import { embedViewer } from '3d-mockup-viewer/embed';   // or dist/embed.js, served next to your page

const viewer = embedViewer(document.getElementById('model'), { src: '/mockup/viewer.html', height: '600px' });

await viewer.ready;                                     // the viewer has started and accepts commands
const info = await viewer.load('/mockup/manifest.json'); // {parts, groups, size, units, warnings}
await viewer.setMode('exploded');
viewer.on('change', ({ manifest }) => saveManifest(manifest)); // after Arrange edits, debounced
```

`src` is a viewer page: `viewer.html` (from `dist/` or `mockup viewer <dir>`), `openscad/viewer.html` for the OpenSCAD edition, or a built mockup page. The helper adds `?parent=<your origin>` to it.

## Allowing a host

The viewer accepts messages only from its direct parent frame, and only when the parent's origin is on its list. There are two ways to set the list:

| Way | How | Use it when |
|---|---|---|
| `?parent=` | `viewer.html?parent=https://tracker.lan` (comma-separated for several). `embedViewer` adds it for you. | The viewer is on a static host with nothing private on its origin: GitHub Pages, a plain folder. |
| Build time | `mockup viewer <dir> --embed-origin https://tracker.lan` (also on `init` and `build`; repeatable), or `renderPage({ embedOrigins })`. Pass `addParent: false` to `embedViewer`. | The viewer is served by an app that has cookies or private data on the same origin. |

With a build-time list, `?parent=` is ignored.

**Why the build-time list matters.** Anyone can frame a page and choose its `?parent=` value. Loads requested by a `?parent=` host are therefore fetched without cookies (`credentials: 'omit'`), so a page that frames your viewer can't use it to read cookie-protected files on the viewer's origin. A build-time list is fixed by you, so those loads send cookies as usual. If your app serves the viewer, also set a `Content-Security-Policy: frame-ancestors` header that lists the hosts allowed to frame it.

## Helper API

`embedViewer(el, opts)` appends an iframe to `el` and returns a viewer object.

| Option | Default | Meaning |
|---|---|---|
| `src` | required | Viewer page URL, relative to the host page or absolute. |
| `height` | `'600px'` | iframe height. The width fills `el`. |
| `title` | `'3D model viewer'` | iframe title for screen readers. |
| `addParent` | `true` | Add `?parent=<this origin>` to `src`. Set `false` when the viewer was built with `--embed-origin`. |
| `timeout` | `30000` | Milliseconds to wait for `ready` before `viewer.ready` rejects with code `timeout`. |

Every command method returns a promise. It resolves with the viewer's result, or rejects with an `Error` that has a `code` (see [Errors](#errors)). Commands sent before `ready` wait for it. The viewer runs commands one at a time, in the order sent.

| Method | Result |
|---|---|
| `load(manifestUrl)` | Loads a manifest and its part files from a URL. Part files resolve next to the manifest. In the OpenSCAD edition, parts with no STL are rendered from their `scad` source. Resolves with a [model summary](#model-summary). |
| `load({ manifest, files, base })` | `manifest`: an object, a URL, or `null` (each file becomes a part, as with Load files). `files`: `{ "name.stl": data }`, where each value is an `ArrayBuffer` (transferred: your copy becomes empty), a typed array (copied), or a URL. `.scad` files go to the OpenSCAD edition, which renders them. `base`: the URL that relative file URLs resolve against (default: the manifest URL if it is one, else this page). |
| `setMode(mode)` | `'assembled'`, `'exploded'` or `'inside'`. |
| `setView(view)` | A view button's name: a stock view (`front`, `rear`, `left`, `right`, `top`, `bottom`, `iso`) listed in the manifest, or a custom view's name in slug form (`"Port side"` → `port-side`). |
| `setFinish(finish)` | A finish name from the manifest (any case), or a `#rrggbb` colour. |
| `setCut(axis, position?)` | `axis`: `'off'`, `'x'`, `'y'` or `'z'`. `position`: 0 to 1 across the model (default: unchanged, 0.5 at first). |
| `setArrange(on)` | Opens or closes Arrange. |
| `getManifest()` | The full current manifest, including Arrange edits: what **Copy manifest** produces. |
| `scad.setValues({ name: value })` | OpenSCAD edition. Sets editable top-level values. Numbers, booleans and strings must match each value's type. It's all or nothing: one bad name or type and nothing changes. Resolves with `{ values }`, every current value. Doesn't render. |
| `scad.render()` | OpenSCAD edition. Re-renders every part with the current values. Resolves with a model summary. |
| `send(type, body)` | Sends a raw message (see [Protocol](#protocol)). |
| `on(event, fn)` / `off(event, fn)` | Event listeners. `on` returns an unsubscribe function. |
| `destroy()` | Removes the iframe and rejects pending commands. |
| `iframe`, `info` | The iframe element, and the last `ready` payload. |

URL strings are resolved against the host page before they are sent, so `load('mockup/manifest.json')` means the same thing it would in a link on your page. The viewer fetches URLs itself, so they must be reachable from its origin: same origin, or served with CORS headers.

### Events

| Event | Payload | When |
|---|---|---|
| `ready` | `{ edition: 'standard' \| 'openscad', viewerVersion, model }` | Once the page has started and loaded its own model, if it has one (`model` is then a summary, else `null`). |
| `loaded` | Model summary | After every model build: host `load`, the user's Load files or drag-and-drop, an OpenSCAD render. |
| `change` | `{ manifest }` | About 400 ms after the last edit in Arrange or the manifest editor (names, groups, explode offsets, see-inside, materials, page text, Reset, Undo and Redo). |
| `error` | `{ code, message, warnings? }` | Failures not caused by a host command, such as the page's own model failing to load. Command failures reject the command's promise instead. |

### Model summary

```json
{
  "parts": 9,
  "groups": [{ "id": "lid", "label": "Lid", "parts": ["lid", "pipes"] }],
  "size": [92, 64, 38.5],
  "units": "mm",
  "warnings": []
}
```

`size` is the assembled overall size in model axes (X, Y, then the up axis). `warnings` are the messages shown under the controls, such as a file that couldn't be read.

### Errors

| Code | Meaning |
|---|---|
| `timeout` | (helper) No `ready` in time. Check `src`, and that this origin is allowed. |
| `version` | Protocol version mismatch between helper and viewer. |
| `unknown-type` | The viewer doesn't know that message type. |
| `bad-value` | A command argument is missing or out of range; the message says what's allowed. |
| `no-model` | The command needs a loaded model. |
| `no-parts` | `load` finished without any parts. `error.warnings` says why. |
| `unsupported` | `scad.*` sent to the standard edition. |
| `no-scad`, `bad-values` | `scad.setValues`: no OpenSCAD model loaded, or names and types that don't match. |
| `render-failed` | `scad.render` produced no geometry. The viewer's "OpenSCAD output" panel has the log. |
| `destroyed` | (helper) `destroy()` was called. |
| `failed` | Anything else, such as a URL that returned 404. |

## Protocol

For hosts that don't use `embed.js`. Every message is a plain object with `protocol: 'mockup-viewer'` and `version: 1`. The viewer ignores messages without them.

Host → viewer, posted to the iframe's `contentWindow` with the viewer's origin as `targetOrigin`:

```js
{ protocol: 'mockup-viewer', version: 1, id: 7, type: 'setMode', mode: 'exploded' }
```

`type` is one of `load`, `setMode`, `setView`, `setFinish`, `setCut`, `setArrange`, `getManifest`, `scad.setValues` or `scad.render`. The arguments are fields next to it, named as in the helper: `manifest`, `files`, `base`, `mode`, `view`, `finish`, `axis`, `position`, `on`, `values`. `id` is optional; without one, no reply is sent.

Viewer → host replies:

```js
{ protocol: 'mockup-viewer', version: 1, type: 'reply', id: 7, ok: true, result: { mode: 'exploded' } }
{ protocol: 'mockup-viewer', version: 1, type: 'reply', id: 8, ok: false, error: { code: 'bad-value', message: '…' } }
```

Events look the same with `type` set to `ready`, `loaded`, `change` or `error`, and the payload fields alongside. A host must check `event.source === iframe.contentWindow` and `event.origin` before trusting a message.

A breaking change to the protocol increases `version`. The viewer answers a different version with a `version` error.

## Notes

- Arrange edits are still remembered in the viewer's browser storage per model, as they are when the viewer isn't embedded. `getManifest()` and `change` include them, so the host can save the manifest and later reload it with the edits built in.
- The viewer shows its normal page, header and spec sheet included. A compact display-only embed is planned separately ([SPEC.md](SPEC.md), planned work item 5).
- Query strings don't reach pages inside Claude artifacts, so the published artifacts can't be embedded this way.
