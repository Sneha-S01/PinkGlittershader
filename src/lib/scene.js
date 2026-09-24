import * as THREE from 'three';

/* ------------------------------------------------------------------
   The card as a real object.

   The recipe follows ramp.design's cards (three.js r180): an extruded
   rounded rectangle with a rounded bevel, lit by an environment built
   from tall studio light strips, a filmic tone curve, MSAA on. The realism comes from geometry catching light — the bevel
   and side walls pick up the strips as thin moving highlights — not
   from drawing a highlight on a flat plane.

   The face is the existing artwork shader, rendered to a texture each
   frame and shown unlit and un-tonemapped, so its colours are exactly
   what they were. Only the body of the card is physically shaded.
------------------------------------------------------------------- */

const FOV     = 34;                    // ramp's camera: low distortion
const CARD_W  = 3.37;                  // ISO ID-1, world units
const CARD_H  = CARD_W / 1.586;
const OUTER_R = 0.142;                 // outer corner, same as the old CSS radius
// Apple Card proportions: ISO ID-1 at ~0.8mm on a 53.98mm height, so the
// card is ~1.5% as thick as it is tall. The edge is fully rounded, like the
// polished rim of the titanium card; ramp's chunkier .028 bevel would be
// thicker than the whole card at this scale.
const BEVEL   = 0.011;
const SHADOW_Z = -0.6;                 // backdrop plane, behind any tilt of the card

const FACE_W = CARD_W - 2 * BEVEL;     // the bevel grows outward from the face
const FACE_H = CARD_H - 2 * BEVEL;
const FACE_R = OUTER_R - BEVEL;

const DEG = Math.PI / 180;

/* ---- geometry ---------------------------------------------------- */

function faceShape() {
  const w = FACE_W, h = FACE_H, r = FACE_R;
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
  const s = new THREE.Shape();
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x1, y1 - r);
  s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  s.lineTo(x0 + r, y1);
  s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + r);
  s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/* ExtrudeGeometry is non-indexed, so its own normals are per-facet and
   the bevel shades in visible bands. Its bevel profile is a quarter
   ellipse, tangent to the face at one end and the side wall at the
   other, so averaging normals by shared position gives one continuous
   rounded edge. The caps are unlit, so bending their rim normals costs
   nothing. */
