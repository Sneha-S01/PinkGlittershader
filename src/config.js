/**
 * Art direction dials.
 * Every value here is live-editable from the panel (press H) and maps 1:1
 * to a uniform in src/shaders/card.frag.js.
 */
export const config = {
  // --- foil ---
  holo:       0.62,  // how far the tilt pulls colour off the peach base
  spread:     1.30,  // how many hue bands sit across the card
  sweep:      0.00,  // white sheen crest — off; read as a white diagonal
  shade:      0.60,  // tinted light/shade, warm crest and cool trough
  motif:      0.75,  // hidden star lattice that the tilt sweeps in and out
  reveal:     0.65,  // how tightly the reveal band is gated
  rim:        0.00,  // edge light — off; it read as a white border

  // --- sky ---
  aura:       0.40,  // pink bloom
  rays:       0.28,  // soft light fan from above
  mist:       0.32,  // drifting haze along the lower edge

  // --- stars ---
  sparkle:    1.05,  // overall star field brightness
  starDensity: 0.82,
  twinkle:    0.88,
  glow:       0.60,  // soft halo around each sparkle
  cyber:      0.30,  // how often a sparkle carries a cyan / magenta tint

  // --- material ---
  spec:       0.75,  // gloss highlight that glides with the cursor
  fresnel:    0.65,  // how much grazing angles lift the sheen and iridescence
  micro:      0.55,  // micro-roughness in the gloss only, never in the artwork
  thickness:  0.032, // whole card, world units on a 2.125 height: ~0.8mm, an Apple Card
  edgeShine:  1.25,  // how strongly the bevel and sides pick up the studio strips
  lighting:   2,     // 0 soft studio, 1 ramp.design's exactly, 2 gloss (no visible lights)
  gloss:      1.00,  // gloss mode: strength of the sheen reflected in the coat

  // --- finish ---
  grain:      0.55,  // fine static grain, keeps the gradient from banding
  vignette:   0.35,

  // --- motion ---
  maxAngle:   14,    // deg of tilt at the extremes
  stiffness:  0.070,
  damping:    0.87,
  idleDrift:  0.65,  // slow lissajous when the pointer is away
};

/** [min, max, step] for each panel slider, grouped for layout. */
export const schema = [
  ['foil', [
    ['holo',         0, 1.6, 0.01],
    ['spread',     0.2, 4.0, 0.01],
    ['sweep',        0, 1.4, 0.01],
    ['shade',        0, 1.5, 0.01],
    ['motif',        0,   1, 0.01],
    ['reveal',       0,   1, 0.01],
    ['rim',          0, 1.4, 0.01],
  ]],
  ['sky', [
    ['aura',         0,   1, 0.01],
    ['rays',         0,   1, 0.01],
    ['mist',         0,   1, 0.01],
  ]],
  ['stars', [
    ['sparkle',      0, 1.6, 0.01],
    ['starDensity',  0,   1, 0.01],
    ['twinkle',      0,   1, 0.01],
    ['glow',         0, 1.5, 0.01],
    ['cyber',        0,   1, 0.01],
  ]],
  ['material', [
    ['spec',         0, 1.5, 0.01],
    ['fresnel',      0, 1.5, 0.01],
    ['micro',        0,   1, 0.01],
    ['thickness', 0.024, 0.20, 0.001],
    ['edgeShine',    0,   3, 0.01],
    ['lighting',     0,   2, 1],
    ['gloss',        0,   3, 0.01],
  ]],
  ['finish', [
    ['grain',        0,   1, 0.01],
    ['vignette',     0,   1, 0.01],
  ]],
  ['motion', [
    ['maxAngle',     0,  26, 0.5],
    ['stiffness', 0.01, 0.3, 0.005],
    ['damping',    0.5,0.96, 0.01],
    ['idleDrift',    0,   1, 0.01],
  ]],
];

export const defaults = { ...config };
