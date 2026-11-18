# Best Angle

**Drop in a pile of photos of yourself. Best Angle finds the most flattering one and tells you why.**

It checks every shot for the things photographers use to make anyone look their best (camera
height, face and body angle, arm position, lens distortion, expression, focus and light). Then it
ranks them for the goal you pick and lets you filter by the kind of photo you want ("full body,
big smile, looking at the camera"). Everything runs **inside your browser**: your photos are
never uploaded anywhere.

## Run it

**On your phone or any device:** open **<https://coderremarks.github.io/best-angle/>**.
It's the same static app. The photos are still analysed on the device itself.

**Locally on Windows:** double-click `start.bat`.
**Locally on any OS:** `python start.py` (Python 3.8+, standard library only).

Locally, your browser opens at <http://127.0.0.1:8765>. The first run downloads the AI models
(~25 MB), which the browser then caches.

## How to use it

1. **Add photos:** drag files or a whole folder onto the page, use *Add photos*, or paste.
   JPG, PNG, WebP and iPhone HEIC all work.
2. **Pick a goal:** *Most flattering*, *Professional* (LinkedIn/CV), *Dating profile*,
   *Social media* or *Sharpest shot*. Each goal weighs the factors differently.
3. **Pick tags (optional):** e.g. *Slimming angle* + *Half body* + *Big smile*. Tags in the same
   group mean "any of these"; different groups must all match. The numbers show how many photos
   have each tag.
4. **Read the top pick:** it shows the score, the reasons, and a *Full breakdown* with an overlay
   of what the AI measured, a score for every factor, and tips for your next photo.

Extras: *Only the best of each burst* collapses near-identical shots, and *Fine-tune what
matters* lets you change the weight of each factor.

## How it decides

| Factor | What it measures | Why it matters |
|---|---|---|
| Flattering angle | Camera height vs. your eye line, face turn, head tilt | A camera slightly above eye level slims the jaw and hides a double chin. A 15–35° face turn is slimmer than straight-on. |
| Slimming pose | Torso turn (3D shoulder/hip depth), elbows vs. waist | Square-on is the widest view of a body. Arms pressed flat against the sides widen the silhouette. |
| Natural proportions | Camera distance from EXIF focal length + face size; position in wide shots | At arm's length a wide phone lens enlarges the nose and mid-face. Wide lenses stretch people near the frame edges. |
| Expression | Eyes open/closed, smile, frown/scowl, mouth mid-word | A blink ruins any photo. The preferred smile depends on the goal. |
| Eye contact | Head pose + eye rotation | Looking into the lens, not at the screen. |
| Sharp focus | Variance of the Laplacian on the **eye region** | Viewers look at the eyes first. The measure is brightness-normalised so dark photos aren't mislabelled blurry. |
| Lighting | Exposure **relative to your other photos**, clipping, left/right balance | Skin tones differ, so "correct" brightness is learned from your own batch instead of a fixed number. |
| Framing | Face cut off, face resolution, eye line position | Basic composition. |

It never estimates body size. "Slimming" here means camera and pose technique only.

## Privacy and security

- **On-device AI.** Google MediaPipe (face mesh with 478 landmarks + 52 expression scores, and body
  pose with 33 landmarks) runs in WebAssembly/WebGL in the page. No server ever sees a photo.
- **The browser enforces it.** A Content-Security-Policy limits network access to the pinned
  library CDN and Google's model host, so the page has no way to send photos anywhere.
  MediaPipe **0.10.35** is used on purpose: the 1.x releases added usage telemetry
  (`odml.pa.googleapis.com`), which the policy would block, but there's no reason to ship it.
- **Pinned versions.** Every third-party file is loaded at an exact version (`js/config.js`), and
  the GitHub Actions in the deploy workflow are pinned to exact commit SHAs.
- **Safe rendering.** All text, including file names, goes into the DOM as text, never through
  `innerHTML`.
- **Local server only.** `start.py` binds to `127.0.0.1` (not your network). It serves only this
  folder and adds `nosniff`, `no-referrer`, frame-blocking and permissions-policy headers.

## Project layout

```
index.html          page + Content-Security-Policy
css/styles.css      design tokens, light/dark mode, responsive layout
js/
  main.js           state, analysis queue, event wiring
  pipeline.js       per photo: decode → detect → measure (canvas work)
  vision.js         loads the MediaPipe face + pose models (GPU, CPU fallback)
  ui.js, detail.js  rendering (sidebar, results grid, breakdown dialog)
  config.js         pinned URLs, sizes, timeouts
  lib/              pure logic, no DOM; unit-tested in Node
    face.js         head pose from the 3D transform, eyes, smile, tension, gaze
    pose.js         framing, torso turn, arms-against-body
    lens.js         focal length → camera distance, edge position
    imagestats.js   sharpness, exposure, perceptual hash
    scoring.js      scoring curves, goal presets, overall score + reasons/tips
    tags.js         auto-tags and the filter catalogue
    ranking.js      filtering (OR within a group, AND across), ranking, burst grouping
tests/              node:test suites for everything in js/lib
start.py, start.bat local server
.github/workflows/  CI: tests on every push/PR; on main, deploys the app files to GitHub Pages
```

## Tests

```bash
npm test
```

or `node --test "tests/*.test.js"` (Node 22+, no dependencies). CI runs them on every push, and
a failing test blocks the deploy. The tests cover the geometry
(head pose from synthetic rotation matrices, including the off-axis "face high in a wide frame"
case), the scoring rules (camera above beats below, blink is a deal-breaker, exposure is batch-
relative, custom weights re-rank), and the filtering and burst-grouping semantics.

## Design decisions

- **No framework, no build step.** Plain ES modules keep the app small, fast to load and easy to
  audit. There's nothing to `npm install` to run it.
- **Pure core, thin shell.** Everything that decides a score lives in `js/lib` as pure functions
  over plain numbers, so it is testable without a browser or real photos. The browser code only
  turns pixels into those numbers.
- **Explainable scores.** Every rule is a readable piecewise-linear curve
  (`[measurement, score]` knots in `scoring.js`). Every point a photo gains or loses comes with a
  sentence the UI can show.
- **Small faces still work.** The face model is tuned for faces that fill the frame, so for full-body
  shots the app finds the person with the pose model, zooms into the head, and runs the face model
  again.
- **Fast batches.** Full-resolution pixels are released after each photo, and only a thumbnail and
  the measurements are kept. Thumbnails use the synchronous JPEG encoder: `canvas.toBlob()` waited
  for idle time and added about 1 s per photo while the page was busy analysing.

## Limitations

- In group photos it judges the most prominent face, which is usually, but not always, you.
- Faces in full profile, facing away, or covered can't be read. Those photos go to *No face found*.
- Camera distance needs EXIF data. Screenshots and photos sent through chat apps have it
  stripped, so the lens check is skipped for them.
- It scores photographic technique. It can't know which photo *you* like most.

## Credits

[MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe) (Apache-2.0),
[exifr](https://github.com/MikeKovarik/exifr) (MIT),
[heic-to](https://github.com/hoppergee/heic-to) / libheif (LGPL-3.0, loaded at runtime only for HEIC files).
