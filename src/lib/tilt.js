/**
 * Tilt source: pointer on desktop, gyroscope on device, slow lissajous
 * drift when neither is talking. Output is a critically-ish damped
 * spring in normalised -1..1 space.
 */
export function createTilt(config, target) {
  const state = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
  let lastInput = -Infinity;
  let gyro = null;                 // {x, y} accumulated, normalised
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const clamp = (v) => Math.min(1, Math.max(-1, v));

  function onPointer(e) {
    const r = target.getBoundingClientRect();
    // widen the sample area so the card still responds off its own edges
    const nx = (e.clientX - (r.left + r.width / 2)) / (r.width * 1.0);
    const ny = (e.clientY - (r.top + r.height / 2)) / (r.height * 1.0);
    state.tx = clamp(nx);
    state.ty = clamp(-ny);
    lastInput = performance.now();
  }

  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('pointerleave', () => { lastInput = -Infinity; });

  function onOrientation(e) {
    if (e.gamma == null || e.beta == null) return;
    // gamma: left/right -90..90, beta: front/back -180..180
    state.tx = clamp(e.gamma / 32);
    state.ty = clamp((e.beta - 45) / 32) * -1;
    lastInput = performance.now();
    gyro = true;
  }

  /** iOS needs a user gesture before it hands over motion data. */
  async function requestGyro() {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return false;
      } catch { return false; }
    }
    window.addEventListener('deviceorientation', onOrientation, { passive: true });
    return true;
  }

  const needsGyroPrompt = () =>
    typeof window.DeviceOrientationEvent?.requestPermission === 'function';

  // non-iOS devices can just listen
  if (!needsGyroPrompt() && 'ondeviceorientation' in window) {
    window.addEventListener('deviceorientation', onOrientation, { passive: true });
  }

  function update(time) {
    const idle = performance.now() - lastInput > 1800;
    if (idle && !gyro) {
      const k = config.idleDrift * (reduced ? 0 : 1);
      state.tx = Math.sin(time * 0.00042) * 0.62 * k;
      state.ty = Math.sin(time * 0.00031 + 1.7) * 0.48 * k;
    }
    const s = config.stiffness, dmp = config.damping;
    state.vx = (state.vx + (state.tx - state.x) * s) * dmp;
    state.vy = (state.vy + (state.ty - state.y) * s) * dmp;
    state.x += state.vx;
    state.y += state.vy;
    return state;
  }

  return { update, requestGyro, needsGyroPrompt, state };
}
