export default /* glsl */ `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2  uRes;        // drawing buffer size, px
uniform float uAspect;     // card w / h
uniform float uTime;       // seconds
uniform vec2  uTilt;       // -1..1  (x = yaw, y = pitch)

uniform float uHolo, uSpread, uSweep, uShade, uMotif, uReveal, uRim;
uniform float uAura, uRays, uMist;
uniform float uSparkle, uStarDensity, uTwinkle, uGlow, uCyber;
uniform float uGrain, uVignette;
uniform float uSpec, uMicro, uBevel, uFresnel;
uniform float uRadius;     // corner radius, in card-height units
uniform float uOpaque;     // 1 when rendering the face texture for the 3D card
uniform float uFace;       // 0 = front, 1 = back

#define TAU 6.28318530718
#define PI  3.14159265359

/* ---------------------------------------------------------------
   Palette — pastel pink washed into powder sky blue.
---------------------------------------------------------------- */
const vec3 C_CREAM = vec3(1.000, 0.925, 0.902);   // blush cream
const vec3 C_PEACH = vec3(1.000, 0.820, 0.847);   // peach, already leaning pink
const vec3 C_CORAL = vec3(1.000, 0.722, 0.745);
const vec3 C_PINK  = vec3(0.988, 0.663, 0.745);   // the dominant note
const vec3 C_ROSE  = vec3(0.969, 0.627, 0.706);
const vec3 C_LILAC = vec3(0.835, 0.745, 0.949);   // accent one
const vec3 C_SKY   = vec3(0.706, 0.867, 0.949);   // accent two
const vec3 C_CYAN  = vec3(0.855, 0.965, 1.000);
const vec3 C_MAG   = vec3(1.000, 0.796, 0.886);

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

/* --------------------------- noise ---------------------------- */
float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}
vec2 hash22(vec2 p) {
  vec3 a = fract(vec3(p.xyx) * vec3(443.897, 441.423, 437.195));
  a += dot(a, a.yzx + 19.19);
  return fract(vec2((a.x + a.y) * a.z, (a.x + a.z) * a.y));
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1, 0));
  float c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, amp = 0.5;
  for (int i = 0; i < 4; i++) { v += amp * vnoise(p); p = p * 2.03 + 17.3; amp *= 0.5; }
  return v;
}

/* Ease the tilt that the lighting reacts to. A linear response makes a
   small pointer move swing a good part of the hue cycle; a soft centre
   keeps slight tilts calm while the extremes still reach full travel.
   The card's own 3D rotation stays linear, so it still tracks the
   pointer one-to-one — only the light lags behind. */
vec2 easeTilt(vec2 v) {
  v = clamp(v, -1.0, 1.0);
  return sign(v) * pow(abs(v), vec2(1.85));
}

float rrect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

/* Soft four-point twinkle: a round core with two tapering cross rays.
   Everything is an exponential, so it has no edge to alias. */
float twinkle(vec2 q, float r, float rayFall) {
  q /= r;
  float core = exp(-dot(q, q) * 5.0);
  // rays fall off slowly along their own axis and fast across it, so
  // they reach a few radii out while staying a hairline wide
  float ax = exp(-abs(q.x) * rayFall) * exp(-q.y * q.y * 42.0);
  float ay = exp(-abs(q.y) * rayFall) * exp(-q.x * q.x * 42.0);
  return core + (ax + ay) * 0.70;
}

/* Exact signed distance to an n-pointed star (Inigo Quilez).
   An earlier version traced sqrt|x| + sqrt|y| = 1 and normalised by the
   gradient, but that gradient is singular along both axes, so the whole
   interior came out filled. A real SDF makes the stroke trivial: it is
   just abs(d) < width, and the width is even all the way round.
   m controls pointiness: m = 2 is the regular polygon, m -> n is a
   sliver-armed star. 3.0 of 4 puts the concave waist at ~0.30r, wide
   enough for the stroke to read as an outline rather than a fill. */
float sdStar(vec2 p, float r, float n, float m) {
  float an = PI / n;
  float en = PI / m;
  vec2 acs = vec2(cos(an), sin(an));
  vec2 ecs = vec2(cos(en), sin(en));
  float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
  p = length(p) * vec2(cos(bn), abs(sin(bn)));
  p -= r * acs;
  p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
  return length(p) * sign(p.x);
}

vec3 screenBlend(vec3 b, vec3 s) { return 1.0 - (1.0 - b) * (1.0 - s); }

/* The holographic hue cycle: peach -> coral -> blush -> lilac ->
   periwinkle -> powder blue -> back to peach. Six cyclic cosine
   weights sum to a constant, so it wraps seamlessly however far the
   tilt drives the phase — no fract(), no seam. Half the stops are
   peach-family, which is what keeps peach the resting impression while
   the cool notes only pass through. */
vec3 holoRamp(float x) {
  float a = TAU * x;
  // Raising the lobes narrows them: with plain cosine weights every stop
  // contributes at once, the blend never reaches a hue and the card greys
  // out. Renormalising by the real weight sum keeps it seamless.
  const float K = 3.0;
  float w0 = pow(0.5 + 0.5 * cos(a),                   K);   // peach
  float w1 = pow(0.5 + 0.5 * cos(a - TAU * 0.2),       K);   // coral
  float w2 = pow(0.5 + 0.5 * cos(a - TAU * 0.4),       K);   // pink
  float w3 = pow(0.5 + 0.5 * cos(a - TAU * 0.6),       K);   // lilac
  float w4 = pow(0.5 + 0.5 * cos(a - TAU * 0.8),       K);   // powder blue
  vec3 sum = C_PEACH * w0 + C_CORAL * w1 + C_PINK * w2
           + C_LILAC * w3 + C_SKY   * w4;
  return sum / max(w0 + w1 + w2 + w3 + w4, 1e-4);
}


vec3 meshGradient(vec2 s, vec2 drift) {
  vec2  P[7];  vec3 C[7];  float R[7];  float K[7];
  P[0] = vec2(0.08, 0.96); C[0] = C_CREAM; R[0] = 0.62; K[0] = 0.30;
  P[1] = vec2(0.92, 0.98); C[1] = C_PEACH; R[1] = 0.62; K[1] = 0.90;
  P[2] = vec2(0.00, 0.14); C[2] = C_CORAL; R[2] = 0.64; K[2] = 0.55;
  P[3] = vec2(0.36, 0.00); C[3] = C_ROSE;  R[3] = 0.48; K[3] = 0.75;
  P[4] = vec2(0.82, 0.04); C[4] = C_PINK;  R[4] = 0.56; K[4] = 1.05;
  P[5] = vec2(0.46, 0.58); C[5] = C_PEACH; R[5] = 0.56; K[5] = 0.18;
  P[6] = vec2(1.08, 0.52); C[6] = C_LILAC; R[6] = 0.46; K[6] = 0.75;

  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 7; i++) {
    vec2 q = vec2(P[i].x * uAspect, P[i].y) + drift * K[i];
    float d = length(s - q) / R[i];
    float w = exp(-d * d * 3.0);
    acc += C[i] * w;
    wsum += w;
  }
  return acc / max(wsum, 1e-4);
}

/* ---------------------------------------------------------------
   Scattered star motif.
   Same jitter treatment as the sparkle field — offset, scale, rotation
   and reveal angle all vary per cell — otherwise a rigid lattice of
   identical stars reads as wallpaper rather than foil. The 3x3 sweep
   catches stars whose arms cross a cell boundary; the distance reject
   keeps the expensive sdStar off most of them.
---------------------------------------------------------------- */
float motifLayer(vec2 s, float cell, float seed, float rBase, float w,
                 float aaSt, float density, float rp, float sharp) {
  vec2 gid = floor(s / cell);
  float acc = 0.0;

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = gid + vec2(float(i), float(j));
      vec2 h  = hash22(id + seed);
      if (h.x > density) continue;

      vec2 h2 = hash22(id * 1.7 + seed + 3.0);
      vec2 q  = s - (id + 0.5 + (h2 - 0.5) * 0.80) * cell;
      float r = rBase * (0.62 + h2.y * 0.66);
      if (dot(q, q) > r * r * 1.7) continue;

      float a  = (h.y - 0.5) * 0.85;              // a little off-axis
      float ca = cos(a), sa = sin(a);
      q = mat2(ca, sa, -sa, ca) * q;

      float m  = 2.60 + hash21(id * 5.1 + seed) * 0.60;  // pointiness varies
      float sw = clamp(r * 0.075, 0.0022, w);            // stroke tracks size
      float line = smoothstep(sw + aaSt, sw - aaSt, abs(sdStar(q, r, 4.0, m)));

      // each star crosses into view at its own angle
      float rev = pow(0.5 + 0.5 * cos((rp + (h2.x - 0.5) * 0.80) * TAU), sharp);
      acc = max(acc, line * rev * (0.70 + 0.30 * h.y));
    }
  }
  return acc;
}

/* ---------------------------------------------------------------
   Star field. Three tiers, all soft.
   The two larger tiers sample a 3x3 neighbourhood so a sparkle
   whose rays cross a cell boundary never gets clipped.
---------------------------------------------------------------- */
vec4 starTier(vec2 s, float cell, float seed, float r, float rayFall,
              float density, float t, int span, inout float halo) {
  vec2 gid = floor(s / cell);
  vec4 sum = vec4(0.0);                          // rgb = tint*weight, a = weight

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      if (span == 0 && (i != 0 || j != 0)) continue;
      vec2 id = gid + vec2(float(i), float(j));
      vec2 h  = hash22(id + seed);
      if (h.x > density) continue;

      vec2 h2 = hash22(id * 1.31 + seed + 7.0);
      vec2 centre = (id + 0.5 + (h2 - 0.5) * 0.72) * cell;

      // Each star breathes on its own clock AND advances with the tilt
      // at its own rate, so turning the card blinks different ones in
      // and out rather than dimming the whole field together.
      float tp  = (uTilt.x * 2.30 - uTilt.y * 1.60) * (0.55 + h2.y * 1.10);
      float tw  = 0.5 + 0.5 * sin(t * (0.45 + h2.x * 0.85) + h.y * TAU + tp);
      float amp = mix(1.0, pow(tw, 2.2), uTwinkle);
      float rr  = r * (0.72 + h2.y * 0.66);

      vec2 q = s - centre;
      float v = twinkle(q, rr, rayFall) * amp;
      halo += exp(-dot(q, q) / (rr * rr * 30.0)) * uGlow * amp;

      vec3 tint = mix(vec3(1.0),
                      mix(C_CYAN, C_MAG, step(0.5, h2.y)),
                      uCyber * step(0.62, hash21(id * 3.13 + seed)));
      sum += vec4(tint * v, v);
    }
  }
  return sum;
}

/* ---------------------------------------------------------------
   Surface relief for the specular only — the artwork underneath is
   never displaced. Three scales, all tiny: a broad undulation so the
   laminate isn't dead flat, lenticular ridging across the grating
   direction, and a micro roughness that stops the gloss reading as
   perfectly smooth plastic. Slopes are analytic where possible.
---------------------------------------------------------------- */
vec3 surfaceNormal(vec2 s, vec2 gdir) {
  vec2 n = vec2(0.0);

  // broad laminate undulation
  n += vec2(cos(s.x * 3.1 + 0.7) * 3.1, cos(s.y * 2.6 - 0.4) * 2.6) * 0.0042;

  // lenticular ridging, running across the grating
  vec2 lat = vec2(-gdir.y, gdir.x);
  n += lat * cos(dot(s, lat) * 150.0) * 0.00060;

  // micro roughness
  vec2 m = vec2(vnoise(s * 260.0 + 3.0), vnoise(s * 260.0 + 17.0)) - 0.5;
  n += m * uMicro * 0.020;

  return normalize(vec3(n, 1.0));
}

/* =============================================================== */
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;              // 0..1, y up

  // The back is the same sheet of foil seen from the other side: mirror
  // the frame, then offset the seeds and the hue phase so it reads as a
  // different cut of it rather than a copy.
  if (uFace > 0.5) uv.x = 1.0 - uv.x;
  float fseed = uFace * 137.0;

  vec2 st = vec2(uv.x * uAspect, uv.y);          // aspect-corrected
  vec2 p  = st - vec2(uAspect, 1.0) * 0.5;       // centred

  /* card silhouette --------------------------------------------- */
  float d  = rrect(p, vec2(uAspect, 1.0) * 0.5, uRadius);
  float aa = max(fwidth(d), 1e-4);
  float mask = 1.0 - smoothstep(-aa, aa, d);
  // As a texture on real geometry the mesh supplies the silhouette, so the
  // face is written fully opaque — a soft alpha rim here would print as a
  // dark hairline where the face meets the bevel.
  if (mask <= 0.0 && uOpaque < 0.5) { fragColor = vec4(0.0); return; }

  float t = uTime;
  vec2 tilt = easeTilt(uTilt);

  /* 0 — lighting basis --------------------------------------------
     A single soft key above and to the left, which slides with the
     tilt so its reflection glides across the surface instead of
     sitting still. Everything optical keys off this. */
  vec2  gdirL = normalize(vec2(0.74, 0.67));
  vec3  N = surfaceNormal(st, gdirL);
  vec3  V = normalize(vec3(-p, 1.9));            // camera above the card
  vec3  L = normalize(vec3(-0.30 - tilt.x * 0.62, 0.34 - tilt.y * 0.56, 1.25));
  vec3  H = normalize(L + V);
  float ndh = max(dot(N, H), 0.0);
  float ndv = max(dot(N, V), 0.0);

  // grazing incidence: a flat card viewed head-on has almost no Fresnel,
  // so the tilt carries most of it — which is also when real foil lights up
  float fres = pow(clamp(length(tilt) * 0.80 + (1.0 - ndv) * 1.6, 0.0, 1.0), 1.6) * uFresnel;

  // a tight glint riding inside a broad softbox reflection
  float spec = pow(ndh, 320.0) * 0.62 + pow(ndh, 60.0) * 0.38;
  spec *= (0.62 + 0.75 * fres);


  /* 1 — sky ------------------------------------------------------ */
  vec3 col = meshGradient(st, tilt * vec2(-0.090, 0.070));

  /* 2 — pink aura bloom ------------------------------------------ */
  vec2 ac = vec2(0.32 * uAspect, 0.34) + tilt * vec2(-0.14, 0.10);
  float aura = pow(clamp(1.0 - length((st - ac) / vec2(0.66, 0.52)), 0.0, 1.0), 2.0);
  col = mix(col, C_ROSE, aura * 0.34 * uAura);

  /* 3 — soft light fan from above -------------------------------- */
  vec2 rd = st - vec2(0.52 * uAspect + tilt.x * 0.30, 1.62);
  float fan = pow(0.5 + 0.5 * sin(atan(rd.x, -rd.y) * 5.0 + 0.9), 2.2);
  fan *= smoothstep(1.70, 0.10, length(rd));
  col = screenBlend(col, vec3(1.0, 0.988, 1.0) * fan * 0.12 * uRays);

  /* 4 — drifting mist -------------------------------------------- */
  float mist = fbm(st * vec2(1.7, 2.6) + vec2(t * 0.012, t * 0.004));
  mist = smoothstep(0.36, 0.72, mist) * smoothstep(0.62, 0.02, uv.y);
  col = mix(col, mix(col, vec3(1.0, 0.992, 1.0), 0.55), mist * 0.42 * uMist);

  /* 5 — holographic colour travel --------------------------------
     Phase stays closed-form — a linear ramp plus a gentle quadratic
     bow — but the tilt term is large enough to walk the whole hue
     cycle, so turning the card actually moves the colour instead of
     nudging it. */
  vec2  gdir = normalize(vec2(0.74, 0.67));
  float ramp = dot(p, gdir);
  float bow  = 0.30 * (p.x * p.x * 0.55 - p.y * p.y * 1.05);
  float phase = (ramp + bow) * uSpread + tilt.x * 1.55 - tilt.y * 1.10 + t * 0.008 + uFace * 0.37;

  // uneven envelope — real foil doesn't shift as one flat wash
  float env = 0.28 + 0.72 * pow(0.5 + 0.5 * cos((phase * 0.5 - tilt.x * 0.22) * TAU), 1.3);
  // interference strengthens toward grazing incidence, as real foil does
  col = mix(col, holoRamp(phase), clamp(uHolo * env * (1.0 + fres * 0.38), 0.0, 1.0));

  /* 6 — light and shade -------------------------------------------
     Tinted, not white: the crest runs warm and the trough runs cool,
     which gives the surface dimension without the broad white diagonal
     a plain luminance sweep paints across the middle. */
  float lit = 0.5 + 0.5 * cos((ramp * 0.85 - tilt.x * 0.80 + tilt.y * 0.62) * TAU);
  vec3 shadeLo = vec3(0.955, 0.944, 0.968);
  vec3 shadeHi = vec3(1.038, 1.025, 1.010);
  col *= mix(vec3(1.0), mix(shadeLo, shadeHi, lit), uShade);

  float sheen = env;                              // motif still keys off the foil

  /* 6 — hidden motif ---------------------------------------------
     Outlined four-point stars, scattered rather than tiled, gated by a
     band whose position is driven mostly by tilt. Turning the card
     sweeps them in and out — the part that actually reads as
     holographic, since a smooth colour shift alone does not. */
  float aaSt  = fwidth(st.x) * 1.2;              // continuous, unlike fwidth(fract(..))
  float rp    = ramp * 1.05 - tilt.x * 1.45 + tilt.y * 1.02;
  float sharp = mix(1.2, 7.0, uReveal);

  float motif = motifLayer(st, 0.220, 11.9 + fseed, 0.034, 0.0038, aaSt, 0.74, rp,        sharp);
  motif = max(motif,
          motifLayer(st, 0.130, 53.3 + fseed, 0.019, 0.0030, aaSt, 0.60, rp + 0.27, sharp));

  vec3 mIris = holoRamp(phase + 0.40);
  vec3 mCol  = clamp(col + (mIris - dot(mIris, LUMA)) * 1.30 - 0.038, 0.0, 1.0);
  col = mix(col, mCol, clamp(motif * uMotif, 0.0, 1.0));

  /* 7 — sheen ----------------------------------------------------- */
  col = screenBlend(col, vec3(0.30, 0.29, 0.32) * sheen * uSweep);

  /* 8 — star field ------------------------------------------------ */
  float skyBias = mix(0.90, 1.10, smoothstep(-0.15, 1.05, uv.y));
  float dens = uStarDensity * skyBias;
  // the glitter flares a little where the highlight passes over it
  float amt  = uSparkle * smoothstep(0.0, -0.045, d)
             * (1.0 + min(spec, 0.55) * 1.15);

  float halo = 0.0;
  vec4 sAcc = vec4(0.0);
  sAcc += starTier(st, 0.235, 11.3 + fseed, 0.0200, 1.30, 0.34 * dens, t, 1, halo) * 1.00;
  sAcc += starTier(st, 0.128, 41.7 + fseed, 0.0105, 1.85, 0.32 * dens, t, 1, halo) * 0.80;
  sAcc += starTier(st, 0.060, 77.1 + fseed, 0.0038, 4.50, 0.26 * dens, t, 0, halo) * 0.55;

  // soft bloom first, then the sparkle itself laid on opaque — white
  // screened over a pale pastel barely moves it, so the cores are a mix
  col = screenBlend(col, vec3(1.0, 0.975, 1.0) * clamp(halo * 0.16 * amt, 0.0, 1.0));
  vec3 sTint = sAcc.a > 1e-4 ? sAcc.rgb / sAcc.a : vec3(1.0);
  col = mix(col, sTint, clamp(sAcc.a * 1.35 * amt, 0.0, 1.0));

  /* 9 — specular ---------------------------------------------------
     Warm white and low: glossy laminate under a softbox, not neon. */
  col = screenBlend(col, vec3(1.000, 0.984, 0.976) * clamp(spec * 0.42 * uSpec, 0.0, 1.0));


  /* 10 — manufactured edge -----------------------------------------
     A die-cut laminate rolls off in the last fraction of a millimetre:
     the very rim loses a little light, and the side facing the key
     catches a thin one. Directional, so it never reads as a border —
     and it follows the SDF, so the corners round properly too. */
  vec2  eg = vec2(dFdx(d), dFdy(d));
  vec2  eN = eg / max(length(eg), 1e-5);         // outward, in screen space
  float rollOff = 1.0 - smoothstep(0.0, 0.018, -d);
  float edgeLit = max(dot(eN, L.xy / max(length(L.xy), 1e-5)), 0.0);
  float edgeCatch = 1.0 - smoothstep(0.0, 0.007, -d);

  col *= 1.0 - rollOff * 0.085 * uBevel;
  col += vec3(1.000, 0.988, 0.984) * edgeCatch * edgeLit * (0.14 + 0.14 * fres) * uBevel;

  /* 11 — finish ---------------------------------------------------- */
  float vig = smoothstep(0.04, -0.40, d);        // d is negative inside
  col *= mix(1.0, 0.92, vig * uVignette);

  float rimBand = smoothstep(0.0, -0.016, d) * (1.0 - smoothstep(-0.016, -0.052, d));
  vec3 rimTint = mix(vec3(1.0), mix(C_CYAN, C_MAG, 0.5 + 0.5 * tilt.x), 0.28);
  col += rimTint * rimBand * (0.16 + 0.26 * sheen) * uRim;

  // static fine grain — breaks 8-bit banding in the gradient
  col += (hash21(gl_FragCoord.xy) - 0.5) * 0.016 * uGrain;

  col = clamp(col, 0.0, 1.0);
  fragColor = uOpaque > 0.5 ? vec4(col, 1.0) : vec4(col * mask, mask);   // premultiplied
}
`;
