var socket = io({ autoConnect: true });

var _rcoConnected = false;
var _rcoArmed = false;
var _rcoMaster = false;
var _rcoChannels = {};
var _rcoMonitor = {};
var _rcoTimer = null;
var _rcoSentCount = 0;
var _rcoPresets = {};
var _rcoCurrentPreset = null;

var RCO_CHANNEL_NAMES = ['Roll', 'Pitch', 'Thr', 'Yaw', 'Aux1', 'Aux2', 'Aux3', 'Aux4'];
var RCO_CHANNEL_DEFAULTS = [1500, 1500, 1000, 1500, 1500, 1500, 1500, 1500];

/* ---- Socket handlers ---- */
socket.on('connect', function() {
  rcoLog('Socket connected', 'info');
  loadRcoPresets();
  updateRcoSafety();
});

socket.on('disconnect', function() {
  _rcoConnected = false;
  rcoLog('Socket disconnected', 'warning');
  updateRcoSafety();
});

socket.on('state_update', function(data) {
  if (data.hasOwnProperty('connected')) _rcoConnected = data.connected;
  if (data.hasOwnProperty('armed')) _rcoArmed = data.armed;
  updateRcoSafety();
});

socket.on('log', function(data) {
  rcoLog(data.message, data.level || 'info');
});

/* ---- RC_CHANNELS monitoring ---- */
socket.on('rc_channels', function(data) {
  for (var i = 1; i <= 8; i++) {
    var raw = data['chan' + i + '_raw'];
    _rcoMonitor[i] = (raw !== undefined && raw !== null) ? raw : 0;
  }
  updateRcoMonitor();
});

/* ---- UI Initialization ---- */
function initRcoUI() {
  var list = document.getElementById('rcoChannelList');
  if (!list || list.children.length > 0) return;
  var h = '';
  for (var i = 0; i < 8; i++) {
    var ch = i + 1;
    _rcoChannels[ch] = 0;
    var name = RCO_CHANNEL_NAMES[i] || 'Ch' + ch;
    var def = RCO_CHANNEL_DEFAULTS[i] || 1500;
    h += '<div class="rco-ch-row" id="rcoChRow' + ch + '">';
    h += '<div class="rco-ch-bar"><div class="rco-ch-bar-fill" id="rcoBarFill' + ch + '"></div></div>';
    h += '<span class="rco-ch-num" title="Channel ' + ch + '">CH' + ch + '</span>';
    h += '<span class="rco-ch-name">' + name + '</span>';
    h += '<input type="range" class="rco-ch-slider" data-ch="' + ch + '" min="0" max="2100" value="0" oninput="onRcoSlider(this)">';
    h += '<input type="number" class="rco-ch-input" data-ch="' + ch + '" value="0" min="0" max="2100" onchange="onRcoInput(this)" onfocus="this.select()">';
    h += '<span class="rco-ch-monitor" id="rcoMon' + ch + '" title="Actual RC input">---</span>';
    h += '<button class="rco-ch-reset" data-ch="' + ch + '" onclick="resetRcoChannel(this)" title="Reset to 0 (no override)">&#x21BA;</button>';
    h += '</div>';
  }
  list.innerHTML = h;
  updateRcoActiveCount();
}

/* ---- Slider/Input handlers ---- */
function onRcoSlider(slider) {
  var ch = parseInt(slider.dataset.ch);
  var val = parseInt(slider.value);
  syncRcoChannel(ch, val);
  scheduleRcoSend();
}

function onRcoInput(input) {
  var ch = parseInt(input.dataset.ch);
  var val = parseInt(input.value) || 0;
  val = Math.max(0, Math.min(2100, val));
  input.value = val;
  syncRcoChannel(ch, val);
  scheduleRcoSend();
}