function smoothNormals(g) {
  const pos = g.attributes.position;
  const key = (i) =>
    `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const acc = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();

  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    fn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));   // area-weighted
    for (let j = i; j < i + 3; j++) {
      const k = key(j);
      if (!acc.has(k)) acc.set(k, new THREE.Vector3());
      acc.get(k).add(fn);
    }
  }
  const normals = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.copy(acc.get(key(i))).normalize();
    normals[i * 3] = v.x; normals[i * 3 + 1] = v.y; normals[i * 3 + 2] = v.z;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
}

/* total: overall card thickness in world units, rounded edges included */
function buildCardGeometry(total) {
  const g = new THREE.ExtrudeGeometry(faceShape(), {
    depth: Math.max(0.0005, total - 2 * BEVEL),
    steps: 1,
    curveSegments: 24,
    bevelEnabled: true,
    bevelSegments: 5,
    bevelSize: BEVEL,
    bevelThickness: BEVEL,
  });
  g.center();

  // the default UVs are raw shape coordinates; map the face onto 0..1
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) + FACE_W / 2) / FACE_W, (pos.getY(i) + FACE_H / 2) / FACE_H);
  }
  // ExtrudeGeometry puts both caps in group 0: the back (bottom) cap's
  // triangles first, then the front (top) cap's, equal in number. Split
  // them so each side can carry its own material, and mirror the back's U
  // so its texture reads the right way round when seen from behind.
  const capGroup = g.groups.find((gr) => gr.materialIndex === 0);
  const half = capGroup.count / 2;
  for (let i = capGroup.start; i < capGroup.start + half; i++) uv.setX(i, 1 - uv.getX(i));
  uv.needsUpdate = true;
  g.groups = g.groups.filter((gr) => gr !== capGroup);
  g.addGroup(capGroup.start + half, half, 0);        // front
  g.addGroup(capGroup.start, half, 2);               // back

  smoothNormals(g);
  return g;                              // groups: 0 front, 1 bevel + sides, 2 back
}

/* ---- lighting ---------------------------------------------------- */

/* Studio environments, each a set of emissive panels rendered once into a
   prefiltered environment map (drei's Lightformer: a plane or ring whose
   colour is multiplied by its intensity, unlit, double-sided).

   RAMP is ramp.design's StudioEnvironment exactly, read from their code —
   the rig behind both their hero cards and their metal-card viewer. Its
   room is near-black (0.02), which is what makes their edge highlights
   crisp: there is dark next to every light. At "full" quality they add a
   soft overhead ring and a low front strip, included here.

   SOFT is the earlier tuning for this card: the room lit to 0.55 so a pale
   pink edge doesn't read as a grey border. */
const STUDIOS = {
  ramp: [
    // [form, intensity, position, rotation, scale, colour]
    ['rect', 0.02, [0, 0, 6],         [0, 0, 0],            [12, 9, 1],     '#c8c8c6'],
    ['rect', 2.5,  [-3.15, 0.4, 4],   [0, 0.48, 0],         [1.45, 7, 1],   '#eeeeec'],
    ['rect', 4.6,  [2.2, 0, 4],       [0, -0.34, 0],        [2.5, 7, 1],    '#ffffff'],
    ['rect', 5.0,  [1.35, 0.2, 5],    [0, -0.24, 0],        [0.24, 6.2, 1], '#ffffff'],
    ['rect', 1.0,  [-0.3, 0, 4.4],    [0, 0, 0],            [1.05, 6.8, 1], '#000000'],
    ['rect', 0.08, [0, 0, -4],        [0, Math.PI, 0],      [9, 7, 1],      '#080808'],
    ['ring', 0.75, [0, 4, -4],        [Math.PI / 2, 0, 0],  [5, 5, 1],      '#d2d2d0'],
    ['rect', 1.2,  [-2.6, -3.8, 2.5], [0.45, 0.35, 0],      [4.5, 0.4, 1],  '#e4e4e2'],
  ],
  soft: [
    ['rect', 0.55, [0, 0, 6],         [0, 0, 0],            [12, 9, 1],     '#f4f2f2'],
    ['rect', 2.5,  [-3.15, 0.4, 4],   [0, 0.48, 0],         [1.45, 7, 1],   '#eeeeec'],
    ['rect', 4.6,  [2.2, 0, 4],       [0, -0.34, 0],        [2.5, 7, 1],    '#ffffff'],
    ['rect', 5.0,  [1.35, 0.2, 5],    [0, -0.24, 0],        [0.24, 6.2, 1], '#ffffff'],
    ['rect', 1.0,  [-0.3, 0, 4.4],    [0, 0, 0],            [1.05, 6.8, 1], '#000000'],
    ['rect', 0.08, [0, 0, -4],        [0, Math.PI, 0],      [12, 9, 1],     '#ffffff'],
  ],
};

/* Each lighting mode's environment. soft and ramp are panel studios;
   gloss is a single light. */
const ENVIRONMENTS = {
  soft:  { panels: 'soft', size: 256, sigma: 0 },
  ramp:  { panels: 'ramp', size: 256, sigma: 0 },   // their "full" resolution, no blur
  gloss: { single: true, size: 256 },
};

/* GLOSS: one soft, round light in a plain, faint surround, and nothing
   else. The earlier version blurred the whole panel studio together,
   which gave an uneven multi-lobed wash; one source gives one clean
   highlight that glides across the coat as the card tilts.

   The card faces a camera ~10 units away, so at rest it only reflects
   directions within about 9 degrees of straight ahead. The light sits just
   inside that cone, up and to the left, so at rest its reflection lands in
   the upper-left of the face; tilting turns the reflection by twice the
   tilt, which slides it across and off the card. The falloff is Gaussian,
   so the highlight has no hard edge, only a soft core.

   Its shape is a long vertical sheen, not a disc. A round highlight reads as
   a lamp — on a pastel already near white, its core burns to a white sun. A
   strip that runs past the top and bottom of the card has no ends and no
   core to see: it reads as gloss. It is narrow across (Gaussian, about a
   third of the card's width) and kept low enough that it never clips.

   The surround is dim straight ahead, which is all the face ever reflects,
   and bright toward the sides, which is what the rounded edge reflects at
   its grazing angle. Dim everywhere, the edge printed as a dark outline;
   bright everywhere, the face washed. */
const SINGLE_LIGHT = {
  dir: [-0.07, 0, 1],      // centre of the sheen, before normalising
  sigmaX: 0.05,            // width across, radians
  sigmaY: 0.6,             // length — far past the card's ~0.12 rad height
  lean: 0.2,               // radians off vertical
  intensity: 2.0,
  front: 0.06,             // surround the face sees
  side: 0.8,               // surround the rounded edge sees
};

function buildSingleLight(renderer, size) {
  const env = new THREE.Scene();
  const L = SINGLE_LIGHT;
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      dir: { value: new THREE.Vector3(...L.dir).normalize() },
      sigmaX: { value: L.sigmaX },
      sigmaY: { value: L.sigmaY },
      lean: { value: L.lean },
      intensity: { value: L.intensity },
      front: { value: L.front },
      side: { value: L.side },
    },
    vertexShader: `varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: `uniform vec3 dir;
uniform float sigmaX, sigmaY, lean, intensity, front, side;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  // angular offsets from the sheen's centre, in a frame around it
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), dir));
  vec3 up = cross(dir, right);
  vec2 q = vec2(dot(d, right), dot(d, up));
  float c = cos(lean), s = sin(lean);
  q = mat2(c, s, -s, c) * q;
  float key = dot(d, dir) > 0.0
    ? intensity * exp(-(q.x * q.x) / (2.0 * sigmaX * sigmaX))
                * exp(-(q.y * q.y) / (2.0 * sigmaY * sigmaY))
    : 0.0;
  // dim within ~40 degrees of straight ahead, bright past ~70
  float surround = mix(front, side, smoothstep(0.75, 0.35, d.z))
                 * (0.85 + 0.3 * max(d.y, 0.0));
  gl_FragColor = vec4(vec3(surround + key), 1.0);
}`,
  });
  env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 96, 48), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0, 0.1, 100, { size }).texture;
  pmrem.dispose();
  env.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  return tex;
}

