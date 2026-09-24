import { schema, defaults } from '../config.js';

/** Bare-bones art-direction panel. Press H to toggle. */
export function mountPanel(el, config, onChange) {
  const rows = [];
  let html = '<h2>art direction</h2>';
  for (const [group, items] of schema) {
    html += `<div class="grp"><label style="color:#b3abbd;letter-spacing:.1em;text-transform:uppercase;font-size:9px;margin:10px 0 5px"><span>${group}</span></label></div>`;
    for (const [key, min, max, step] of items) {
      html += `<div class="row">
        <label for="p-${key}"><span>${key}</span><b id="v-${key}">${config[key]}</b></label>
        <input id="p-${key}" type="range" min="${min}" max="${max}" step="${step}" value="${config[key]}" />
      </div>`;
      rows.push(key);
    }
  }
  html += `<div class="actions"><button id="p-reset">reset</button><button id="p-copy">copy json</button></div>`;
  el.innerHTML = html;

  for (const key of rows) {
    const input = el.querySelector(`#p-${key}`);
    const out = el.querySelector(`#v-${key}`);
    input.addEventListener('input', () => {
      config[key] = parseFloat(input.value);
      out.textContent = input.value;
      onChange?.(key);
    });
  }

  el.querySelector('#p-reset').addEventListener('click', () => {
    Object.assign(config, defaults);
    for (const key of rows) {
      el.querySelector(`#p-${key}`).value = config[key];
      el.querySelector(`#v-${key}`).textContent = config[key];
    }
    onChange?.();
  });

  el.querySelector('#p-copy').addEventListener('click', async () => {
    const btn = el.querySelector('#p-copy');
    try {
      await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
      btn.textContent = 'copied';
    } catch {
      console.log(JSON.stringify(config, null, 2));
      btn.textContent = 'logged';
    }
    setTimeout(() => { btn.textContent = 'copy json'; }, 1200);
  });
}