function syncRcoChannel(ch, val) {
  _rcoChannels[ch] = val;
  var row = document.getElementById('rcoChRow' + ch);
  var slider = row.querySelector('.rco-ch-slider');
  var input = row.querySelector('.rco-ch-input');
  if (slider) { slider.value = val; slider.classList.toggle('active', val > 0 && val >= 900); }
  if (input) input.value = val;
  row.classList.toggle('active', val > 0 && val >= 900);
  updateRcoActiveCount();
}

function resetRcoChannel(btn) {
  var ch = parseInt(btn.dataset.ch);
  _rcoChannels[ch] = 0;
  var row = document.getElementById('rcoChRow' + ch);
  var slider = row.querySelector('.rco-ch-slider');
  var input = row.querySelector('.rco-ch-input');
  if (slider) { slider.value = 0; slider.classList.remove('active'); }
  if (input) input.value = 0;
  row.classList.remove('active');
  updateRcoActiveCount();
  scheduleRcoSend();
}

/* ---- Master toggle ---- */
function toggleRcoMaster() {
  _rcoMaster = !_rcoMaster;
  var toggle = document.getElementById('rcoMasterToggle');
  var sub = document.getElementById('rcoMasterSub');
  toggle.classList.toggle('active', _rcoMaster);
  if (_rcoMaster) {
    sub.textContent = 'Enabled — overrides being sent';
    rcoLog('Master override ENABLED', 'warning');
  } else {
    sub.textContent = 'Disabled — no overrides sent';
    rcoLog('Master override DISABLED', 'info');
  }
  updateRcoSafety();
  if (_rcoMaster) scheduleRcoSend();
}

/* ---- Bulk controls ---- */
function neutralAllChannels() {
  for (var i = 1; i <= 8; i++) {
    var def = RCO_CHANNEL_DEFAULTS[i - 1] || 1500;
    _rcoChannels[i] = def;
    var row = document.getElementById('rcoChRow' + i);
    var slider = row.querySelector('.rco-ch-slider');
    var input = row.querySelector('.rco-ch-input');
    if (slider) { slider.value = def; slider.classList.toggle('active', def >= 900); }
    if (input) input.value = def;
    row.classList.toggle('active', def >= 900);
  }
  updateRcoActiveCount();
  rcoLog('All channels set to neutral (1500)', 'info');
  scheduleRcoSend();
}

function clearAllOverrides() {
  for (var i = 1; i <= 8; i++) {
    _rcoChannels[i] = 0;
    var row = document.getElementById('rcoChRow' + i);
    var slider = row.querySelector('.rco-ch-slider');
    var input = row.querySelector('.rco-ch-input');
    if (slider) { slider.value = 0; slider.classList.remove('active'); }
    if (input) input.value = 0;
    row.classList.remove('active');
  }
  updateRcoActiveCount();
  rcoLog('All overrides cleared', 'info');
  scheduleRcoSend();
}

/* ---- Send logic ---- */
function scheduleRcoSend() {
  if (!_rcoMaster) return;
  if (_rcoTimer) clearTimeout(_rcoTimer);
  _rcoTimer = setTimeout(sendRcoOverride, 50);
}

function sendRcoOverride() {
  _rcoTimer = null;
  var channels = {};
  var active = false;
  for (var i = 1; i <= 8; i++) {
    var v = _rcoChannels[i] || 0;
    channels['ch' + i] = v;
    if (v > 0 && v >= 900) active = true;
  }
  _rcoSentCount++;
  document.getElementById('rcoSentCount').textContent = _rcoSentCount;
  socket.emit('rc_override', { channels: channels });
  updateRcoStatus(active);
}

function updateRcoStatus(active) {
  var box = document.getElementById('rcoStatusBox');
  if (!_rcoMaster) {
    box.textContent = 'Master override is OFF';
    box.className = 'rco-status-box disabled';
  } else if (active) {
    box.textContent = 'Overriding ' + getActiveChannelCount() + ' channel(s)';
    box.className = 'rco-status-box active';
  } else {
    box.textContent = 'Idle — no channels being overridden';
    box.className = 'rco-status-box idle';
  }
}

