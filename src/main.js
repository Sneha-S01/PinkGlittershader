import { config } from './config.js';
import { createScene } from './lib/scene.js';
import { createTilt } from './lib/tilt.js';
import { mountPanel } from './lib/panel.js';
import frag from './shaders/card.frag.js';

const canvas  = document.getElementById('scene');
const stage   = document.querySelector('.stage');
const rig     = document.getElementById('rig');
const hint    = document.getElementById('hint');
const gyroBtn = document.getElementById('gyro');
const panelEl = document.getElementById('panel');

let scene;
try {
  scene = createScene(canvas, frag, config);
} catch (err) {
  console.error(err);
  hint.textContent = err.message;
  throw err;
}

const tilt = createTilt(config, rig);
const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch) hint.innerHTML = 'tilt your phone · tap to flip';

if (isTouch && tilt.needsGyroPrompt()) {
  gyroBtn.hidden = false;
  gyroBtn.addEventListener('click', async () => {
    if (await tilt.requestGyro()) gyroBtn.hidden = true;
  });
}

mountPanel(panelEl, config);
addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'H') panelEl.hidden = !panelEl.hidden;
});

/* ---- flip ---------------------------------------------------------
   ramp.design's turn: yaw 0 -> PI over 620ms on an ease-in-out cubic
   (their TURN_FLIP_MS and tG), about the card's own vertical axis, with
   the tilt taken out for the duration. It reads as real because the card
   is real — mid-turn you see its thickness and the edges catch the light. */
const FLIP_MS = 620;
const easeInOutCubic = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
let flip = 0, flipFrom = 0, flipTo = 0, flipStart = -1;

function toggleFlip() {
  flipFrom = flip;
  flipTo = Math.abs(flipTo - Math.PI) < 0.05 ? 0 : Math.PI;
  flipStart = performance.now();
}

// a drag across the card is a tilt, not a click
let downAt = null;
rig.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
rig.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved < 6) toggleFlip();
});
rig.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFlip(); }
});

// fade the hint out once the card has clearly been found
addEventListener(isTouch ? 'deviceorientation' : 'pointermove', () => {
  setTimeout(() => hint.classList.add('is-faded'), 2600);
}, { once: true });

const start = performance.now();

function frameLoop(now) {
  const t = (now - start) / 1000;
  const s = tilt.update(now);

  if (flipStart >= 0) {
    const k = Math.min(1, (now - flipStart) / FLIP_MS);
    flip = flipFrom + (flipTo - flipFrom) * easeInOutCubic(k);
    if (k >= 1) { flip = flipTo; flipStart = -1; }
  }
  // tilt fades out through the turn and back in as it lands
  const calm = 1 - Math.sin(flip);

  // The rig is no longer drawn; it stays laid out at the card's CSS size so
  // the 3D card can be sized from it, and so #content can sit on the card
  // later. Its perspective is matched to the camera so the two stay aligned.
  const focalPx = scene.layout(innerWidth, innerHeight, rig.offsetHeight);
  if (focalPx) stage.style.perspective = `${focalPx.toFixed(1)}px`;

  const rx = s.y * config.maxAngle * calm;
  const ry = s.x * config.maxAngle * calm + flip * 180 / Math.PI;
  rig.style.transform = `rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg)`;

  scene.render(s, t, flip, calm);
  requestAnimationFrame(frameLoop);
}
requestAnimationFrame(frameLoop);

// handy for tweaking from the console: __card.edgeShine = 1.6
window.__card = config;

// read-only peek at the turn, for debugging: __flipState()
window.__flipState = () => ({ flip, flipTo, turning: flipStart >= 0 });
