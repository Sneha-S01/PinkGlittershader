# Pixel Pink — holo business card shader

A tilt-reactive holographic business card. The artwork is a single procedural
fragment shader — no textures — and the card itself is a real three.js object
with thickness, a rounded bevel and studio lighting.

The tilt/foil technique on the face is adapted from
[DongGukMon/TiltHologramCard](https://github.com/DongGukMon/TiltHologramCard)
(React Native + Skia). The physical card — geometry, lighting, tone mapping —
follows the cards on [ramp.design](https://ramp.design).

## Run

```bash
npm install
node server.mjs
```

Then open <http://localhost:5178>. (ES modules need a server; `file://` won't
work.) three.js is served from `vendor/` through an import map — there is no
build step, and nothing is bundled.

`npm install` is only there to pull three.js in for upgrades. To move to a new
version, install it and copy the two build files across:

```bash
cp node_modules/three/build/three.module.min.js node_modules/three/build/three.core.min.js vendor/
```

## Deploy

Any static host works — the repo root *is* the site. On Vercel: import the
repo, no build command, output directory `.` (`vercel.json` pins this, so the
dashboard settings don't matter).

`vendor/` is committed on purpose. Hosts don't serve `node_modules`, so an
import map pointing into it 404s on the deployed site even though it works
locally; `node_modules/` stays ignored.

## Art direction

Press <kbd>H</kbd> for the live panel. Every slider maps to a uniform; **copy
json** dumps the current state so you can paste it back into `src/config.js`.
From the console, `__card.sparkle = 1.2` works too.

The look is built in layers, bottom to top:

| Layer | Dial |
| --- | --- |
| Pastel mesh gradient — pink → powder sky blue, parallaxes on tilt | — |
| Pink aura bloom | `aura` |
| Soft light fan from above | `rays` |
| Drifting haze along the lower edge | `mist` |
| Holographic hue travel — peach base, cool notes on tilt | `holo`, `spread` |
| Tinted light and shade | `shade` |
| Hidden star lattice the tilt sweeps in and out | `motif`, `reveal` |
| Star field — three tiers of soft four-point twinkles, blinking on tilt | `sparkle`, `starDensity`, `twinkle`, `glow`, `cyber` |
| Specular glint, grazing-angle lift, die-cut edge | `spec`, `fresnel`, `micro`, `bevel` |
| Rim light, vignette, fine grain | `rim`, `vignette`, `grain` |

Some decisions worth knowing about:

- **The foil phase is closed-form.** It's a linear ramp across the card plus a
  gentle quadratic bow, driven by tilt — no noise anywhere. An earlier version
  warped the phase with fbm, which marbled the surface and made it *swim* as
  the card turned. Smooth functions glide instead. `cos()` also means the
  spectrum wraps seamlessly however far tilt drives the phase; there is no
  `fract()` to produce a seam.
- **The iridescence is chroma-only, and palette-constrained.** It adds
  `iris - luma(iris)`, leaving luminance alone — an `overlay` blend muddies
  pastels. And the spectrum cycles pink → lilac → sky → cream rather than a
  full rainbow, because a full cosine rainbow drags green through the middle
  and reads as oil slick rather than foil.
- **The hidden motif is what actually reads as holographic.** A smooth
  colour shift alone doesn't; the eye needs something to *appear*. So a
  scattered field of outlined four-point stars is gated by a band whose
  position is driven mostly by tilt — turning the card sweeps them in and out.
  Offset, scale, rotation and reveal angle all vary per cell; on a rigid grid
  with identical stars the same effect reads as wallpaper, and each star
  needs to arrive at its own angle rather than the whole field blinking at
  once. `reveal` controls how tightly that band is gated: low is a broad
  wash, high is a narrow window that snaps past. The stars use an exact star
  SDF (Inigo Quilez's `sdStar`); tracing `sqrt|x| + sqrt|y| = 1` and
  normalising by its gradient does not work, because that gradient is singular
  along both axes and fills the interior.
- **Peach pink is the resting colour; two cool notes are what travel.**
  `holoRamp` is a five-stop cyclic palette — peach, coral, pink, then lilac
  and powder blue — mixed over the sky gradient by a phase the tilt drives
  hard enough to walk the whole cycle. Three of the five stops are pink-family
  and the sky gradient is entirely pink-family, so pink stays the impression
  and only two other hues ever pass through. More accents than that and it
  stops reading as a colourway and starts reading as a rainbow.
- **The ramp's lobes are narrowed with `pow(w, 3)` and renormalised.** With
  plain cosine weights every stop contributes at every phase, the result never
  reaches a hue, and the card greys out in the middle. Raising the lobes and
  dividing by the actual weight sum keeps it seamless but lets each stop
  actually arrive.
- **Light and shade are tinted, never white.** The crest runs warm and the
  trough cool (`shade`), which gives the surface dimension. A plain luminance
  sweep (`sweep`) is off by default — as a white crest it painted a broad
  diagonal across the middle.
- **Sparkles blink on tilt, not just on a clock.** Each one advances its
  twinkle phase with the tilt angle at its own rate, so turning the card pops
  different stars in and out instead of dimming the whole field together.
  `twinkle` at 0 holds them all steady; near 1 they go fully dark between
  beats, which is why `starDensity` sits high — more of them, fewer lit at
  any moment.
- **Sparkle cores are composited opaque, not screened.** White screened over a
  pale pastel barely moves it, so the cores are a `mix` toward white and only
  the bloom is screened. The shape is a round core plus two hairline rays that
  fall off slowly along their own axis and fast across it.

- **The lighting reacts to an eased tilt, the card doesn't.** `easeTilt`
  raises the tilt to the power 1.85 before the colour and light layers see
  it, so a small pointer move barely disturbs the surface while the extremes
  still reach full travel. The card's own 3D rotation stays linear and keeps
  tracking the pointer one-to-one — only the light lags behind. Raise the
  exponent for an even calmer centre; drop it to 1.0 for the old linear
  response.
## Material

The artwork is one thing; the material it sits on is another. These layers add
the second without touching the first — no palette value, gradient anchor, star
position or motif parameter is involved in any of them.

- **A surface normal the light reads and the artwork doesn't.** Three scales,
  all tiny: a broad undulation so the laminate isn't dead flat, lenticular
  ridging running across the grating direction, and a micro roughness that
  stops the gloss looking machined. Nothing is displaced — the normal only
  feeds the specular.
- **One soft key light that slides with the tilt.** A tight glint riding
  inside a broad softbox lobe, warm white, screened at about 20% peak. The
  highlight's position comes from the half-vector, so it glides across the
  face as the cursor moves rather than fading in place. The glitter picks up
  a little of it too — sparkle amplitude scales with the local specular, so
  stars flare slightly as the highlight passes over them.
- **Grazing incidence carries the Fresnel.** A flat card viewed head-on has
  almost none, so most of it comes from tilt magnitude rather than screen
  position. That is also when real foil lights up, and it means the resting
  appearance is unchanged — the lift only arrives once you tilt.
## The physical card

Examined against ramp.design: their cards look real because they *are* 3D
objects, not flat images with effects painted on. None of the realism is a
drop shadow — their hero has none. It comes from geometry catching light.
`src/lib/scene.js` follows the same recipe:

- **A real body, at Apple Card thickness.** ISO ID-1 is ~0.8mm on a 53.98mm
  height, so `thickness` is 0.032 on a card 2.125 tall — about 1.5%. ramp's
  cards are roughly five times that (0.11 plus a 0.028 bevel each side), which
  reads as a slab rather than a card. The edge is a fully rounded 0.011 bevel,
  like the polished rim of the titanium card: at rest you see a hairline, and
  edge-on during the flip a thin sliver. The bevel grows outward from the face, so the face
  outline is inset by it to keep the card's outer size and corner radius what
  they were.
- **Smoothed normals.** ExtrudeGeometry is non-indexed, so its own normals are
  per-facet and the bevel shades in bands. Its bevel profile is tangent to the
  face at one end and to the wall at the other, so averaging normals by shared
  position gives one continuous rounded edge.
- **Three lighting modes, one dial.** `lighting` (in the panel's material
  group) switches between them live. **2, gloss, is the default.**

  **2 — gloss: one soft sheen in a clear coat.** Built from what worked and
  didn't in ramp's rig. Theirs gave the card a convincing glossy surface but
  faded the pastels, dimmed the stars, and reflected several lights at once — a
  hard spot from the key light, a pale panel from a studio strip. A first pass
  blurred all the panels together, which removed the shapes but left an uneven,
  multi-lobed wash. So:
  - the artwork is the face's **emissive** term, not a lit colour: no light can
    fade the pink or dim a star, and away from the highlight the face is exactly
    what the shader painted. The diffuse base is black; everything lighting
    adds is reflection. The coat takes ~4% off what's beneath it head-on, which
    the emissive hands back.
  - the environment is **one light** in a plain surround, and nothing else —
    no directional lights, no panels. Tilting turns a reflection by twice the
    tilt, so it glides across and off the card.
  - the light is a **long vertical sheen, not a disc**. A round highlight read
    as a lamp: on a pastel already near white its core burned to a white sun,
    at any strength that still showed. The sheen is Gaussian across (σ 0.05
    rad, about a third of the card) and runs far past the card's top and bottom
    (σ 0.6 rad vs ~0.12 of card), so it has no ends and no core — only a soft
    band of gloss, leaned 0.2 rad off vertical. A broad, blurred wash was the
    other failure: on a pastel it just reads as a faded patch.
  - the surround is **dim straight ahead and bright toward the sides**. The face
    only ever reflects the dim part; the rounded edge, at its grazing angle,
    reflects the bright part. Dim everywhere, the edge printed as a dark
    outline; bright everywhere, the face washed.
  - the coat is **mirror-smooth** (clear-coat roughness 0.04) with **no bump
    map**: taken from the artwork, the bump carried the anti-banding grain and
    colour-band edges into the reflection and mottled it. The base layer is
    rougher (0.45) and adds only a faint bloom around the core.
  - the edge has **no thin-film iridescence**; along a rounded edge it split the
    light into a rainbow.
  - the painted pinpoint glint (`spec`) is off, so this light is the only one.
  `gloss` (1.0) is the sheen's strength, set so its peak stays just under
  clipping on the pastel.

  **1 — ramp.design's, exactly.** Read from their code: the `StudioEnvironment`
  behind both their hero cards and their metal-card viewer. Eight emissive
  panels rendered into an environment map at 256: a near-black room (0.02),
  two tall vertical softboxes (2.5 and 4.6), a thin hot strip (5.0), a black
  flag between them, a near-black back panel, a soft overhead ring (0.75) and a
  low front strip (1.2). Direct lights are weak — ambient 0.36, a key at
  (−4, 5, 7) of 0.34, and their homepage's frontal fill (0.28) at (0, 1.2, 8).
  ACES filmic at 0.9 exposure. The face is *lit*, as theirs is: a physical
  material with the artwork as colour and bump map (their bumpScale 0.12),
  metalness 0.15, roughness 0.48, a full clear coat. The finish is chosen from
  their preset ranges — their per-design finish isn't exposed in the code.
  Under real light the shader's painted glint and light/shade band would be
  lit twice, so `spec` and `shade` are overridden to 0 in this mode.

  On this design it washes out: their rig is tuned for saturated artwork, and
  on a pastel the clear coat's reflection of the bright front strips plus ACES
  desaturation turns pink toward grey-mauve.

  **0 — the soft studio.** The earlier tuning: the same panels with the room lit
  to 0.55 and ambient at 0.7, Khronos PBR Neutral tone mapping (it leaves base
  colours alone and only rolls off highlights), and the face unlit, showing
  exactly what the artwork shader paints.
- **The face print wraps the edge** in both. The bevel and side walls sample the
  face texture at the clamped edge UV, so every point of the edge is the colour
  of the face beside it, then shaded under a clear coat and a faint pearl. The
  texture holds display values, so lit materials decode it to linear first.
- **The caps are split.** ExtrudeGeometry puts both faces in one group; the back
  cap's triangles come first, then the front's, equal in number. They're split
  into their own groups so each side carries its own material, and the back's U
  is mirrored so it reads the right way round from behind.
- **Shadows kept, moved into the scene, pulled in.** The contact stack and a
  soft cast are drawn once into canvases. The **contact layers turn with the
  card**, in its own plane, the way the original CSS box-shadow did on the
  tilting element: their dense core lies exactly under the card's silhouette
  at every angle, so the card always covers it. Laid flat on the backdrop
  instead, perspective shrank the card's far edge a few pixels on every tilt
  and exposed that core as a grey slab. Only the soft cast sits on a backdrop
  plane and slides. The widest contact layer is gone and the cast is narrower and
  lower: blur spreads in every direction, and those two hazed the white above
  and beside the card into what read as a **grey mat** behind it. Now the
  shadow only shows underneath. They are drawn in their own pass with depth
  cleared after, so the card always lands on top — see the flip, below.
- **Camera matched to the page.** Field of view is ramp's 34°, and the camera
  distance is solved each resize so the card lands at exactly its CSS size.
  The invisible `.card-rig` keeps tilting in step with a perspective matched to
  that camera, so anything put in `#content` later will sit on the face.

Tilt is capped at 14°, reached at the card's edge.

## Flip

Click, tap, or <kbd>Enter</kbd>/<kbd>Space</kbd> on the card. A drag of more than
6px is a tilt, not a click.

It is ramp.design's turn, read from their code: yaw 0 → π over **620ms** on an
ease-in-out cubic (their `TURN_FLIP_MS` and `tG`), about the card's own
vertical axis, with the tilt taken out for the duration — here it fades out as
`1 − sin(flip)` and back in as the card lands. Nothing else moves: no lift, no
wobble. It reads as real because the card is real; mid-turn you see its
thickness and the edges pick up the studio.

- **The back** is the same foil seen from the other side: the face shader runs a
  second time with `uFace = 1`, which mirrors its frame and offsets every
  random seed and the hue phase. Only the side facing the camera is painted,
  except mid-turn. The caps share one geometry group, so the face material
  picks a texture by the object-space normal, and reads the back with
  `1 − u` because its UVs run the wrong way when seen from behind.
- **The shadow narrows** with the turn. The contact layers turn with the card,
  so they go edge-on with it; the soft cast is squashed by `0.06 + 0.94·|cos|`,
  since a card edge-on casts almost nothing.
- **Separate shadow pass.** Mid-turn the card's far edge swings well behind the
  backdrop plane. Sharing a depth buffer let the shadow paint over that part of
  the card as a dark band with a hard vertical edge; drawing the backdrop first
  and clearing depth fixes it for any angle.
- `#content` turns with the card and hides its back face, so front copy flips
  away with it.

`__flipState()` in the console reports the current angle.

## Structure

```
index.html
server.mjs                  dependency-free static server
package.json                three.js, pinned to r180
src/config.js               all art-direction values + panel schema
src/main.js                 render loop, uniform wiring
src/lib/scene.js            three.js card: geometry, studio, face pass, shadows
src/lib/tilt.js             pointer / gyroscope / idle-drift spring
src/lib/panel.js            the H panel
src/shaders/card.frag.js    the card
```

`#content` is empty on purpose — the card face is finished, the copy and
photo are not written yet.

## Tilt

Pointer on desktop; `deviceorientation` on mobile (iOS shows an **enable tilt**
button first, since it requires a user gesture). With no input for ~2s the card
falls into a slow lissajous drift so it stays alive on a wall display.