function getActiveChannelCount() {
  var n = 0;
  for (var i = 1; i <= 8; i++) {
    if ((_rcoChannels[i] || 0) > 0 && _rcoChannels[i] >= 900) n++;
  }
  return n;
}

function updateRcoActiveCount() {
  var n = getActiveChannelCount();
  document.getElementById('rcoActiveChCount').textContent = n;
  var label = document.getElementById('activeChannelCount');
  if (n === 0) {
    label.textContent = 'No active overrides';
    label.style.color = '#64748b';
  } else {
    label.textContent = n + ' channel(s) active';
    label.style.color = '#eab308';
  }
}

/* ---- RC_CHANNELS Monitor ---- */
function updateRcoMonitor() {
  for (var i = 1; i <= 8; i++) {
    var el = document.getElementById('rcoMon' + i);
    var val = _rcoMonitor[i] || 0;
    if (val > 0 && val <= 2100) {
      el.textContent = val;
      el.classList.toggle('active', val >= 800);
    } else {
      el.textContent = '---';
      el.classList.remove('active');
    }
    var fill = document.getElementById('rcoBarFill' + i);
    if (fill) {
      var pct = 0;
      if (val > 0 && val <= 2100) {
        pct = Math.max(5, Math.min(100, ((val - 900) / 1200) * 100));
      }
      fill.style.height = pct + '%';
      fill.classList.toggle('active', _rcoChannels[i] > 0 && _rcoChannels[i] >= 900);
    }
  }
}

/* ---- Presets ---- */
function loadRcoPresets() {
  try {
    _rcoPresets = JSON.parse(localStorage.getItem('sgc_rc_presets')) || {};
  } catch(e) {
    _rcoPresets = {};
  }
  renderRcoPresets();
}

function renderRcoPresets() {
  var list = document.getElementById('rcoPresetList');
  if (!list) return;
  var names = Object.keys(_rcoPresets);
  list.innerHTML = '';
  if (names.length === 0) {
    list.innerHTML = '<span style="color:#475569;font-size:10px;font-style:italic">No saved presets</span>';
    return;
  }
  names.sort();
  names.forEach(function(name) {
    var btn = document.createElement('button');
    btn.className = 'rco-preset-btn' + (_rcoCurrentPreset === name ? ' active' : '');
    btn.textContent = name;
    btn.onclick = function() {
      loadRcoPreset(name);
    };
    btn.ondblclick = function() {
      if (confirm('Delete preset "' + name + '"?')) {
        delete _rcoPresets[name];
        if (_rcoCurrentPreset === name) _rcoCurrentPreset = null;
        saveRcoPresetsToDisk();
        renderRcoPresets();
        updateRcoPresetName();
        rcoLog('Preset "' + name + '" deleted', 'info');
      }
    };
    list.appendChild(btn);
  });
  updateRcoPresetName();
}

function loadRcoPreset(name) {
  var p = _rcoPresets[name];
  if (!p) return;
  _rcoCurrentPreset = name;
  for (var i = 1; i <= 8; i++) {
    var val = p['ch' + i] || 0;
    _rcoChannels[i] = val;
    var row = document.getElementById('rcoChRow' + i);
    if (row) {
      var slider = row.querySelector('.rco-ch-slider');
      var input = row.querySelector('.rco-ch-input');
      if (slider) { slider.value = val; slider.classList.toggle('active', val > 0 && val >= 900); }
      if (input) input.value = val;
      row.classList.toggle('active', val > 0 && val >= 900);
    }
  }
  updateRcoActiveCount();
  renderRcoPresets();
  rcoLog('Preset "' + name + '" loaded', 'success');
  scheduleRcoSend();
}

function saveRcoPreset() {
  if (_rcoCurrentPreset) {
    savePreset(_rcoCurrentPreset);
  } else {
    saveRcoPresetAs();
  }
}

