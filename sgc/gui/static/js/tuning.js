const socket = io();

const TUNE_GROUPS = [
  {
    id: 'rate_roll_pitch',
    name: 'Rate Roll / Pitch',
    params: [
      { key: 'ATC_RAT_RLL_P', label: 'Roll Rate P', min: 0.01, max: 0.5, step: 0.001, units: '' },
      { key: 'ATC_RAT_RLL_I', label: 'Roll Rate I', min: 0.01, max: 1.0, step: 0.001, units: '' },
      { key: 'ATC_RAT_RLL_D', label: 'Roll Rate D', min: 0.0, max: 0.01, step: 0.0001, units: '' },
      { key: 'ATC_RAT_PIT_P', label: 'Pitch Rate P', min: 0.01, max: 0.5, step: 0.001, units: '' },
      { key: 'ATC_RAT_PIT_I', label: 'Pitch Rate I', min: 0.01, max: 1.0, step: 0.001, units: '' },
      { key: 'ATC_RAT_PIT_D', label: 'Pitch Rate D', min: 0.0, max: 0.01, step: 0.0001, units: '' },
    ],
  },
  {
    id: 'rate_yaw',
    name: 'Rate Yaw',
    params: [
      { key: 'ATC_RAT_YAW_P', label: 'Yaw Rate P', min: 0.01, max: 0.8, step: 0.001, units: '' },
      { key: 'ATC_RAT_YAW_I', label: 'Yaw Rate I', min: 0.001, max: 0.5, step: 0.001, units: '' },
      { key: 'ATC_RAT_YAW_D', label: 'Yaw Rate D', min: 0.0, max: 0.01, step: 0.0001, units: '' },
    ],
  },
  {
    id: 'stabilize_angle',
    name: 'Stabilize (Angle)',
    params: [
      { key: 'ATC_ANG_RLL_P', label: 'Roll Angle P', min: 1.0, max: 20.0, step: 0.1, units: '' },
      { key: 'ATC_ANG_PIT_P', label: 'Pitch Angle P', min: 1.0, max: 20.0, step: 0.1, units: '' },
      { key: 'ATC_ANG_YAW_P', label: 'Yaw Angle P', min: 1.0, max: 10.0, step: 0.1, units: '' },
      { key: 'ATC_ANG_MAX', label: 'Angle Max Tilt', min: 1000, max: 8000, step: 100, units: 'cdeg' },
    ],
  },
  {
    id: 'altitude_position',
    name: 'Altitude & Position',
    params: [
      { key: 'ALT_HOLD_P', label: 'Altitude Hold P', min: 0.5, max: 5.0, step: 0.1, units: '' },
      { key: 'POS_XY_P', label: 'Position XY P', min: 0.5, max: 5.0, step: 0.1, units: '' },
      { key: 'POS_Z_P', label: 'Position Z P', min: 0.5, max: 5.0, step: 0.1, units: '' },
      { key: 'VEL_XY_P', label: 'Velocity XY P', min: 0.5, max: 5.0, step: 0.1, units: '' },
      { key: 'VEL_Z_P', label: 'Velocity Z P', min: 0.5, max: 5.0, step: 0.1, units: '' },
      { key: 'ATC_THR_MID', label: 'Throttle Mid', min: 300, max: 800, step: 1, units: '' },
    ],
  },
  {
    id: 'loiter_nav',
    name: 'Loiter & Navigation',
    params: [
      { key: 'LOIT_SPEED', label: 'Loiter Speed', min: 100, max: 2000, step: 50, units: 'cm/s' },
      { key: 'LOIT_ANG_MAX', label: 'Loiter Angle Max', min: 500, max: 4500, step: 100, units: 'cdeg' },
      { key: 'WP_SPEED', label: 'Waypoint Speed', min: 100, max: 2000, step: 50, units: 'cm/s' },
      { key: 'WP_RADIUS', label: 'Waypoint Radius', min: 100, max: 2000, step: 50, units: 'cm' },
    ],
  },
  {
    id: 'autotune',
    name: 'AutoTune',
    params: [
      { key: 'AUTOTUNE_AXES', label: 'AutoTune Axes', min: 1, max: 7, step: 1, units: 'bitmask' },
      { key: 'AUTOTUNE_AGGR', label: 'AutoTune Aggressiveness', min: 0.03, max: 0.2, step: 0.005, units: '' },
      { key: 'AUTOTUNE_MIN_D', label: 'AutoTune Min D', min: 0.0, max: 0.005, step: 0.0001, units: '' },
    ],
  },
];

let _origValues = {};    // param_name -> original value from FCU
let _changedValues = {};  // param_name -> edited value
let _allParams = {};      // param_name -> full info from snapshot

let _loading = false;