function buildEnvironment(renderer, mode) {
  const { panels, size, sigma, single } = ENVIRONMENTS[mode];
  if (single) return buildSingleLight(renderer, size);
  const env = new THREE.Scene();
  for (const [form, intensity, pos, rot, scale, color] of STUDIOS[panels]) {
    const m = new THREE.Mesh(
      form === 'ring' ? new THREE.RingGeometry(0.5, 1, 64) : new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(intensity),
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    m.position.set(...pos);
    m.rotation.set(...rot);
    m.scale.set(...scale);
    env.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, sigma, 0.1, 100, { size }).texture;
  pmrem.dispose();
  env.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  return tex;
}

/* ---- shadows ----------------------------------------------------- */

/* Shadows are drawn once into canvases and laid on a backdrop plane
   behind the card. They are filled textures, not box-shadows, so the
   tilting card can never expose a hollow interior; and the backdrop
   sits past the deepest point of any tilt, so depth testing keeps it
   behind the card with no special ordering. The layer stacks are the
   ones the page already used. */
const CONTACT_LAYERS = [
  // [offsetY px, blur px, alpha]
  [0.5, 1, 0.17],
  [1, 2, 0.15],
  [3, 6, 0.12],
  [8, 14, 0.10],
  [18, 30, 0.07],
];
// The widest layer (40px offset, 64px blur) is gone: blur spreads in every
// direction, so it hazed the white above and beside the card into what read
// as a grey mat behind it rather than a shadow cast beneath it.

function shadowCanvas(wPx, hPx, rPx, pad, dpr, draw) {
  const cv = document.createElement('canvas');
  cv.width = Math.ceil((wPx + pad * 2) * dpr);
  cv.height = Math.ceil((hPx + pad * 2) * dpr);
  const ctx = cv.getContext('2d');
  const OFF = cv.width * 4;           // draw the shape off-canvas; keep only its shadow
  draw(ctx, OFF, (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.roundRect((pad + x) * dpr - OFF, (pad + y) * dpr, w * dpr, h * dpr, r * dpr);
    ctx.fill();
  });
  return cv;
}

function contactShadow(wPx, hPx, rPx, dpr) {
  const pad = 130;
  const cv = shadowCanvas(wPx, hPx, rPx, pad, dpr, (ctx, OFF, rect) => {
    ctx.fillStyle = '#000';
    for (const [oy, blur, a] of CONTACT_LAYERS) {
      ctx.shadowColor = `rgba(60, 44, 68, ${a})`;
      ctx.shadowBlur = blur * dpr;       // same semantics as box-shadow blur
      ctx.shadowOffsetX = OFF;
      ctx.shadowOffsetY = oy * dpr;
      rect(0, 0, wPx, hPx, rPx);
    }
  });
  return { canvas: cv, pad };
}

function castShadow(wPx, hPx, rPx, dpr) {
  const pad = 160;
  const cv = shadowCanvas(wPx, hPx, rPx, pad, dpr, (ctx, OFF, rect) => {
    ctx.fillStyle = '#000';
    ctx.shadowColor = '#4a3550';
    ctx.shadowBlur = 48 * dpr;           // sigma 24
    ctx.shadowOffsetX = OFF;
    ctx.shadowOffsetY = 0;
    // narrower and lower than the card, so it only shows underneath it
    rect(wPx * 0.10, hPx * 0.30, wPx * 0.80, hPx * 0.84, rPx);
  });
  return { canvas: cv, pad };
}

/* ---- scene ------------------------------------------------------ */

export function createScene(canvas, fragSrc, config) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;            // shadows and card are separate passes
  const scene = new THREE.Scene();

  // ramp's direct lights: weak ambient, a key from the upper left and front,
  // and on their homepage a frontal fill (FRONTAL_FILL_INTENSITY 0.28)
  const ambient = new THREE.AmbientLight(0xffffff, 0.36);
  const key = new THREE.DirectionalLight(0xffffff, 0.34);
  key.position.set(-4, 5, 7);
  const fill = new THREE.DirectionalLight(0xffffff, 0.28);
  fill.position.set(0, 1.2, 8);
  scene.add(ambient, key, fill);

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);

  /* faces: the artwork shader, rendered to a texture per side */
  const faceUniforms = {};
  for (const m of fragSrc.matchAll(/uniform\s+(float|vec2)\s+([^;]+);/g)) {
    for (const n of m[2].split(',')) {
      faceUniforms[n.trim()] = { value: m[1] === 'vec2' ? new THREE.Vector2() : 0 };
    }
  }
  const facePass = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: 'in vec3 position;\nvoid main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: fragSrc.replace(/^\s*#version 300 es\s*/, ''),
      uniforms: faceUniforms,
      depthTest: false,
      depthWrite: false,
    }),
  );
  facePass.frustumCulled = false;
  const faceScene = new THREE.Scene();
  faceScene.add(facePass);
  const faceCam = new THREE.Camera();

  const targetOpts = {
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  };
  const frontTarget = new THREE.WebGLRenderTarget(16, 16, targetOpts);
  const backTarget = new THREE.WebGLRenderTarget(16, 16, targetOpts);

  // The face textures hold display values, not linear light. Any lit
  // material that uses them decodes to linear first, and clamps its UVs so
  // the bevel and sides pick up the colour of the face beside them.
  const decodeMap = (mat) => {
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
#ifdef USE_MAP
  diffuseColor *= sRGBTransferEOTF(texture2D(map, clamp(vMapUv, 0.002, 0.998)));
#endif`);
    };
    return mat;
  };

  // SOFT faces: unlit, un-tonemapped, no output conversion — each face shows
  // exactly the values the artwork shader wrote.
  const unlitFace = (target) => new THREE.ShaderMaterial({
    uniforms: { map: { value: target.texture } },
    vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D map;\nvarying vec2 vUv;\nvoid main() { gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0); }',
    toneMapped: false,
  });

  // RAMP faces: lit like theirs — a physical material with the artwork as
  // both colour map and bump map (their bumpScale 0.12), under a clear coat,
  // tone mapped with everything else. The finish is picked from their preset
  // ranges for a printed card; the exact per-design finish isn't exposed.
  const litFace = (target) => decodeMap(new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: target.texture,
    bumpMap: target.texture,
    bumpScale: 0.12,
    metalness: 0.15,
    roughness: 0.48,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.2,
  }));

  // GLOSS faces: the artwork is the EMISSIVE term, not a lit albedo, so no
  // light can fade the pink or dim a star — the face shows exactly what the
  // shader painted. The diffuse base is black; everything the lights add is
  // reflection, from a clear coat and the base layer's own 4% specular, of
  // the single light. Not tone mapped, so the base stays exact.
  // The coat takes Fresnel ~4% off what's beneath it head-on, which the
  // emissive intensity hands back.
  const glossFace = (target) => {
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: target.texture,
      emissiveIntensity: 1.04,
      // No bump map. Taken from the artwork, it carried the anti-banding
      // grain and the edges of the colour bands into the coat, and the
      // reflection came out mottled rather than one clean sweep.
      metalness: 0.0,
      roughness: 0.45,           // the base layer adds a faint, broad bloom
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,  // the coat carries the crisp core
      envMapIntensity: config.gloss,
      toneMapped: false,
    });
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `
#ifdef USE_EMISSIVEMAP
  totalEmissiveRadiance *= sRGBTransferEOTF(texture2D(emissiveMap, vEmissiveMapUv)).rgb;
#endif`);
    };
    return mat;
  };

  const faces = {
    soft: [unlitFace(frontTarget), unlitFace(backTarget)],
    ramp: [litFace(frontTarget), litFace(backTarget)],
    gloss: [glossFace(frontTarget), glossFace(backTarget)],
  };

  /* body: the face print wraps the edge, under a clear coat. (No thin-film
     iridescence: along a rounded edge it split the light into a rainbow.)
     Sampling the face texture at the clamped edge UV gives every point of
     the bevel and side wall the colour of the face beside it, so the edge
     is shaded pink rather than a separate grey band. The texture holds
     display values, so it is decoded to linear for lighting. The back is
     the front's mirror image seen from behind, so the front texture is the
     right colour for both rims. */
  const edgeMat = decodeMap(new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: frontTarget.texture,
    roughness: 0.24,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    envMapIntensity: config.edgeShine,
  }));

  let depth = config.thickness;
  const card = new THREE.Mesh(buildCardGeometry(depth), []);
  scene.add(card);

  /* lighting modes: 0 soft, 1 ramp.design's exactly, 2 gloss */
  let studio = null;
  const envMaps = {};
  function applyStudio(name) {
    if (name === studio) return;
    studio = name;
    envMaps[name] ??= buildEnvironment(renderer, name);
    scene.environment = envMaps[name];
    const ramp = name === 'ramp';
    // ramp: ACES filmic at 0.9. soft and gloss: Khronos PBR Neutral, which
    // leaves base colours alone — ACES desaturates pastels and greyed the edge.
    renderer.toneMapping = ramp ? THREE.ACESFilmicToneMapping : THREE.NeutralToneMapping;
    renderer.toneMappingExposure = ramp ? 0.9 : 1.0;
    ambient.intensity = ramp ? 0.36 : 0.7;
    // Directional lights are point sources at infinity: in a clear coat
    // they print as a hard white spot. Gloss uses the environment alone.
    key.visible = name !== 'gloss';
    fill.visible = ramp;
    card.material = [faces[name][0], edgeMat, faces[name][1]];
  }

  /* backdrop shadows */
  const shadowMat = () => new THREE.MeshBasicMaterial({
    transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  });
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat());
  const cast = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat());
  // The contact layers turn WITH the card, sitting in its plane — the way the
  // original CSS box-shadow did on the tilting element. Their dense core lies
  // exactly under the card's own silhouette at every angle, so the card always
  // covers it. Laid flat on the backdrop instead, perspective shrank the card's
  // far edge a few pixels on every tilt and the core showed as a grey slab.
  // Only the soft cast stays on the backdrop and slides.
  cast.position.z = SHADOW_Z;
  // Their own scene, drawn first with depth cleared after. Mid-flip the card
  // swings its far edge well behind the backdrop plane; sharing a depth
  // buffer let the shadow paint over that part of the card as a dark band.
  const backdrop = new THREE.Scene();
  backdrop.add(cast, contact);

  function setShadowTexture(mesh, { canvas: cv }, worldPerPx) {
    mesh.material.map?.dispose();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    mesh.material.map = tex;
    mesh.material.needsUpdate = true;
    mesh.userData.w = cv.width / dprNow * worldPerPx;
    mesh.scale.set(mesh.userData.w, cv.height / dprNow * worldPerPx, 1);
  }

  /* layout, kept in step with the page */
  let vw = 0, vh = 0, cardPxH = 0, dprNow = 1, ppu = 1, dist = 1, backScale = 1;

  function layout(viewW, viewH, cardHeightPx) {
    if (viewW === vw && viewH === vh && cardHeightPx === cardPxH) return false;
    vw = viewW; vh = viewH; cardPxH = cardHeightPx;
    dprNow = Math.min(window.devicePixelRatio || 1, 2);

    renderer.setPixelRatio(dprNow);
    renderer.setSize(vw, vh, false);

    // place the camera so the card lands at exactly its CSS size
    ppu = cardPxH / CARD_H;
    const focalPx = (vh / 2) / Math.tan((FOV / 2) * DEG);
    dist = focalPx / ppu;
    camera.aspect = vw / vh;
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    const tw = Math.min(4096, Math.round(FACE_W * ppu * dprNow));
    const th = Math.min(4096, Math.round(FACE_H * ppu * dprNow));
    frontTarget.setSize(tw, th);
    backTarget.setSize(tw, th);

    // the backdrop is further away, so it has to be drawn larger to match
    backScale = (dist - SHADOW_Z) / dist;
    const wPx = CARD_W * ppu, hPx = CARD_H * ppu, rPx = OUTER_R * ppu;
    setShadowTexture(contact, contactShadow(wPx, hPx, rPx, dprNow), 1 / ppu);
    setShadowTexture(cast, castShadow(wPx, hPx, rPx, dprNow), backScale / ppu);

    return focalPx;                      // for the CSS overlay's perspective
  }

  function setFace(name, a, b) {
    const u = faceUniforms[name];
    if (!u) return;
    if (u.value.isVector2) u.value.set(a, b); else u.value = a;
  }

  function renderFace(target, side, s, t) {
    setFace('uRes', target.width, target.height);
    setFace('uAspect', target.width / target.height);
    setFace('uTime', t);
    // the back faces the other way, so a tilt lights it from the far side
    setFace('uTilt', side ? -s.x : s.x, s.y);
    setFace('uFace', side);
    setFace('uRadius', FACE_R / FACE_H);
    setFace('uOpaque', 1);
    for (const k of Object.keys(config)) {
      setFace('u' + k[0].toUpperCase() + k.slice(1), config[k]);
    }
    setFace('uBevel', 0);                // the real bevel replaces the painted one
    if (studio === 'ramp') {
      // under real lighting the painted glint and light/shade band would be
      // lit twice over; the studio does those jobs now
      setFace('uSpec', 0);
      setFace('uShade', 0);
    } else if (studio === 'gloss') {
      // the painted glint is a pinpoint light of its own; gloss shows none
      setFace('uSpec', 0);
    }
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(faceScene, faceCam);
  }

  /* s: tilt state, t: seconds, flip: 0..PI, calm: 0..1 tilt scale */
  function render(s, t, flip = 0, calm = 1) {
    if (config.thickness !== depth) {
      depth = config.thickness;
      card.geometry.dispose();
      card.geometry = buildCardGeometry(depth);
    }
    edgeMat.envMapIntensity = config.edgeShine;
    applyStudio(['soft', 'ramp', 'gloss'][Math.round(config.lighting)] ?? 'gloss');
    for (const m of faces.gloss) m.envMapIntensity = config.gloss;

    // Only the side facing the camera needs painting, except mid-turn.
    const facing = Math.cos(flip);
    const turning = Math.abs(flip) > 1e-4 && Math.abs(flip - Math.PI) > 1e-4;
    if (facing > 0 || turning) renderFace(frontTarget, 0, s, t);
    if (facing < 0 || turning) renderFace(backTarget, 1, s, t);
    renderer.setRenderTarget(null);

    // Same rotation the CSS rig used (CSS is y-down, three is y-up), plus the
    // flip as extra yaw about the card's own vertical axis — ramp's recipe.
    // Euler XYZ puts pitch outermost, so it stays screen-relative when flipped.
    card.rotation.set(
      -s.y * config.maxAngle * calm * DEG,
      s.x * config.maxAngle * calm * DEG + flip,
      0,
    );

    // A card turning about its vertical axis casts a narrowing shadow; the
    // shadow textures are filled, so squashing them never exposes a hole.
    const edge = Math.abs(facing);
    cast.scale.x = cast.userData.w * (0.06 + 0.94 * edge);
    contact.rotation.copy(card.rotation);   // edge-on, it vanishes with the card

    // only the soft cast moves with the tilt; the contact layers stay put
    const pxToWorld = backScale / ppu;
    cast.position.x = -s.x * calm * 16 * pxToWorld;
    cast.position.y = -(s.y * calm * 16 + 8) * pxToWorld;
    cast.material.opacity = (0.18 - Math.abs(s.y) * 0.04) * (0.3 + 0.7 * edge);
    contact.material.opacity = 1 - Math.abs(s.y) * 0.12;

    renderer.clear();
    renderer.render(backdrop, camera);
    renderer.clearDepth();
    renderer.render(scene, camera);
  }

  return { layout, render };
}