function saveRcoPresetAs() {
  var input = document.getElementById('rcoPresetNameInput');
  var name = input.value.trim();
  if (!name) {
    name = 'Preset ' + (Object.keys(_rcoPresets).length + 1);
  }
  savePreset(name);
  input.value = '';
}

function savePreset(name) {
  var p = {};
  for (var i = 1; i <= 8; i++) {
    p['ch' + i] = _rcoChannels[i] || 0;
  }
  _rcoPresets[name] = p;
  _rcoCurrentPreset = name;
  saveRcoPresetsToDisk();
  renderRcoPresets();
  rcoLog('Preset "' + name + '" saved with ' + getActiveChannelCount() + ' active channel(s)', 'success');
}

function deleteRcoPreset() {
  if (!_rcoCurrentPreset) return;
  if (confirm('Delete preset "' + _rcoCurrentPreset + '"?')) {
    delete _rcoPresets[_rcoCurrentPreset];
    _rcoCurrentPreset = null;
    saveRcoPresetsToDisk();
    renderRcoPresets();
    updateRcoPresetName();
    rcoLog('Current preset deleted', 'info');
  }
}

function saveRcoPresetsToDisk() {
  try { localStorage.setItem('sgc_rc_presets', JSON.stringify(_rcoPresets)); } catch(e) {}
}

function updateRcoPresetName() {
  var el = document.getElementById('rcoPresetName');
  if (el) el.textContent = _rcoCurrentPreset || 'None loaded';
}

/* ---- Safety ---- */
function updateRcoSafety() {
  var connEl = document.getElementById('rcoSafetyConnected');
  var armedEl = document.getElementById('rcoSafetyArmed');
  var overrideEl = document.getElementById('rcoSafetyOverride');

  if (_rcoConnected) {
    connEl.className = 'rco-safety ok';
    connEl.innerHTML = '<span class="rco-safety-icon">&#x2713;</span><span>Connected to vehicle</span>';
  } else {
    connEl.className = 'rco-safety danger';
    connEl.innerHTML = '<span class="rco-safety-icon">&#x26A0;</span><span>Not connected to vehicle</span>';
  }

  if (_rcoArmed) {
    armedEl.className = 'rco-safety danger';
    armedEl.innerHTML = '<span class="rco-safety-icon">&#x26A0;</span><span>Vehicle is ARMED — override is blocked for safety</span>';
  } else {
    armedEl.className = 'rco-safety ok';
    armedEl.innerHTML = '<span class="rco-safety-icon">&#x2713;</span><span>Vehicle is disarmed</span>';
  }

  if (_rcoMaster) {
    overrideEl.className = 'rco-safety ok';
    overrideEl.innerHTML = '<span class="rco-safety-icon">&#x2713;</span><span>Master override is ON</span>';
  } else {
    overrideEl.className = 'rco-safety warn';
    overrideEl.innerHTML = '<span class="rco-safety-icon">&#x26A0;</span><span>Master override is OFF — enable to send values</span>';
  }
}

/* ---- Log ---- */
function rcoLog(msg, level) {
  level = level || 'info';
  var container = document.getElementById('rcoLog');
  var empty = container.querySelector('.rco-log-empty');
  if (empty) empty.remove();

  var now = new Date();
  var time = now.toLocaleTimeString('en-US', { hour12: false });
  var entry = document.createElement('div');
  entry.className = 'rco-log-entry';
  entry.innerHTML = '<span class="rco-log-time">[' + time + ']</span><span class="rco-log-msg ' + level + '">' + escHtml(msg) + '</span>';
  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;

  var entries = container.querySelectorAll('.rco-log-entry');
  if (entries.length > 200) entries[0].remove();
}

function clearRcoLog() {
  var container = document.getElementById('rcoLog');
  container.innerHTML = '<div class="rco-log-empty">RC override events will appear here</div>';
}

function escHtml(str) {
  var d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

/* ---- Init ---- */
document.addEventListener('DOMContentLoaded', function() {
  initRcoUI();
  updateRcoMonitor();
});