function showStatus(msg) {
  const el = document.getElementById('tuneStatus');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideStatus() {
  document.getElementById('tuneStatus').style.display = 'none';
}

async function loadParams() {
  const wrap = document.getElementById('tuneWrap');
  _loading = true;
  document.getElementById('writeBtn').disabled = true;

  try {
    const resp = await fetch('/api/params/snapshot');
    const data = await resp.json();
    _allParams = {};
    for (const p of data.params) {
      _allParams[p.name] = p;
    }
  } catch (e) {
    showStatus('Failed to load parameters');
    _loading = false;
    return;
  }

  _origValues = {};
  _changedValues = {};
  renderGroups();
  _loading = false;
  updateWriteBtn();
}

function renderGroups() {
  const wrap = document.getElementById('tuneWrap');
  const connected = Object.keys(_allParams).length > 0;

  if (!connected) {
    wrap.innerHTML = '<div class="tune-not-connected">Not connected to a vehicle. Connect first, then open Tuning.</div>';
    return;
  }

  let html = '';
  for (const group of TUNE_GROUPS) {
    const available = group.params.filter(p => _allParams[p.key]);
    if (available.length === 0) continue;

    html += `
      <div class="tune-group">
        <div class="tune-group-header" onclick="toggleGroup(this)">
          <span class="arrow open">&#9654;</span>
          <span class="gname">${group.name}</span>
          <span class="gcount">${available.length} params</span>
        </div>
        <div class="tune-group-body open" id="gb_${group.id}">
    `;

    for (const p of available) {
      const info = _allParams[p.key];
      const val = info.value;
      _origValues[p.key] = val;

      const decimals = (p.step + '').replace(/^\d+\.?/, '').length;
      html += `
        <div class="tune-param" id="tp_${p.key}">
          <div class="tune-param-row">
            <div style="min-width:180px">
              <div class="tune-param-human">${p.label}</div>
              <div class="tune-param-name">${p.key}</div>
            </div>
            <div class="tune-param-slider">
              <input type="range" min="${p.min}" max="${p.max}" step="${p.step}"
                value="${val}" oninput="onSliderChange('${p.key}')"
                id="s_${p.key}" />
            </div>
            <div class="tune-param-value">
              <input type="number" min="${p.min}" max="${p.max}" step="${p.step}"
                value="${val}" oninput="onNumberChange('${p.key}')"
                id="n_${p.key}" />
              <span class="changed-badge" id="cb_${p.key}">&#9997;</span>
              ${p.units ? `<span class="units-label">${p.units}</span>` : ''}
            </div>
          </div>
          ${info.description ? `<div class="tune-param-desc">${info.description}</div>` : ''}
        </div>
      `;
    }

    html += '</div></div>';
  }

  wrap.innerHTML = html;
}

function toggleGroup(header) {
  const arrow = header.querySelector('.arrow');
  const body = header.nextElementSibling;
  arrow.classList.toggle('open');
  body.classList.toggle('open');
}

let _sliderUpdating = false;

function onSliderChange(key) {
  const slider = document.getElementById('s_' + key);
  const num = document.getElementById('n_' + key);
  if (_sliderUpdating) return;

  const val = parseFloat(slider.value);
  const rounded = parseFloat(val.toFixed(10));
  num.value = rounded;
  markChanged(key, rounded);
}

function onNumberChange(key) {
  const num = document.getElementById('n_' + key);
  const slider = document.getElementById('s_' + key);
  const val = parseFloat(num.value);
  if (isNaN(val)) return;

  _sliderUpdating = true;
  slider.value = val;
  _sliderUpdating = false;
  markChanged(key, val);
}

function markChanged(key, value) {
  const orig = _origValues[key];
  const changed = Math.abs(value - orig) > 1e-9;
  const num = document.getElementById('n_' + key);
  const badge = document.getElementById('cb_' + key);

  if (changed) {
    _changedValues[key] = value;
    num.classList.add('changed');
    badge.classList.add('show');
  } else {
    delete _changedValues[key];
    num.classList.remove('changed');
    badge.classList.remove('show');
  }
  updateWriteBtn();
}

function updateWriteBtn() {
  const btn = document.getElementById('writeBtn');
  const count = Object.keys(_changedValues).length;
  btn.disabled = count === 0;
  btn.textContent = count > 0 ? `\u2713 Write Params (${count})` : '\u2713 Write Params';
}

async function writeParams() {
  const entries = Object.entries(_changedValues);
  if (entries.length === 0) return;

  showStatus(`Writing ${entries.length} parameter${entries.length > 1 ? 's' : ''}...`);
  document.getElementById('writeBtn').disabled = true;

  let ok = 0;
  let err = 0;
  for (const [key, value] of entries) {
    try {
      const resp = await fetch('/api/param_set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: key, value }),
      });
      if (resp.ok) {
        ok++;
      } else {
        err++;
      }
    } catch {
      err++;
    }
  }

  if (err === 0) {
    showStatus(`Written ${ok} parameter${ok > 1 ? 's' : ''} successfully. Refresh to confirm.`);
    for (const key of Object.keys(_changedValues)) {
      _origValues[key] = _changedValues[key];
    }
    _changedValues = {};
  } else {
    showStatus(`Written ${ok}, ${err} failed`);
  }

  updateWriteBtn();
}

async function refreshParams() {
  await loadParams();
  showStatus('Parameters refreshed');
  setTimeout(hideStatus, 2000);
}

document.addEventListener('DOMContentLoaded', () => {
  loadParams();
});
