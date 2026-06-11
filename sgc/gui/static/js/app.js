const socket = io();
let vehicle = {
  connected: false, lat: 0, lon: 0, heading: 0, mode: '---',
  armed: false, ground_speed: 0, alt: 0, satellites: 0, fix_type: 0,
  battery_remaining: 100, battery_voltage: 0, roll: 0, pitch: 0,
  hdop: 99.99,
};
let vehicleMarker = null;
let _homePos = null;
let vehicleCircle = null;
let trail = [];
let trailGroup = null;
let missionWpGroup = null;
let fenceGroup = null;
const TRAIL_MAX = 500;
const TRAIL_SEGMENTS = 10;
let targetPoints = [];
let targetGroup = null;
var _logsRequested = false;

socket.on('connect', () => {
  if (!_logsRequested) {
    _logsRequested = true;
    socket.emit('request_logs');
  }
});

function buildConnString() {
  var type = document.getElementById('connType').value;
  if (type === 'sitl') {
    return { conn: 'udpin:0.0.0.0:14550', baud: 57600 };
  } else if (type === 'serial') {
    var port = document.getElementById('connSerialPort').value;
    var baud = document.getElementById('connBaudSerial').value;
    if (!port) return { conn: '', baud: 0 };
    return { conn: port, baud: parseInt(baud) };
  } else if (type === 'tcp') {
    var a = document.getElementById('connTcpAddr').value || '127.0.0.1';
    var p = document.getElementById('connTcpPort').value || '5760';
    return { conn: 'tcpout:' + a + ':' + p, baud: 57600 };
  } else if (type === 'tcpsrv') {
    var p = document.getElementById('connTcpSrvPort').value || '5760';
    return { conn: 'tcpin:0.0.0.0:' + p, baud: 57600 };
  } else if (type === 'udp') {
    var mode = document.getElementById('connUdpMode').value;
    var port = document.getElementById('connUdpPort').value || '14550';
    if (mode === 'in') {
      return { conn: 'udpin:0.0.0.0:' + port, baud: 57600 };
    } else {
      var a = document.getElementById('connUdpAddr').value || '127.0.0.1';
      return { conn: 'udpout:' + a + ':' + port, baud: 57600 };
    }
  }
  return { conn: 'udpin:0.0.0.0:14550', baud: 57600 };
}

function onConnTypeChange() {
  var type = document.getElementById('connType').value;
  document.getElementById('connSitlFields').classList.toggle('hidden', type !== 'sitl');
  document.getElementById('connSerialFields').classList.toggle('hidden', type !== 'serial');
  document.getElementById('connTcpFields').classList.toggle('hidden', type !== 'tcp');
  document.getElementById('connTcpSrvFields').classList.toggle('hidden', type !== 'tcpsrv');
  document.getElementById('connUdpFields').classList.toggle('hidden', type !== 'udp');
  updateConnPreview();
}

function updateConnPreview() {
  var r = buildConnString();
  var el = document.getElementById('connStringPreview');
  if (el) el.textContent = r.conn + ' @ ' + r.baud + ' baud';
}

function scanSerialPorts() {
  var sel = document.getElementById('connSerialPort');
  sel.innerHTML = '<option value="">Scanning...</option>';
  fetch('/api/ports').then(function(r) { return r.json(); }).then(function(ports) {
    sel.innerHTML = '';
    if (!ports || ports.length === 0) {
      sel.innerHTML = '<option value="">No ports found</option>';
      return;
    }
    ports.forEach(function(p) {
      var opt = document.createElement('option');
      opt.value = p.device;
      opt.textContent = p.device + ' (' + (p.description || 'Unknown') + ')';
      sel.appendChild(opt);
    });
  }).catch(function() {
    sel.innerHTML = '<option value="">Scan failed</option>';
  });
}

function toggleConnection() {
  var btn = document.getElementById('connectBtn');
  if (window.vehicle && window.vehicle.connected) {
    btn.textContent = '\u25CF Disconnecting...';
    btn.disabled = true;
    socket.emit('disconnect_request');
  } else {
    showConnDialog();
  }
}

function showConnDialog() {
  document.getElementById('connDialog').classList.remove('hidden');
  var udpMode = document.getElementById('connUdpMode');
  if (udpMode) {
    var row = document.getElementById('connUdpAddrRow');
    if (row) row.style.display = udpMode.value === 'out' ? 'flex' : 'none';
  }
  updateConnPreview();
  onConnTypeChange();
  scanSerialPorts();
}

function closeConnDialog() {
  document.getElementById('connDialog').classList.add('hidden');
}

function doConnect() {
  var r = buildConnString();
  if (!r.conn) {
    log('Please select a connection port/address', 'error');
    return;
  }
  closeConnDialog();
  var btn = document.getElementById('connectBtn');
  if (btn) { btn.textContent = '\u25CF Connecting...'; btn.disabled = true; btn.style.opacity = '0.5'; }
  socket.emit('connect_request', { connection: r.conn, baud: r.baud });
}

// Set up connection dialog listeners
function initConnDialog() {
  var inputs = document.querySelectorAll('#connDialog input, #connDialog select');
  inputs.forEach(function(el) {
    el.addEventListener('change', updateConnPreview);
    el.addEventListener('input', updateConnPreview);
  });
  var udpMode = document.getElementById('connUdpMode');
  if (udpMode) {
    udpMode.addEventListener('change', function() {
      var row = document.getElementById('connUdpAddrRow');
      if (row) row.style.display = this.value === 'out' ? 'flex' : 'none';
      updateConnPreview();
    });
  }
}
document.addEventListener('DOMContentLoaded', initConnDialog);

socket.on('state_update', (data) => {
  vehicle = data; window.vehicle = data;
  updateTelemetry(data);

  var btn = document.getElementById('connectBtn');
  if (btn) {
    if (data.connected) {
      btn.textContent = '\u25CF Connected';
      btn.classList.add('connected');
      btn.disabled = false;
      btn.style.opacity = '1';
    } else {
      btn.textContent = '\u25CF Connect';
      btn.classList.remove('connected');
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  }
  updateMap(data);
  updateActions(data);
  updateStatusBar(data);
  feedCharts(data);
  updateSensorHealth(data);
  updateFlightStats(data);
  checkNotifications(data);
  updateHud(data);
  updateMissionPanel(data);
  updateTargetDistPanel(data);
  if (data.connected) {
    if (!window._reqMission) {
      window._reqMission = true;
      socket.emit('request_mission');
    }
    if (!window._reqFence) {
      window._reqFence = true;
      socket.emit('request_fence');
    }
  } else {
    window._reqMission = false;
    window._reqFence = false;
    window._lastMissionData = null;
    window._lastFenceData = null;
    _homePos = null;
    if (missionWpGroup) { missionWpGroup.clearLayers(); }
    if (fenceGroup) { fenceGroup.clearLayers(); }
  }
});

socket.on('log', (data) => {
  log(data.message, data.level);
  var msg = (data.message || '').toLowerCase();
  if (msg.includes('prearm') || msg.includes('pre-arm') || msg.includes('check failed') || (data.level === 'error' && msg.includes('arming'))) {
    notify(data.message, 'danger');
  }
  // Don't let our own server log messages trigger calibration UI
  if (_calActive && !msg.includes('got command_ack') && !msg.startsWith('sending') && !msg.startsWith('starting') && (msg.includes('place') || msg.includes('rotate') || msg.includes('calibration') || msg.includes('progress') || msg.includes('orient') || msg.includes('finished') || msg.includes('complete') || msg.includes('continue') || msg.includes('success') || msg.includes('failed') || msg.includes('rejected') || msg.includes('trim ok') || msg.includes('trim:'))) {
    updateCalibration(data.message);
  }
});

socket.on('mission_data', (data) => {
  window._lastMissionData = data;
  drawMissionWaypoints(data.waypoints || []);
  updateMissionPanel(window.vehicle || {});

  var el = document.getElementById('s_mission');
  if (el) el.textContent = '\u25CF Mission: ' + (data.count || 0);
});

socket.on('fence_data', (data) => {
  window._lastFenceData = data;
  drawFencePoints(data.points || []);
  updateFencePanel(data);
  var el = document.getElementById('s_fence');
  if (el) el.textContent = '\u25CF Fence: ' + (data.count || 0);
});

socket.on('tlog_status', (data) => {
  const btn = document.getElementById('tlogBtn');
  if (!btn) return;
  if (data.active) { btn.classList.add('active'); btn.textContent = '\u25A0 LOG'; }
  else { btn.classList.remove('active'); btn.textContent = '\u25CF LOG'; }
});

function toggleTlog() {
  const btn = document.getElementById('tlogBtn');
  if (!btn) return;
  if (btn.classList.contains('active')) {
    socket.emit('stop_tlog');
    btn.classList.remove('active');
  } else {
    socket.emit('start_tlog');
    btn.classList.add('active');
  }
}

function log(message, level = 'info') {
  const el = document.getElementById('consoleOutput');
  if (!el) return;
  const div = document.createElement('div');
  div.className = `log-${level}`;
  var t = new Date();
  div.textContent = '[' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0') + '] ' + message;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function setMode() {
  const mode = document.getElementById('flightModeSelect').value;
  log(`Setting mode: ${mode}`, 'info');
  socket.emit('set_mode', { mode });
}

function arm() {
  socket.emit('arm');
}
function disarm() {
  socket.emit('disarm');
}
function command(cmd, extra = {}) {
  console.log('command:', cmd, extra);
  socket.emit('command', { command: cmd, ...extra });
}

function takeoffPrompt() {
  const alt = prompt('Takeoff altitude (m):', '10');
  if (alt === null) return;
  command('TAKEOFF', { altitude: parseFloat(alt) || 10 });
}

function armTakeoff() {
  const alt = prompt('Takeoff altitude (m):', '10');
  if (alt === null) return;
  socket.emit('set_mode', { mode: 'GUIDED' });
  setTimeout(() => { socket.emit('arm'); }, 500);
  setTimeout(() => { command('TAKEOFF', { altitude: parseFloat(alt) || 10 }); }, 2000);
}

// --- Calibration ---
var _calActive = false;
var _calType = '';
var _calMagCompasses = {};
var _calMagFinished = {};
var _accelPos = -1;

var ACCEL_POSITIONS = [
  { name: 'Level', desc: 'Place vehicle level (upright)', short: 'LEVEL' },
  { name: 'Right Side', desc: 'Place on its RIGHT side', short: 'RIGHT' },
  { name: 'Left Side', desc: 'Place on its LEFT side', short: 'LEFT' },
  { name: 'Nose Down', desc: 'Point nose DOWN', short: 'DOWN' },
  { name: 'Nose Up', desc: 'Point nose UP', short: 'UP' },
  { name: 'On Back', desc: 'Place on its BACK', short: 'BACK' },
];

var CAL_PROGRESS = {
  gyro: { steps: 1, label: 'Gyroscope' },
  accel: { steps: 6, label: 'Accelerometer' },
  mag: { steps: 1, label: 'Compass' },
  accel_simple: { steps: 1, label: 'Simple Accel' },
  level: { steps: 1, label: 'Level Horizon' },
  radio: { steps: 1, label: 'Radio' },
  pressure: { steps: 1, label: 'Pressure' },
};

function startCalibration(type) {
  _calActive = true;
  _calType = type;
  _calMagCompasses = {};
  _calMagFinished = {};
  _accelPos = -1;

  var label = CAL_PROGRESS[type] ? CAL_PROGRESS[type].label : type;
  document.getElementById('calTitle').textContent = label + ' Calibration';
  document.getElementById('calInstruction').textContent = 'Starting ' + label.toLowerCase() + ' calibration...';
  document.getElementById('calStatus').textContent = '';
  document.getElementById('calProgressBar').style.width = '0%';
  document.getElementById('calContinueBtn').classList.add('hidden');
  document.getElementById('calMagCompasses').classList.add('hidden');
  document.getElementById('calResult').classList.add('hidden');
  clearCalWaitingTimer();
  document.getElementById('calAbortBtn').textContent = 'Abort';
  document.getElementById('calAbortBtn').disabled = false;
  document.getElementById('calModal').classList.remove('hidden');

  if (type === 'mag') {
    document.getElementById('calMagBars').innerHTML = '';
    document.getElementById('calMagCompasses').classList.remove('hidden');
    document.getElementById('calInstruction').textContent = 'Hold the vehicle and rotate it so each side points down toward the earth. Perform full 360-degree turns with each direction facing down.';
  }

  if (type === 'accel') {
    document.getElementById('calInstruction').innerHTML = 'Full 3-axis accelerometer calibration<br><span style="font-size:11px;color:#94a3b8">Place vehicle in each position when prompted and click Continue.</span>';
  }

  if (type === 'accel_simple') {
    document.getElementById('calInstruction').innerHTML = 'Simple accelerometer calibration<br><span style="font-size:11px;color:#94a3b8">Keep vehicle level and still. Only one position needed.</span>';
  }

  socket.emit('calibrate', { type: type });
}

var _calWaitingTimer = null;

function clearCalWaitingTimer() {
  if (_calWaitingTimer) { clearTimeout(_calWaitingTimer); _calWaitingTimer = null; }
}

function continueCalibration() {
  if (!_calActive) return;
  clearCalWaitingTimer();
  var isAccel = _calType === 'accel' || _calType === 'accel_simple';
  if (isAccel) {
    document.getElementById('calInstruction').innerHTML = '<span style="color:#e2e8f0">Position confirmed</span><br><span style="font-size:11px;color:#94a3b8">Communicating with FCU, collecting samples... keep vehicle still</span>';
    document.getElementById('calStatus').textContent = 'Waiting for FCU...';
    // Show a "still waiting" message after 5 seconds
    _calWaitingTimer = setTimeout(function() {
      if (_calActive) {
        document.getElementById('calStatus').textContent = 'Still waiting for FCU — the calibration may take 10-30 seconds per position. Keep the vehicle still.';
      }
    }, 5000);
  } else {
    document.getElementById('calInstruction').textContent = 'Waiting for next step...';
    document.getElementById('calStatus').textContent = 'Position confirmed, communicating with FCU...';
  }
  document.getElementById('calContinueBtn').classList.add('hidden');
  // Accel advance: send position index so backend uses MAV_CMD_ACCELCAL_VEHICLE_POS
  var calData = { type: _calType, confirm: isAccel };
  if (_calType === 'accel') {
    calData.position = _accelPos;
  }
  socket.emit('calibrate', calData);
}

function abortCalibration() {
  if (_calActive && _calType === 'mag') {
    socket.emit('calibrate', { type: 'cancel' });
  }
  _calActive = false;
  _calType = '';
  _calMagCompasses = {};
  _calMagFinished = {};
  _accelPos = -1;
  clearCalWaitingTimer();
  document.getElementById('calModal').classList.add('hidden');
}

function rebootFcu() {
  socket.emit('reboot_fcu');
  notify('Reboot command sent, reconnecting...', 'info');
}

function enableCompassLearn() {
  socket.emit('param_set', { name: 'COMPASS_LEARN', value: 2 });
  notify('COMPASS_LEARN set to 2 (auto-learn). Reboot recommended.', 'info');
}

function rebootAfterCal() {
  rebootFcu();
  _calActive = false;
  _calType = '';
  _calMagFinished = {};
  clearCalWaitingTimer();
  document.getElementById('calModal').classList.add('hidden');
}

function updateCalibration(msg) {
  if (!_calActive) return;
  clearCalWaitingTimer();
  document.getElementById('calInstruction').textContent = msg;
  document.getElementById('calStatus').textContent = msg;

  var lower = msg.toLowerCase();
  var finished = lower.includes('finished') || lower.includes('complete') || lower.includes('success') || lower.includes('passed') || lower.includes('trim ok') || lower.includes('trim:');

  var isAccel = _calType === 'accel';
  var needsContinue = isAccel && !finished && (lower.includes('place') || lower.includes('orient') || lower.includes('position') || lower.includes('level') || lower.includes('press any key'));
  document.getElementById('calContinueBtn').classList.toggle('hidden', !needsContinue);

  // Track accel position
  if (isAccel && needsContinue) {
    _accelPos++;
    if (_accelPos < ACCEL_POSITIONS.length) {
      var pos = ACCEL_POSITIONS[_accelPos];
      var pct = Math.round((_accelPos / ACCEL_POSITIONS.length) * 100);
      document.getElementById('calProgressBar').style.width = pct + '%';
      document.getElementById('calInstruction').innerHTML =
        '<div style="font-size:11px;color:#94a3b8;margin-bottom:4px">Position ' + (_accelPos + 1) + ' of ' + ACCEL_POSITIONS.length + '</div>' +
        '<span style="font-weight:700;color:#e2e8f0">' + pos.name + '</span><br>' +
        '<span style="font-size:12px;color:#cbd5e1">' + pos.desc + '</span><br>' +
        '<span style="font-size:10px;color:#64748b">Keep vehicle still and click Continue</span>';
    }
  }

  if (finished) {
    document.getElementById('calProgressBar').style.width = '100%';
    document.getElementById('calInstruction').innerHTML = '<span style="font-weight:700;color:#22c55e">Calibration successful!</span>';
    document.getElementById('calStatus').textContent = '';
    if (_calType !== 'mag') {
      setTimeout(function() {
        _calActive = false;
        _calType = '';
        document.getElementById('calModal').classList.add('hidden');
      }, 2500);
    }
  }

  if (lower.includes('failed') || lower.includes('rejected')) {
    document.getElementById('calProgressBar').style.width = '100%';
    document.getElementById('calInstruction').innerHTML = '<span style="font-weight:700;color:#ef4444">Calibration failed</span>';
    if (_calType !== 'mag') {
      setTimeout(function() {
        _calActive = false;
        _calType = '';
        document.getElementById('calModal').classList.add('hidden');
      }, 3000);
    }
  }
}

socket.on('mag_cal_progress', function(data) {
  if (!_calActive || _calType !== 'mag') return;
  var activeId = data.compass_id;
  var calMask = data.cal_mask || 0;
  var pct = Math.round((data.completion_pct || 0) * 100 / 255);

  // Ensure all compasses in the mask have a progress bar
  for (var i = 0; i < 4; i++) {
    if (calMask & (1 << i)) {
      if (!_calMagCompasses[i]) {
        _calMagCompasses[i] = true;
        _calMagFinished[i] = false;
        renderMagCompassBar(i);
      }
    }
  }

  // Update the actively calibrating compass
  updateMagCompassBar(activeId, pct);
  // Overall progress: average of all active compass progress
  var totalPct = 0; var count = 0;
  for (var j = 0; j < 4; j++) {
    if (_calMagCompasses[j] && !_calMagFinished[j]) {
      var fill = document.getElementById('cal_mag_fill_' + j);
      if (fill) {
        var w = parseFloat(fill.style.width) || 0;
        totalPct += w; count++;
      }
    }
  }
  document.getElementById('calProgressBar').style.width = (count ? Math.round(totalPct / count) : 0) + '%';
});

function renderMagCompassBar(id) {
  var container = document.getElementById('calMagBars');
  var row = document.createElement('div');
  row.className = 'cal-mag-row';
  row.id = 'cal_mag_row_' + id;
  row.innerHTML =
    '<span class="cal-mag-label">Compass #' + id + '</span>' +
    '<div class="cal-mag-track">' +
      '<div id="cal_mag_fill_' + id + '" class="cal-mag-fill active" style="width:0%"></div>' +
    '</div>' +
    '<span id="cal_mag_pct_' + id + '" class="cal-mag-pct">0%</span>';
  container.appendChild(row);
}

function updateMagCompassBar(id, pct) {
  var fill = document.getElementById('cal_mag_fill_' + id);
  var pctEl = document.getElementById('cal_mag_pct_' + id);
  if (!fill || !pctEl) return;
  if (!_calMagFinished[id]) {
    fill.style.width = Math.min(100, pct) + '%';
    pctEl.textContent = pct + '%';
  }
}

socket.on('mag_cal_report', function(data) {
  if (!_calActive || _calType !== 'mag') return;
  var id = data.compass_id;
  var status = data.cal_status;

  // Ensure the compass bar exists (in case MAG_CAL_PROGRESS was never received)
  if (!_calMagCompasses[id]) {
    _calMagCompasses[id] = true;
    _calMagFinished[id] = false;
    renderMagCompassBar(id);
  }

  var pctEl = document.getElementById('cal_mag_pct_' + id);
  var fill = document.getElementById('cal_mag_fill_' + id);

  if (status === 4) { // COMPLETED
    if (fill) { fill.className = 'cal-mag-fill done'; fill.style.width = '100%'; }
    if (pctEl) pctEl.textContent = '100%';
    _calMagFinished[id] = true;
  } else if (status === 3) { // FAILED
    if (fill) { fill.className = 'cal-mag-fill failed'; }
    _calMagFinished[id] = true;
  } else if (status === 5) { // BAD_ORIENTATION
    if (fill) { fill.className = 'cal-mag-fill failed'; }
    _calMagFinished[id] = true;
    notify('Compass #' + id + ': bad orientation', 'warning');
  } else if (status === 6) { // BAD_RADIUS
    if (fill) { fill.className = 'cal-mag-fill failed'; }
    _calMagFinished[id] = true;
    notify('Compass #' + id + ': bad radius', 'warning');
  }

  // Check if all compasses finished
  var allDone = true;
  for (var cid in _calMagCompasses) {
    if (!_calMagFinished[cid]) { allDone = false; break; }
  }

  if (allDone) {
    _calActive = false;
    var autosaved = data.autosaved;
    var success = true;
    var failedCompasses = [];
    for (var cid2 in _calMagFinished) {
      if (!_calMagFinished[cid2]) { success = false; failedCompasses.push(cid2); }
    }

    document.getElementById('calProgressBar').style.width = '100%';
    var resultDiv = document.getElementById('calResult');
    var resultText = document.getElementById('calResultText');
    var offsetsDiv = document.getElementById('calResultOffsets');
    var rebootBtn = document.getElementById('calRebootBtn');

    resultDiv.classList.remove('hidden');

    if (success) {
      resultText.textContent = 'Calibration successful!';
      resultText.className = 'cal-result-text success';
      offsetsDiv.textContent = 'Offsets: X=' + data.ofs_x + ' Y=' + data.ofs_y + ' Z=' + data.ofs_z + ' (confidence: ' + data.confidence + '%)';
      rebootBtn.classList.remove('hidden');
      if (autosaved) {
        document.getElementById('calStatus').textContent = 'Offsets auto-saved. A reboot is required to use them.';
      } else {
        document.getElementById('calStatus').textContent = 'Reboot required to apply calibration.';
      }
      document.getElementById('calInstruction').textContent = 'All compasses calibrated successfully.';
    } else {
      resultText.textContent = 'Calibration failed for some compasses';
      resultText.className = 'cal-result-text failed';
      offsetsDiv.textContent = '';
      rebootBtn.classList.add('hidden');
      document.getElementById('calStatus').textContent = 'Try again or adjust calibration settings.';
      document.getElementById('calInstruction').textContent = 'Failed compasses: #' + failedCompasses.join(', #');
    }
    document.getElementById('calAbortBtn').textContent = 'Close';
  }
});

function updateTelemetry(data) {
  setText('t_lat', data.lat?.toFixed(7) ?? '0.0000000');
  setText('t_lon', data.lon?.toFixed(7) ?? '0.0000000');
  setText('t_alt', data.alt?.toFixed(2) ?? '0.00');
  setText('t_speed', data.ground_speed?.toFixed(2) ?? '0.00');
  setText('t_heading', data.heading?.toFixed(1) ?? '0.0');
  setText('t_volt', data.battery_voltage?.toFixed(2) ?? '0.00');
  setText('t_current', data.battery_current?.toFixed(2) ?? '0.00');

  const rem = Math.round(data.battery_remaining ?? 0);
  const remDisplay = data.battery_remaining >= 0 ? rem : '--';
  setText('t_batt_rem', remDisplay);

  const fill = document.getElementById('batteryFill');
  const pct = data.battery_remaining >= 0 ? rem : 0;
  fill.style.width = pct + '%';
  fill.style.background = pct > 50 ? '#22c55e' : pct > 20 ? '#eab308' : '#ef4444';
  fill.nextElementSibling.textContent = (data.battery_remaining >= 0 ? pct : '--') + '%';

  setText('t_roll', data.roll?.toFixed(1) ?? '0.0');
  setText('t_pitch', data.pitch?.toFixed(1) ?? '0.0');
  setText('t_yaw', data.yaw?.toFixed(1) ?? '0.0');

  drawAttitude(data.roll ?? 0, data.pitch ?? 0);

  setText('t_mode', data.mode ?? '---');
  const armedEl = document.getElementById('t_armed');
  armedEl.textContent = data.armed ? 'YES' : 'NO';
  armedEl.style.color = data.armed ? '#ef4444' : '#94a3b8';

  setText('t_sats', data.satellites ?? 0);
  setText('t_hdop', data.hdop?.toFixed(2) ?? '0.00');
  const fixTypes = {0: 'No Fix', 1: 'No Fix', 2: '2D', 3: '3D', 4: 'DGPS', 5: 'RTK Float', 6: 'RTK Fixed'};
  setText('t_fix', fixTypes[data.fix_type] ?? 'Unknown');

  // Home distance & bearing
  if (window.homeLatLng && data.lat && data.lon) {
    var hl = window.homeLatLng;
    var d = haversine(hl[0], hl[1], data.lat, data.lon);
    var b = bearing(hl[0], hl[1], data.lat, data.lon);
    setText('t_home_dist', d >= 1000 ? (d / 1000).toFixed(2) : d.toFixed(0));
    document.querySelector('#t_home_dist + .row-unit').textContent = d >= 1000 ? 'km' : 'm';
    setText('t_home_bearing', b.toFixed(0) + '\u00B0 ' + dirName(b));
    setText('s_home', '\u25CF Dist: ' + (d >= 1000 ? (d / 1000).toFixed(2) + 'km' : d.toFixed(0) + 'm') + ' | Brg: ' + b.toFixed(0) + '\u00B0');
  }
}

function drawAttitude(roll, pitch) {
  const canvas = document.getElementById('attitudeCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 6;

  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#0f172a';
  ctx.fill();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(roll * Math.PI / 180);
  const pitchOff = Math.max(-r + 10, Math.min(r - 10, pitch * 1.5));
  ctx.beginPath();
  ctx.moveTo(-r + 8, -pitchOff);
  ctx.lineTo(r - 8, -pitchOff);
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.moveTo(-4, -pitchOff);
  ctx.lineTo(-2, -pitchOff - 4);
  ctx.moveTo(2, -pitchOff - 4);
  ctx.lineTo(4, -pitchOff);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -pitchOff - 6);
  ctx.lineTo(0, -pitchOff - 12);
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#7c3aed';
  ctx.fill();
}

function updateMap(data) {
  if (data.lat && data.lon && vehicleMarker) {
    const latlng = [data.lat, data.lon];
    vehicleMarker.setLatLng(latlng);
    _homePos = { lat: data.lat, lon: data.lon };
    const heading = data.heading || 0;
    const arrow = vehicleMarker.getElement()?.querySelector('.vehicle-arrow');
    if (arrow) {
      arrow.style.transform = `rotate(${heading}deg)`;
    }
    if (data.connected) {
      map.setView(latlng, map.getZoom());
    }
    trail.push(latlng);
    if (trail.length > TRAIL_MAX) trail.splice(0, trail.length - TRAIL_MAX);
    rebuildTrail();
  }
}

function rebuildTrail() {
  if (!trailGroup) return;
  trailGroup.clearLayers();
  var n = trail.length;
  if (n < 2) return;
  var segs = TRAIL_SEGMENTS;
  var segSize = Math.ceil(n / segs);
  for (var i = 0; i < segs; i++) {
    var start = i * segSize;
    var end = Math.min((i + 1) * segSize, n);
    if (end - start < 2) continue;
    var opacity = 0.05 + (i / segs) * 0.65;
    L.polyline(trail.slice(start, end), {
      color: '#0ea5e9', weight: 2, opacity: opacity, interactive: false,
    }).addTo(trailGroup);
  }
  // dots every ~10th point
  var dotStep = Math.max(1, Math.floor(n / 50));
  for (var i = 0; i < n; i += dotStep) {
    var dotOp = 0.1 + (i / n) * 0.8;
    L.circleMarker(trail[i], {
      radius: 1.5, color: '#0ea5e9', fillColor: '#0ea5e9',
      fillOpacity: dotOp, weight: 0, interactive: false,
    }).addTo(trailGroup);
  }
}

function drawMissionWaypoints(wps) {
  if (!missionWpGroup) return;
  missionWpGroup.clearLayers();
  if (!wps || wps.length === 0) return;
  var pts = [];
  for (var i = 0; i < wps.length; i++) {
    var wp = wps[i];
    if (!wp.x || !wp.y) continue;
    var latlng = [wp.x, wp.y];
    pts.push(latlng);
    var num = i + 1;
    L.marker(latlng, {
      icon: L.divIcon({
        className: 'wp-marker',
        html: '<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:rgba(14,165,233,0.8);color:#fff;border:2px solid #fff;border-radius:50%;font-size:10px;font-weight:bold;box-shadow:0 0 6px rgba(0,0,0,0.4);">' + num + '</span>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
      interactive: false,
    }).addTo(missionWpGroup);
  }
  if (pts.length >= 1) {
    L.polyline(pts, {color: '#0ea5e9', weight: 2, opacity: 0.5, dashArray: '6,4', interactive: false}).addTo(missionWpGroup);
  }
  if (_homePos && pts.length > 0) {
    L.marker([_homePos.lat, _homePos.lon], {
      icon: L.divIcon({
        className: 'home-marker',
        html: '<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:#22c55e;color:#fff;border:2px solid #fff;border-radius:50%;font-size:12px;font-weight:bold;box-shadow:0 0 8px rgba(34,197,94,0.5);">H</span>',
        iconSize: [24, 24], iconAnchor: [12, 12],
      }),
      interactive: false,
    }).addTo(missionWpGroup);
    L.polyline([[_homePos.lat, _homePos.lon], pts[0]], {
      color: '#22c55e', weight: 2, opacity: 0.4, dashArray: '4,4', interactive: false,
    }).addTo(missionWpGroup);
  }
}

function drawFencePoints(pts) {
  if (!fenceGroup) return;
  fenceGroup.clearLayers();
  if (!pts || pts.length < 3) return;
  var latlngs = pts.map(function(p) { return [p[0], p[1]]; });
  L.polygon(latlngs, {
    color: '#eab308', weight: 2, fillColor: '#eab308', fillOpacity: 0.12, interactive: false,
  }).addTo(fenceGroup);
  latlngs.forEach(function(ll) {
    L.circleMarker(ll, {
      radius: 4, color: '#eab308', fillColor: '#eab308', fillOpacity: 0.6, weight: 1, interactive: false,
    }).addTo(fenceGroup);
  });
}

function initMap(lat, lon) {
  try {
    window.map = L.map('map', {
      center: [lat, lon], zoom: 16, zoomControl: true, attributionControl: false,
    });

    var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
    var sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' });
    var topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '&copy; OpenTopoMap' });
    var dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '&copy; CARTO' });

    osm.addTo(window.map);

    var gridLayer = addGrid(window.map);
    trailGroup = L.featureGroup().addTo(window.map);
    missionWpGroup = L.featureGroup().addTo(window.map);
    fenceGroup = L.featureGroup().addTo(window.map);
    targetGroup = L.featureGroup().addTo(window.map);

    L.control.layers({
      'Street': osm,
      'Satellite': sat,
      'Topo': topo,
      'Dark': dark,
    }, {
      'Grid': gridLayer,
      'Trail': trailGroup,
      'Mission WPs': missionWpGroup,
      'Fence': fenceGroup,
      'Targets': targetGroup,
    }, { position: 'topright' }).addTo(window.map);
    if (window._lastMissionData) drawMissionWaypoints(window._lastMissionData.waypoints || []);
    if (window._lastFenceData) drawFencePoints(window._lastFenceData.points || []);

    window.homeLatLng = [lat, lon];
    const homeIcon = L.divIcon({
      className: 'home-icon',
      html: `<div style="width:12px;height:12px;background:#22c55e;border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(34,197,94,0.6);"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
    L.marker(window.homeLatLng, { icon: homeIcon })
      .addTo(window.map).bindTooltip('Home', { direction: 'top' });

    vehicleMarker = L.marker([lat, lon], {
      icon: L.divIcon({
        className: 'vehicle-icon',
        html: `<div class="vehicle-arrow" style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:20px solid #0ea5e9;filter:drop-shadow(0 0 4px rgba(14,165,233,0.6));"></div>`,
        iconSize: [14, 20],
        iconAnchor: [7, 10],
      }),
      zIndexOffset: 1000,
    }).addTo(window.map);

    vehicleCircle = L.circle([lat, lon], {
      radius: 3, color: '#0ea5e9', fillColor: '#0ea5e9',
      fillOpacity: 0.3, weight: 1,
    }).addTo(window.map);

    window.map.on('contextmenu', (e) => {
      if (measure.active) { stopMeasuring(); return; }
      const ll = e.latlng;
      const menu = document.getElementById('mapContextMenu');
      if (!menu) return;
      menu.style.left = `${e.originalEvent.clientX}px`;
      menu.style.top = `${e.originalEvent.clientY}px`;
      menu.dataset.lat = ll.lat.toFixed(7);
      menu.dataset.lon = ll.lng.toFixed(7);
      menu.classList.remove('hidden');
    });
  } catch (e) {
    log(`Map init error: ${e}`, 'error');
  }
  setTimeout(() => { try { window.map?.invalidateSize(); } catch {} }, 200);
}

document.addEventListener('click', () => {
  const menu = document.getElementById('mapContextMenu');
  if (menu) menu.classList.add('hidden');
});

function flyToHere() {
  const menu = document.getElementById('mapContextMenu');
  const lat = parseFloat(menu.dataset.lat);
  const lon = parseFloat(menu.dataset.lon);
  menu.classList.add('hidden');
  const alt = prompt('Altitude (m):', '50');
  if (alt === null) return;
  command('GUIDED_GOTO', { lat, lon, altitude: parseFloat(alt) || 50 });
}

/* Measurement Tool */
var measure = {
  active: false, points: [], polyline: null, markers: [], labels: [],
  totalDistance: 0, unit: 'm', mouseMoveHandler: null, previewLine: null,
};

function convertDist(d, unit) {
  if (unit === 'cm') return d * 100;
  if (unit === 'km') return d / 1000;
  if (unit === 'in') return d * 39.3701;
  if (unit === 'ft') return d * 3.28084;
  return d;
}
function distSuffix(unit) {
  if (unit === 'cm') return 'cm';
  if (unit === 'km') return 'km';
  if (unit === 'in') return 'in';
  if (unit === 'ft') return 'ft';
  return 'm';
}
function formatDist(d, unit) {
  var v = convertDist(d, unit);
  if (unit === 'km' && v >= 1) return v.toFixed(3) + ' ' + distSuffix(unit);
  if (unit === 'km') return (v * 1000).toFixed(1) + ' m';
  if (v >= 1000) return v.toFixed(1) + ' ' + distSuffix(unit);
  if (v >= 100) return v.toFixed(1) + ' ' + distSuffix(unit);
  if (v >= 1) return v.toFixed(2) + ' ' + distSuffix(unit);
  return v.toFixed(3) + ' ' + distSuffix(unit);
}
function bearing(lat1, lng1, lat2, lng2) {
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
  var x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180)
        - Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
  var brng = Math.atan2(y, x) * 180 / Math.PI;
  return ((brng + 360) % 360);
}

function updateMeasureInfo(dist, brg) {
  var dEl = document.getElementById('measureDist');
  var bEl = document.getElementById('measureBearing');
  if (dEl) dEl.textContent = dist != null ? formatDist(dist, measure.unit) : '---';
  if (bEl) bEl.textContent = brg != null ? brg.toFixed(3) + '\u00B0' : '---';
}

function toggleMeasure() {
  var btn = document.getElementById('measureBtn');
  if (measure.active) {
    stopMeasuring();
    btn.classList.remove('active');
  } else {
    startMeasuring();
    btn.classList.add('active');
  }
}

function toggleMissionPanel() {
  var panel = document.getElementById('missionPanel');
  var btn = document.getElementById('missionBtn');
  if (!panel) return;
  var show = panel.classList.toggle('hidden');
  if (btn) btn.classList.toggle('active', show);
}

function updateMissionPanel(data) {
  document.getElementById('missionMode').textContent = data.mode ?? '---';
  document.getElementById('missionAlt').textContent = (data.alt ?? 0).toFixed(1) + ' m';
  document.getElementById('missionSpeed').textContent = (data.ground_speed ?? 0).toFixed(1) + ' m/s';
  var br = data.battery_remaining;
  document.getElementById('missionBatt').textContent = (br >= 0 ? br : '--') + '%';
  var md = window._lastMissionData;
  var count = md ? (md.count || (md.waypoints || []).length) : '--';
  document.getElementById('missionCurrentWp').textContent = '-- / ' + count;
  if (window.homeLatLng && data.lat && data.lon && md && md.waypoints && md.waypoints.length > 0) {
    var nextWp = md.waypoints[0];
    if (nextWp && nextWp.lat && nextWp.lng) {
      var d = haversine(data.lat, data.lon, nextWp.lat, nextWp.lng);
      document.getElementById('missionDistNext').textContent = (d >= 1000 ? (d/1000).toFixed(2) + ' km' : d.toFixed(0) + ' m');
    }
  }
}

function startMeasuring() {
  document.getElementById('mapContextMenu')?.classList.add('hidden');
  if (measure.active) { stopMeasuring(); return; }
  measure.active = true;
  measure.points = [];
  measure.totalDistance = 0;
  measure.polyline = L.polyline([], { color: '#f59e0b', weight: 2, dashArray: '6,4' }).addTo(window.map);
  measure.previewLine = L.polyline([], {
    color: '#fbbf24', weight: 1.5, dashArray: '3,5', opacity: 0.5,
  }).addTo(window.map);
  window.map.getContainer().style.cursor = 'crosshair';
  window.map.on('click', measureClick);
  document.getElementById('measureInfo')?.classList.remove('hidden');
  var item = document.querySelector('#mapContextMenu div:last-child');
  if (item) item.textContent = 'Stop Measuring';
  log('Measurement: click points on map. Right-click or Esc to finish.', 'info');
}

function stopMeasuring() {
  measure.active = false;
  measure.points = [];
  measure.totalDistance = 0;
  if (measure.polyline) { window.map.removeLayer(measure.polyline); measure.polyline = null; }
  if (measure.previewLine) { window.map.removeLayer(measure.previewLine); measure.previewLine = null; }
  measure.markers.forEach(function(m) { window.map.removeLayer(m); });
  measure.markers = [];
  measure.labels.forEach(function(l) { window.map.removeLayer(l); });
  measure.labels = [];
  window.map.off('click', measureClick);
  if (measure.mouseMoveHandler) {
    window.map.off('mousemove', measure.mouseMoveHandler);
    measure.mouseMoveHandler = null;
  }
  window.map.getContainer().style.cursor = '';
  var item = document.querySelector('#mapContextMenu div:last-child');
  if (item) item.textContent = 'Start Measuring';
  document.getElementById('measureInfo')?.classList.add('hidden');
  document.getElementById('measureBtn')?.classList.remove('active');
}

function measureClick(e) {
  var ll = e.latlng;
  measure.points.push(ll);
  var idx = measure.points.length - 1;

  var marker = L.circleMarker([ll.lat, ll.lng], {
    radius: 4, color: '#f59e0b', fillColor: '#fbbf24', fillOpacity: 1, weight: 2,
  }).addTo(window.map);
  measure.markers.push(marker);

  if (idx === 0) {
    marker.bindTooltip('Start', { permanent: true, direction: 'top' }).openTooltip();
    measure.mouseMoveHandler = function(me) {
      var d = ll.distanceTo(me.latlng);
      var brg = bearing(ll.lat, ll.lng, me.latlng.lat, me.latlng.lng);
      updateMeasureInfo(d, brg);
      if (measure.previewLine) measure.previewLine.setLatLngs([ll, me.latlng]);
    };
    window.map.on('mousemove', measure.mouseMoveHandler);
  } else {
    if (measure.mouseMoveHandler) {
      window.map.off('mousemove', measure.mouseMoveHandler);
      measure.mouseMoveHandler = null;
    }
    var prev = measure.points[idx - 1];
    var d = ll.distanceTo(prev);
    measure.totalDistance += d;
    var brg = bearing(prev.lat, prev.lng, ll.lat, ll.lng);
    updateMeasureInfo(d, brg);

    var segStr = formatDist(d, measure.unit);
    marker.bindTooltip(segStr, { permanent: true, direction: 'top' }).openTooltip();

    measure.labels.forEach(function(l) { window.map.removeLayer(l); });
    measure.labels = [];
    var totalLabel = L.tooltip({
      permanent: true, direction: 'bottom', className: 'measure-total',
      latlng: ll,
    }).setContent('Total: ' + formatDist(measure.totalDistance, measure.unit)).addTo(window.map);
    measure.labels.push(totalLabel);

    measure.mouseMoveHandler = function(me) {
      var dd = ll.distanceTo(me.latlng);
      var bbg = bearing(ll.lat, ll.lng, me.latlng.lat, me.latlng.lng);
      updateMeasureInfo(dd, bbg);
      if (measure.previewLine) measure.previewLine.setLatLngs([ll, me.latlng]);
    };
    window.map.on('mousemove', measure.mouseMoveHandler);
  }

  measure.polyline.setLatLngs(measure.points);
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && measure.active) stopMeasuring();
});

document.addEventListener('click', function(e) {
  var unitBtn = e.target.closest('.measure-unit');
  if (unitBtn) {
    document.querySelectorAll('.measure-unit').forEach(function(b) { b.classList.remove('active'); });
    unitBtn.classList.add('active');
    measure.unit = unitBtn.dataset.unit;
    if (measure.points.length >= 2) {
      var prev = measure.points[measure.points.length - 2];
      var last = measure.points[measure.points.length - 1];
      var d = last.distanceTo(prev);
      var brg = bearing(prev.lat, prev.lng, last.lat, last.lng);
      updateMeasureInfo(d, brg);
    } else if (measure.points.length === 0) {
      updateMeasureInfo(null, null);
    }
    measure.markers.forEach(function(m, i) {
      if (i > 0) {
        var prev = measure.points[i - 1];
        var d = measure.points[i].distanceTo(prev);
        m.unbindTooltip();
        m.bindTooltip(formatDist(d, measure.unit), { permanent: true, direction: 'top' }).openTooltip();
      }
    });
    measure.labels.forEach(function(l) { window.map.removeLayer(l); });
    measure.labels = [];
    if (measure.totalDistance > 0) {
      var lastPt = measure.points[measure.points.length - 1];
      var totalLabel = L.tooltip({
        permanent: true, direction: 'bottom', className: 'measure-total',
        latlng: lastPt,
      }).setContent('Total: ' + formatDist(measure.totalDistance, measure.unit)).addTo(window.map);
      measure.labels.push(totalLabel);
    }
  }
});

window.toggleMeasure = toggleMeasure;
window.startMeasuring = startMeasuring;

function updateActions(data) {
  setText('tt_type', data.vehicle_type ?? '---');
  setText('tt_firmware', data.firmware ? data.firmware.substring(0,12) : '---');
}

function updateStatusBar(data) {
  const s_conn = document.getElementById('s_connection');
  if (data.connected) {
    s_conn.textContent = '\u25cf Connected';
    s_conn.style.color = '#22c55e';
    document.getElementById('statusMessage').textContent = 'Connected';
  } else {
    s_conn.textContent = '\u25cf Disconnected';
    s_conn.style.color = '#ef4444';
    document.getElementById('statusMessage').textContent = 'Disconnected';
  }

  const s_gps = document.getElementById('s_gps');
  if (data.fix_type >= 3) {
    s_gps.textContent = '\u25cf GPS: 3D Fix';
    s_gps.style.color = '#22c55e';
  } else if (data.fix_type === 2) {
    s_gps.textContent = '\u25cf GPS: 2D Fix';
    s_gps.style.color = '#eab308';
  } else {
    s_gps.textContent = '\u25cf GPS: No Fix';
    s_gps.style.color = '#ef4444';
  }

  document.getElementById('s_sats').textContent = `\u25cf Sats: ${data.satellites ?? 0}`;
  const s_mode = document.getElementById('s_mode');
  s_mode.textContent = `\u25cf Mode: ${data.mode ?? '---'}`;
  s_mode.style.color = '#0ea5e9';

  const s_armed = document.getElementById('s_armed');
  if (data.armed) {
    s_armed.textContent = '\u25cf Armed';
    s_armed.style.color = '#ef4444';
  } else {
    s_armed.textContent = '\u25cf Disarmed';
    s_armed.style.color = '#94a3b8';
  }

  const hb = document.getElementById('heartbeatInd');
  if (data.connected) {
    hb.textContent = '\u25cf Heartbeat: OK';
    hb.style.color = '#22c55e';
  } else {
    hb.textContent = '\u25cf Heartbeat: --';
    hb.style.color = '#64748b';
  }

  document.getElementById('sysidInd').textContent =
    data.connected ? `SysID: ${data.sysid ?? '?'} | CompID: ${data.compid ?? '?'}` : 'SysID: --';
}

function updateSensorHealth(data) {
  var health = data.sensor_health || 0;
  var sensors = {
    gyro: 1, accel: 2, mag: 4, baro: 8,
    gps: 32, rc: 65536, ahrs: 2097152, battery: 33554432,
  };
  for (var name in sensors) {
    var dotId = name === 'gps' ? 's_gps_sens' : name === 'battery' ? 's_batt_sens' : 's_' + name;
    var dot = document.getElementById(dotId);
    if (!dot) continue;
    if (name === 'battery') {
      var rem = data.battery_remaining;
      dot.className = rem === undefined || rem === null ? 'sensor-dot na' : rem > 20 ? 'sensor-dot healthy' : rem > 10 ? 'sensor-dot warn' : 'sensor-dot unhealthy';
    } else {
      dot.className = (health & sensors[name]) ? 'sensor-dot healthy' : 'sensor-dot na';
    }
  }
  var fixType = data.fix_type || 0;
  var gps = document.getElementById('s_gps_sens');
  if (gps) gps.className = fixType >= 3 ? 'sensor-dot healthy' : fixType >= 2 ? 'sensor-dot warn' : 'sensor-dot unhealthy';

  var ekf = [
    { id: 'ekf_hpos', key: 'ekf_pos_horiz_variance' },
    { id: 'ekf_vpos', key: 'ekf_pos_vert_variance' },
    { id: 'ekf_vel', key: 'ekf_vel_variance' },
    { id: 'ekf_mag', key: 'ekf_compass_variance' },
  ];
  for (var i = 0; i < ekf.length; i++) {
    var el = document.getElementById(ekf[i].id);
    if (!el) continue;
    var val = data[ekf[i].key];
    if (val === undefined || val === null) { el.textContent = '---'; el.className = 'ekf-val'; }
    else { el.textContent = val.toFixed(3); el.className = 'ekf-val' + (val < 1.0 ? ' good' : val < 3.0 ? ' warn' : ' bad'); }
  }
  var fl = document.getElementById('ekf_flags');
  if (fl) {
    var f = data.ekf_flags;
    if (f === undefined || f === null) { fl.textContent = '---'; }
    else {
      var a = [];
      if (f & 1) a.push('ATT'); if (f & 2) a.push('HVEL'); if (f & 4) a.push('VVEL');
      if (f & 8) a.push('HPOS'); if (f & 16) a.push('APOS'); if (f & 32) a.push('VPOS');
      if (f & 64) a.push('AGL'); if (f & 128) a.push('CONST'); if (f & 1024) a.push('UNINIT');
      fl.textContent = a.length ? a.join(' ') : 'NONE';
    }
  }
  var cpu = document.getElementById('tt_cpu_load');
  if (cpu) {
    var ld = data.cpu_load;
    cpu.textContent = 'CPU: ' + (ld !== undefined ? ld.toFixed(1) + '%' : '---');
  }
}

var _fsHomeSet = false, _fsHomeLat = 0, _fsHomeLon = 0;
var _fsMaxAlt = 0, _fsMaxGS = 0, _fsMaxDist = 0;
var _fsArmed = false, _fsTimerStart = null;

function updateFlightStats(data) {
  if (!data.connected) {
    _fsHomeSet = false; _fsMaxAlt = 0; _fsMaxGS = 0; _fsMaxDist = 0; _fsArmed = false; _fsTimerStart = null;
    window.clearInterval(_fsTimerInterval);
    setText('fs_max_alt', '---'); setText('fs_max_gs', '---');
    setText('fs_max_dist', '---'); setText('fs_flight_time', '00:00');
    return;
  }
  if (!_fsHomeSet && data.lat && data.lon) {
    _fsHomeLat = data.lat; _fsHomeLon = data.lon; _fsHomeSet = true;
  }
  if (data.alt !== undefined && data.alt > _fsMaxAlt) _fsMaxAlt = data.alt;
  if (data.ground_speed !== undefined && data.ground_speed > _fsMaxGS) _fsMaxGS = data.ground_speed;
  if (_fsHomeSet && data.lat && data.lon) {
    var d = haversine(_fsHomeLat, _fsHomeLon, data.lat, data.lon);
    if (d > _fsMaxDist) _fsMaxDist = d;
  }
  if (data.armed && !_fsArmed) {
    _fsArmed = true;
    _fsTimerStart = Date.now();
    _fsTimerInterval = window.setInterval(updateFlightTimer, 1000);
  } else if (!data.armed && _fsArmed) {
    _fsArmed = false;
    _fsTimerStart = null;
    window.clearInterval(_fsTimerInterval);
  }
  setText('fs_max_alt', _fsMaxAlt.toFixed(1) + 'm');
  setText('fs_max_gs', _fsMaxGS.toFixed(1) + 'm/s');
  setText('fs_max_dist', _fsMaxDist.toFixed(0) + 'm');
}

function updateFlightTimer() {
  if (!_fsTimerStart) return;
  var sec = Math.floor((Date.now() - _fsTimerStart) / 1000);
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  var el = document.getElementById('fs_flight_time');
  if (el) el.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

var _nPrevMode = '', _nPrevArmed = false, _nPrevBatt = 100, _nPrevConnected = false;
var _nLowBatt20 = false, _nLowBatt10 = false;

function notify(msg, level) {
  level = level || 'info';
  var container = document.getElementById('notifContainer');
  if (!container) return;
  var el = document.createElement('div');
  el.className = 'notif';
  el.innerHTML = '<span class="notif-dot ' + level + '"></span><span class="notif-msg">' + msg + '</span>';
  el.onclick = function() { el.remove(); };
  container.appendChild(el);
  setTimeout(function() { if (el.parentNode) { el.style.transition = 'opacity 0.3s'; el.style.opacity = '0'; setTimeout(function() { el.remove(); }, 300); } }, 5000);
}

function checkNotifications(data) {
  if (!data.connected) {
    _nPrevMode = ''; _nPrevArmed = false; _nPrevBatt = 100; _nLowBatt20 = false; _nLowBatt10 = false;
    if (_nPrevConnected) { notify('Disconnected from vehicle', 'warning'); }
    _nPrevConnected = false;
    return;
  }
  if (!_nPrevConnected && data.connected) {
    notify('Connected to vehicle', 'success');
  }
  _nPrevConnected = true;

  if (data.mode && data.mode !== _nPrevMode) {
    notify('Mode: ' + data.mode, 'info');
    _nPrevMode = data.mode;
  }
  if (data.armed !== undefined && data.armed !== _nPrevArmed) {
    notify(data.armed ? 'Vehicle ARMED' : 'Vehicle DISARMED', data.armed ? 'warning' : 'info');
    _nPrevArmed = data.armed;
  }
  var batt = data.battery_remaining;
  if (batt !== undefined && batt !== null && batt >= 0) {
    if (batt < 10 && !_nLowBatt10) {
      notify('CRITICAL: Battery ' + batt + '%', 'danger');
      _nLowBatt10 = true;
      _nLowBatt20 = true;
    } else if (batt < 20 && !_nLowBatt20) {
      notify('Low battery: ' + batt + '%', 'warning');
      _nLowBatt20 = true;
    }
    if (batt >= 25) { _nLowBatt20 = false; _nLowBatt10 = false; }
    _nPrevBatt = batt;
  }
}

function toggleActionPanel() {
  var panel = document.getElementById('actionPanel');
  var btn = document.getElementById('collapseActionBtn');
  if (!panel || !btn) return;
  panel.classList.toggle('collapsed');
  if (panel.classList.contains('collapsed')) {
    btn.textContent = '\u25C0';
    btn.title = 'Expand panel';
  } else {
    btn.textContent = '\u25B6';
    btn.title = 'Collapse panel';
  }
}

function switchActionTab(tab) {
  // no-op — health/stats moved to sidebar tabs
}

/* HUD - Attitude Indicator + Compass */
var _hudClimb = 0, _hudLastAlt = null, _hudLastTime = null;

var _hudConnStart = null;

function updateHud(data) {
  var now = Date.now();

  // Connection status (top-left)
  var connEl = document.getElementById('hudConn');
  if (connEl) {
    if (data.connected) {
      connEl.innerHTML = '<span class="hud-dot on"></span> Connected';
      if (_hudConnStart === null) _hudConnStart = now;
    } else {
      connEl.innerHTML = '<span class="hud-dot off"></span> Unconnected';
      _hudConnStart = null;
    }
  }

  // GPS lock status (top-right)
  var gpsEl = document.getElementById('hudGps');
  if (gpsEl) {
    var fix = data.fix_type ?? 0;
    if (fix === 0) {
      gpsEl.innerHTML = '<span class="hud-dot off"></span> No GPS';
    } else if (fix === 1) {
      gpsEl.innerHTML = '<span class="hud-dot warn"></span> No Fix';
    } else if (fix === 2) {
      gpsEl.innerHTML = '<span class="hud-dot warn"></span> 2D Fix';
    } else {
      gpsEl.innerHTML = '<span class="hud-dot on"></span> Locked';
    }
  }

  // Upper left: pitch, yaw, roll
  setText('hudPitch', (data.pitch ?? 0).toFixed(1));
  setText('hudYaw', (data.yaw ?? data.heading ?? 0).toFixed(1));
  setText('hudRoll', (data.roll ?? 0).toFixed(1));

  // Middle right: climb, flight time, airspeed, altitude
  setText('hudAirspeed', (data.air_speed ?? 0).toFixed(1));
  setText('hudAltitude', (data.alt ?? 0).toFixed(1));

  var alt = data.alt ?? 0;
  if (_hudLastAlt !== null && _hudLastTime !== null) {
    var dt = (now - _hudLastTime) / 1000;
    if (dt > 0.01 && dt < 5) _hudClimb = (alt - _hudLastAlt) / dt;
  }
  _hudLastAlt = alt;
  _hudLastTime = now;
  setText('hudClimb', _hudClimb.toFixed(1));

  // Flight time
  var ftEl = document.getElementById('hudFlightTime');
  if (ftEl) {
    if (_hudConnStart !== null) {
      var elapsed = Math.floor((now - _hudConnStart) / 1000);
      var m = Math.floor(elapsed / 60);
      var s = elapsed % 60;
      ftEl.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    } else {
      ftEl.textContent = '00:00';
    }
  }

  // Bottom left: ground speed, height above sea level
  setText('hudGround', (data.ground_speed ?? 0).toFixed(1));
  setText('hudAsl', (data.msl_alt ?? 0).toFixed(1));

  // Bottom right: wind (N/A), distance
  setText('hudWind', 'N/A');
  if (window.homeLatLng && data.lat && data.lon) {
    var hl = window.homeLatLng;
    var d = haversine(hl[0], hl[1], data.lat, data.lon);
    if (d >= 1000) {
      setText('hudDist', (d / 1000).toFixed(2));
    } else {
      setText('hudDist', d.toFixed(0));
    }
  }

  // Right panel target distances updated in state_update

  // Draw attitude canvas
  drawAttitudeCanvas(data.roll ?? 0, data.pitch ?? 0, data.heading ?? 0);
}

function drawAttitudeCanvas(roll, pitch, heading) {
  var canvas = document.getElementById('hudCanvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var w = canvas.width, h = canvas.height;
  var cx = w / 2, cy = h / 2;
  var outerR = Math.min(w, h) / 2 - 2;
  var innerR = outerR * 0.6;

  ctx.clearRect(0, 0, w, h);

  // === COMPASS RING ===
  // Outer ring background
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.fillStyle = '#1e293b';
  ctx.fill();
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Compass ticks (rotated by heading)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-heading * Math.PI / 180);

  for (var deg = 0; deg < 360; deg += 5) {
    var isMajor = deg % 30 === 0;
    var isMid = deg % 15 === 0;
    var rad = (deg - 90) * Math.PI / 180;
    var inner = isMajor ? outerR - 14 : isMid ? outerR - 9 : outerR - 5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(rad) * inner, Math.sin(rad) * inner);
    ctx.lineTo(Math.cos(rad) * (outerR - 3), Math.sin(rad) * (outerR - 3));
    ctx.strokeStyle = isMajor ? '#e2e8f0' : '#475569';
    ctx.lineWidth = isMajor ? 2 : 1;
    ctx.stroke();

    if (isMajor) {
      var labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      var idx = Math.round(deg / 45) % 8;
      var lr = outerR - 24;
      ctx.fillStyle = deg === 0 ? '#ef4444' : '#94a3b8';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labels[idx], Math.cos(rad) * lr, Math.sin(rad) * lr);
    }
  }

  // N pointer triangle
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.moveTo(0, -outerR + 2);
  ctx.lineTo(-5, -outerR + 10);
  ctx.lineTo(5, -outerR + 10);
  ctx.closePath();
  ctx.fill();

  ctx.restore(); // heading rotation

  // === ATTITUDE INDICATOR ===
  // Clip to inner circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.clip();

  // Rotate for roll
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(roll * Math.PI / 180);

  var pitchPx = pitch * 2.8;

  // Sky
  var skyGrad = ctx.createLinearGradient(0, -innerR, 0, 0);
  skyGrad.addColorStop(0, '#0284c7');
  skyGrad.addColorStop(0.5, '#38bdf8');
  skyGrad.addColorStop(1, '#7dd3fc');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(-innerR, -innerR + pitchPx, innerR * 2, innerR);

  // Earth
  var earthGrad = ctx.createLinearGradient(0, 0, 0, innerR);
  earthGrad.addColorStop(0, '#92400e');
  earthGrad.addColorStop(0.5, '#78350f');
  earthGrad.addColorStop(1, '#451a03');
  ctx.fillStyle = earthGrad;
  ctx.fillRect(-innerR, pitchPx, innerR * 2, innerR);

  // Horizon line
  ctx.beginPath();
  ctx.moveTo(-innerR, pitchPx);
  ctx.lineTo(innerR, pitchPx);
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Pitch ladder
  for (var p = -20; p <= 20; p += 5) {
    if (p === 0) continue;
    var y = pitchPx + p * 2.8;
    if (Math.abs(y) > innerR - 4) continue;
    var is10 = p % 10 === 0;
    var halfW = is10 ? innerR * 0.35 : innerR * 0.18;
    ctx.beginPath();
    ctx.moveTo(-halfW, y);
    ctx.lineTo(halfW, y);
    ctx.strokeStyle = is10 ? '#f1f5f9' : '#94a3b8';
    ctx.lineWidth = is10 ? 2 : 1;
    ctx.stroke();

    if (is10) {
      ctx.fillStyle = '#f1f5f9';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.abs(p)), -halfW - 5, y);
      ctx.textAlign = 'left';
      ctx.fillText(String(Math.abs(p)), halfW + 5, y);
    }
  }

  ctx.restore(); // roll rotation
  ctx.restore(); // clip

  // Inner ring border
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Center drone chevron (no tail)
  var ds = 14;
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.moveTo(cx, cy - ds);
  ctx.lineTo(cx - ds * 0.7, cy + ds * 0.4);
  ctx.lineTo(cx - ds * 0.25, cy + ds * 0.1);
  ctx.lineTo(cx, cy + ds * 0.25);
  ctx.lineTo(cx + ds * 0.25, cy + ds * 0.1);
  ctx.lineTo(cx + ds * 0.7, cy + ds * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Roll indicator triangle at top
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(roll * Math.PI / 180);
  ctx.beginPath();
  ctx.moveTo(0, -innerR + 7);
  ctx.lineTo(-5, -innerR - 1);
  ctx.lineTo(5, -innerR - 1);
  ctx.closePath();
  ctx.fillStyle = '#f8fafc';
  ctx.fill();
  ctx.restore();

  // Roll arc marks
  var rollMarks = [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60];
  for (var i = 0; i < rollMarks.length; i++) {
    var rad = (rollMarks[i] - 90) * Math.PI / 180;
    var isBig = Math.abs(rollMarks[i]) % 30 === 0;
    var r1 = innerR - 7;
    var r2 = innerR - 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * r1, cy + Math.sin(rad) * r1);
    ctx.lineTo(cx + Math.cos(rad) * r2, cy + Math.sin(rad) * r2);
    ctx.strokeStyle = isBig ? '#94a3b8' : '#475569';
    ctx.lineWidth = isBig ? 2 : 1;
    ctx.stroke();
  }
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function haversine(lat1, lon1, lat2, lon2) {
  var R = 6371000;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearing(lat1, lon1, lat2, lon2) {
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  var x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
          Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

var DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function dirName(deg) {
  return DIRS[Math.round(deg / 22.5) % 16];
}

/* Charts */
var chartState = {
  alt: { labels: [], data: [], el: null, chart: null, color: '#22c55e' },
  speed: { labels: [], data: [], el: null, chart: null, color: '#0ea5e9' },
  volt: { labels: [], data: [], el: null, chart: null, color: '#eab308' },
  current: { labels: [], data: [], el: null, chart: null, color: '#f97316' },
  maxPoints: 60,
  updateCounter: 0,
  sampleRate: 10,
};

function initCharts() {
  var mapping = { chartAlt: 'alt', chartSpeed: 'speed', chartVolt: 'volt', chartCurrent: 'current' };
  for (var elId in mapping) {
    var key = mapping[elId];
    var s = chartState[key];
    s.el = document.getElementById(elId);
    if (!s.el) continue;
    var ctx = s.el.getContext('2d');
    var bgMap = { '#22c55e': 'rgba(34,197,94,0.1)', '#0ea5e9': 'rgba(14,165,233,0.1)', '#eab308': 'rgba(234,179,8,0.1)', '#f97316': 'rgba(249,115,22,0.1)' };
    s.chart = new Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets: [{
        data: [], borderColor: s.color,
        backgroundColor: bgMap[s.color] || 'rgba(255,255,255,0.1)',
        fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2,
      }]},
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: false, plugins: { legend: { display: false } },
        scales: {
          x: { display: true, grid: { color: '#1e293b' }, ticks: { color: '#64748b', font: { size: 8 }, maxTicksLimit: 8 } },
          y: { display: true, grid: { color: '#1e293b' }, ticks: { color: '#64748b', font: { size: 8 } } },
        },
      },
    });
  }
}

function pushChartData(key, label, value) {
  var s = chartState[key];
  if (!s || !s.chart) return;
  s.labels.push(label);
  s.data.push(value);
  if (s.labels.length > chartState.maxPoints) {
    s.labels.shift();
    s.data.shift();
  }
  s.chart.data.labels = s.labels.slice();
  s.chart.data.datasets[0].data = s.data.slice();
  s.chart.update('none');
}

function feedCharts(data) {
  chartState.updateCounter++;
  if (chartState.updateCounter % chartState.sampleRate !== 0) return;
  if (!data.connected) return;
  var t = new Date();
  var label = String(t.getHours()).padStart(2,'0') + ':' + String(t.getMinutes()).padStart(2,'0') + ':' + String(t.getSeconds()).padStart(2,'0');
  pushChartData('alt', label, data.alt ?? 0);
  pushChartData('speed', label, data.ground_speed ?? 0);
  pushChartData('volt', label, data.battery_voltage ?? 0);
  pushChartData('current', label, data.battery_current ?? 0);
}

function switchSidebarTab(tab) {
  var cardId = tab === 'charts' ? 'sideCardCharts' : tab === 'inspector' ? 'sideCardInspector' : tab === 'health' ? 'sideCardHealth' : tab === 'stats' ? 'sideCardStats' : tab === 'targets' ? 'sideCardTargets' : tab === 'camera' ? 'sideCardCamera' : 'sideCardTelemetry';
  var card = document.getElementById(cardId);
  if (!card) return;
  var isOpen = !card.classList.contains('hidden');
  var btns = document.querySelectorAll('.sidebar-btn');
  btns.forEach(function(b) { b.classList.remove('active'); });
  if (isOpen) {
    card.classList.add('hidden');
    if (tab === 'inspector') {
      inspectorState.active = false;
      socket.emit('stop_inspector');
    }
    return;
  }
  var cards = ['sideCardTelemetry', 'sideCardCharts', 'sideCardInspector', 'sideCardHealth', 'sideCardStats', 'sideCardTargets', 'sideCardCamera'];
  cards.forEach(function(id) { var el = document.getElementById(id); if (el) el.classList.add('hidden'); });
  var activeBtn = document.querySelector('.sidebar-btn[data-tab="' + tab + '"]');
  if (activeBtn) activeBtn.classList.add('active');
  if (tab === 'charts') {
    document.getElementById('sideCardCharts').classList.remove('hidden');
    if (inspectorState.active) {
      inspectorState.active = false;
      socket.emit('stop_inspector');
    }
    for (var key in chartState) {
      if (chartState[key] && chartState[key].chart) {
        try { chartState[key].chart.resize(); } catch(e) {}
      }
    }
  } else if (tab === 'inspector') {
    document.getElementById('sideCardInspector').classList.remove('hidden');
    inspectorState.active = true;
    socket.emit('start_inspector');
  } else if (tab === 'health') {
    document.getElementById('sideCardHealth').classList.remove('hidden');
    if (inspectorState.active) {
      inspectorState.active = false;
      socket.emit('stop_inspector');
    }
  } else if (tab === 'stats') {
    document.getElementById('sideCardStats').classList.remove('hidden');
    if (inspectorState.active) {
      inspectorState.active = false;
      socket.emit('stop_inspector');
    }
  } else if (tab === 'targets') {
    document.getElementById('sideCardTargets').classList.remove('hidden');
    if (inspectorState.active) {
      inspectorState.active = false;
      socket.emit('stop_inspector');
    }
  } else if (tab === 'camera') {
    document.getElementById('sideCardCamera').classList.remove('hidden');
    if (inspectorState.active) {
      inspectorState.active = false;
      socket.emit('stop_inspector');
    }
  } else {
    if (inspectorState.active) {
      inspectorState.active = false;
      socket.emit('stop_inspector');
    }
    document.getElementById('sideCardTelemetry').classList.remove('hidden');
  }
}

/* MAVLink Inspector */
var inspectorState = { paused: false, messages: [], count: 0, active: false };

socket.on('mavlink_raw', (data) => {
  if (!inspectorState.active) return;
  if (inspectorState.paused) return;
  inspectorState.count++;
  inspectorState.messages.push(data);
  if (inspectorState.messages.length > 500) {
    inspectorState.messages.splice(0, inspectorState.messages.length - 500);
  }
  renderInspector();
});

function toggleInspectorPause() {
  inspectorState.paused = !inspectorState.paused;
  var btn = document.getElementById('inspectorPauseBtn');
  if (btn) btn.textContent = inspectorState.paused ? 'RESUME' : 'PAUSE';
  if (btn) btn.classList.toggle('paused', inspectorState.paused);
}

function inspectorClear() {
  inspectorState.messages = [];
  inspectorState.count = 0;
  renderInspector();
}

function inspectorFilter() {
  renderInspector();
}

function renderInspector() {
  var list = document.getElementById('inspectorList');
  var countEl = document.getElementById('inspectorCount');
  if (!list) return;
  var filter = (document.getElementById('inspectorFilter')?.value || '').toLowerCase().trim();
  var filtered = inspectorState.messages;
  if (filter) {
    filtered = filtered.filter(function(m) { return m.type.toLowerCase().includes(filter); });
  }
  countEl.textContent = inspectorState.count + ' messages' + (filter ? ' (' + filtered.length + ' shown)' : '');
  var html = '';
  for (var i = filtered.length - 1; i >= 0; i--) {
    var m = filtered[i];
    var fieldKeys = Object.keys(m.fields || {});
    var summary = fieldKeys.slice(0, 3).map(function(k) { return k + '=' + m.fields[k]; }).join(' ');
    if (fieldKeys.length > 3) summary += ' ...';
    html += '<div class="msg-row" onclick="toggleMsgFields(this)">';
    html += '<span class="msg-time">' + m.time + '</span>';
    html += '<span class="msg-type">' + m.type + '</span>';
    html += '<span class="msg-summary">' + escapeHtml(summary) + '</span>';
    html += '<div class="msg-fields">';
    for (var j = 0; j < fieldKeys.length; j++) {
      var k = fieldKeys[j];
      html += '<div class="msg-field"><span class="msg-field-name">' + escapeHtml(k) + '</span> = <span class="msg-field-value">' + escapeHtml(String(m.fields[k])) + '</span></div>';
    }
    html += '</div></div>';
  }
  list.innerHTML = html;
}

function toggleMsgFields(row) {
  var fields = row.querySelector('.msg-fields');
  if (fields) fields.classList.toggle('open');
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ---- Bearing/Distance Waypoint Tool ---- */
function toggleBrgPanel() {
  var panel = document.getElementById('brgPanel');
  var btn = document.getElementById('brgBtn');
  if (!panel) return;
  var show = panel.classList.toggle('hidden');
  if (btn) btn.classList.toggle('active', show);
}

function destFromBearing(lat, lon, brgDeg, distMeters) {
  var R = 6371000;
  var brg = brgDeg * Math.PI / 180;
  var lat1 = lat * Math.PI / 180;
  var lon1 = lon * Math.PI / 180;
  var lat2 = Math.asin(Math.sin(lat1) * Math.cos(distMeters / R) +
                       Math.cos(lat1) * Math.sin(distMeters / R) * Math.cos(brg));
  var lon2 = lon1 + Math.atan2(Math.sin(brg) * Math.sin(distMeters / R) * Math.cos(lat1),
                               Math.cos(distMeters / R) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 * 180 / Math.PI, lng: lon2 * 180 / Math.PI };
}

function addBrgWaypoint() {
  var angle = parseFloat(document.getElementById('brgAngle').value);
  var dist = parseFloat(document.getElementById('brgDist').value);
  if (isNaN(angle) || isNaN(dist) || dist <= 0) {
    log('Invalid bearing or distance', 'warning');
    return;
  }
  var ref = document.querySelector('input[name="brgRef"]:checked');
  var refVal = ref ? ref.value : 'aircraft';
  var srcLat, srcLon;
  if (refVal === 'aircraft') {
    var v = window.vehicle;
    if (!v || !v.lat || !v.lon) { log('No vehicle position available', 'warning'); return; }
    srcLat = v.lat;
    srcLon = v.lon;
  } else {
    var md = window._lastMissionData;
    if (!md || !md.waypoints || md.waypoints.length === 0) {
      log('No mission waypoints available', 'warning');
      return;
    }
    var firstWp = md.waypoints[0];
    srcLat = firstWp.x;
    srcLon = firstWp.y;
  }
  var dest = destFromBearing(srcLat, srcLon, angle, dist);
  var wp = {
    command: 16, param1: 0, param2: 0, param3: 0, param4: 0,
    x: dest.lat, y: dest.lng, z: 50,
  };
  var existing = window._lastMissionData ? (window._lastMissionData.waypoints || []) : [];
  var newList = existing.concat([wp]);
  socket.emit('mission_upload', { waypoints: newList });
  log('Added waypoint at ' + dest.lat.toFixed(6) + ', ' + dest.lng.toFixed(6) +
      ' (brg=' + angle + '\u00B0, dist=' + dist + 'm from ' + refVal + ')', 'success');
}

/* ---- DMS Conversion Tool ---- */
function toggleDmsPanel() {
  var panel = document.getElementById('dmsPanel');
  var btn = document.getElementById('dmsBtn');
  if (!panel) return;
  var show = panel.classList.toggle('hidden');
  if (btn) btn.classList.toggle('active', show);
}

function ddToDms(dd) {
  var sign = dd < 0 ? -1 : 1;
  var abs = Math.abs(dd);
  var deg = Math.floor(abs);
  var minFull = (abs - deg) * 60;
  var min = Math.floor(minFull);
  var sec = (minFull - min) * 60;
  return { deg: sign * deg, min: min, sec: sec };
}

function dmsToDd(deg, min, sec) {
  var abs = Math.abs(deg) + min / 60 + sec / 3600;
  return deg < 0 ? -abs : abs;
}

function convertToDms() {
  var lat = parseFloat(document.getElementById('dmsDdLat').value);
  var lon = parseFloat(document.getElementById('dmsDdLon').value);
  if (isNaN(lat) || isNaN(lon)) { log('Invalid DD value', 'warning'); return; }
  var latDms = ddToDms(lat);
  var lonDms = ddToDms(lon);
  var r = 'Lat: ' + latDms.deg + '\u00B0 ' + latDms.min + "' " + latDms.sec.toFixed(3) + '"' +
          ' | Lon: ' + lonDms.deg + '\u00B0 ' + lonDms.min + "' " + lonDms.sec.toFixed(3) + '"';
  document.getElementById('dmsResultDms').textContent = r;
}

function convertToDd() {
  var ld = parseFloat(document.getElementById('dmsDmsLatDeg').value);
  var lm = parseFloat(document.getElementById('dmsDmsLatMin').value);
  var ls = parseFloat(document.getElementById('dmsDmsLatSec').value);
  var lod = parseFloat(document.getElementById('dmsDmsLonDeg').value);
  var lom = parseFloat(document.getElementById('dmsDmsLonMin').value);
  var los = parseFloat(document.getElementById('dmsDmsLonSec').value);
  if ([ld, lm, ls, lod, lom, los].some(isNaN)) { log('Invalid DMS value', 'warning'); return; }
  var lat = dmsToDd(ld, lm, ls);
  var lon = dmsToDd(lod, lom, los);
  var r = 'Lat: ' + lat.toFixed(7) + '\u00B0 | Lon: ' + lon.toFixed(7) + '\u00B0';
  document.getElementById('dmsResultDd').textContent = r;
}

/* ---- Geofence Tool ---- */
window._fenceState = { polygons: [], circles: [] };

function toggleFencePanel() {
  var panel = document.getElementById('fencePanel');
  var btn = document.getElementById('fenceBtn');
  if (!panel) return;
  var show = panel.classList.toggle('hidden');
  if (btn) btn.classList.toggle('active', show);
}

function renderFenceTable() {
  var fs = window._fenceState;
  // Polygon table
  var pt = document.getElementById('fencePolyTable');
  if (pt) {
    var h = '<div class="fence-tbl-row"><span class="fence-tbl-hdr fence-tbl-include">Include</span><span class="fence-tbl-hdr fence-tbl-edit">Edit</span><span class="fence-tbl-hdr fence-tbl-action">Del</span></div>';
    for (var i = 0; i < fs.polygons.length; i++) {
      var p = fs.polygons[i];
      h += '<div class="fence-tbl-row">' +
        '<span class="fence-tbl-include"><input type="checkbox" ' + (p.include ? 'checked' : '') + ' onchange="toggleFenceInclude(\'poly\',' + i + ')"></span>' +
        '<span class="fence-tbl-edit"><input type="checkbox" ' + (p.edit ? 'checked' : '') + ' onchange="toggleFenceEdit(\'poly\',' + i + ')"></span>' +
        '<span class="fence-tbl-action"><button class="fence-tbl-del" onclick="deleteFenceItem(\'poly\',' + i + ')">\u2715</button></span>' +
        '</div>';
    }
    if (fs.polygons.length === 0) h += '<div style="color:#475569;font-size:8px;text-align:center;padding:2px 0">No polygon fences</div>';
    pt.innerHTML = h;
  }
  // Circle table
  var ct = document.getElementById('fenceCircleTable');
  if (ct) {
    var hc = '<div class="fence-tbl-row"><span class="fence-tbl-hdr fence-tbl-include">Include</span><span class="fence-tbl-hdr fence-tbl-edit">Edit</span><span class="fence-tbl-hdr fence-tbl-radius">Radius (m)</span><span class="fence-tbl-hdr fence-tbl-action">Del</span></div>';
    for (var j = 0; j < fs.circles.length; j++) {
      var c = fs.circles[j];
      hc += '<div class="fence-tbl-row">' +
        '<span class="fence-tbl-include"><input type="checkbox" ' + (c.include ? 'checked' : '') + ' onchange="toggleFenceInclude(\'circ\',' + j + ')"></span>' +
        '<span class="fence-tbl-edit"><input type="checkbox" ' + (c.edit ? 'checked' : '') + ' onchange="toggleFenceEdit(\'circ\',' + j + ')"></span>' +
        '<span class="fence-tbl-radius"><input type="number" value="' + c.radius + '" min="0" step="1" onchange="updateFenceRadius(' + j + ',this.value)"></span>' +
        '<span class="fence-tbl-action"><button class="fence-tbl-del" onclick="deleteFenceItem(\'circ\',' + j + ')">\u2715</button></span>' +
        '</div>';
    }
    if (fs.circles.length === 0) hc += '<div style="color:#475569;font-size:8px;text-align:center;padding:2px 0">No circle fences</div>';
    ct.innerHTML = hc;
  }
}

function toggleFenceInclude(type, idx) {
  var fs = window._fenceState;
  var arr = type === 'poly' ? fs.polygons : fs.circles;
  if (arr[idx]) arr[idx].include = !arr[idx].include;
}

function toggleFenceEdit(type, idx) {
  var fs = window._fenceState;
  var arr = type === 'poly' ? fs.polygons : fs.circles;
  if (arr[idx]) arr[idx].edit = !arr[idx].edit;
}

function updateFenceRadius(idx, val) {
  var fs = window._fenceState;
  var r = parseFloat(val);
  if (!isNaN(r) && r >= 0 && fs.circles[idx]) fs.circles[idx].radius = r;
}

function deleteFenceItem(type, idx) {
  var fs = window._fenceState;
  if (type === 'poly') fs.polygons.splice(idx, 1);
  else fs.circles.splice(idx, 1);
  renderFenceTable();
  updateFenceDraw();
}

function addFencePolygon() {
  window._fenceState.polygons.push({ include: true, edit: false });
  renderFenceTable();
  var st = document.getElementById('fenceStatus');
  if (st) st.textContent = 'Added new polygon. Click the map to place vertices.';
}

function addFenceCircle() {
  window._fenceState.circles.push({ include: true, edit: false, radius: 100 });
  renderFenceTable();
  var st = document.getElementById('fenceStatus');
  if (st) st.textContent = 'Added new circle. Click the map to set center.';
}

function updateFenceDraw() {
  if (window.fenceGroup) window.map.removeLayer(window.fenceGroup);
  window.fenceGroup = L.featureGroup().addTo(window.map);
  var fs = window._fenceState;
  // Draw polygons with dummy points if none
  for (var i = 0; i < fs.polygons.length; i++) {
    var color = fs.polygons[i].include ? '#f59e0b' : '#ef4444';
    L.polygon([[37.7749, -122.4194], [37.7759, -122.4184], [37.7769, -122.4204]], { color: color, weight: 2, fillOpacity: 0.1 }).addTo(window.fenceGroup);
  }
  // Draw circles
  for (var j = 0; j < fs.circles.length; j++) {
    var cc = fs.circles[j];
    var col = cc.include ? '#f59e0b' : '#ef4444';
    L.circle([37.7749, -122.4194], { radius: cc.radius, color: col, weight: 2, fillOpacity: 0.1 }).addTo(window.fenceGroup);
  }
}

function uploadFence() {
  var fs = window._fenceState;
  var pts = [];
  // For polygon fences, use dummy vertices around current vehicle position
  var v = window.vehicle;
  var baseLat = v && v.lat ? v.lat : 37.7749;
  var baseLon = v && v.lon ? v.lon : -122.4194;
  var offset = 0.0005;
  var polyCount = 0;
  for (var i = 0; i < fs.polygons.length; i++) {
    if (fs.polygons[i].include) {
      pts.push({ lat: baseLat + offset * polyCount, lon: baseLon + offset * polyCount });
      pts.push({ lat: baseLat + offset * polyCount + offset, lon: baseLon - offset * polyCount });
      pts.push({ lat: baseLat - offset * polyCount, lon: baseLon - offset * polyCount });
      polyCount++;
    }
  }
  // For circles, convert to fence points (approximate with 8 points)
  for (var j = 0; j < fs.circles.length; j++) {
    if (fs.circles[j].include) {
      // Circle fences are handled by FENCE_RADIUS param, but for simplicity we add polygon approx
      var cx = baseLat, cy = baseLon;
      var r = fs.circles[j].radius;
      var R_earth = 6371000;
      var dLat = (r / R_earth) * (180 / Math.PI);
      var dLon = dLat / Math.cos(cx * Math.PI / 180);
      for (var k = 0; k < 8; k++) {
        var a = (k / 8) * 2 * Math.PI;
        pts.push({ lat: cx + dLat * Math.sin(a), lon: cy + dLon * Math.cos(a) });
      }
    }
  }
  if (pts.length === 0) { log('No fence points to upload', 'warning'); return; }
  socket.emit('fence_upload', { points: pts });
  var st = document.getElementById('fenceStatus');
  if (st) st.textContent = 'Uploading ' + pts.length + ' fence points...';
  log('Uploading ' + pts.length + ' fence points', 'info');
}

function clearFence() {
  window._fenceState.polygons = [];
  window._fenceState.circles = [];
  renderFenceTable();
  if (window.fenceGroup && window.map) window.map.removeLayer(window.fenceGroup);
  window.fenceGroup = null;
  socket.emit('fence_upload', { points: [] });
  var st = document.getElementById('fenceStatus');
  if (st) st.textContent = 'Fence cleared';
  log('Fence cleared', 'info');
}

function updateFencePanel(data) {
  if (!data || !data.points) return;
  var fs = window._fenceState;
  fs.polygons = [{ include: true, edit: false }];
  fs.circles = [];
  renderFenceTable();
  var st = document.getElementById('fenceStatus');
  if (st) st.textContent = (data.count || data.points.length) + ' fence point(s) loaded from FCU';
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('map')) initMap(37.7749, -122.4194);
  restoreAppState();
  initCharts();
  initCameraDevices();
  initCameraResize();
  var hudBtn = document.getElementById('hudToggleBtn');
  var hudOv = document.getElementById('hudOverlay');
  if (hudBtn && hudOv) {
    hudBtn.addEventListener('click', function () {
      hudOv.classList.toggle('hud-collapsed');
      hudBtn.textContent = hudOv.classList.contains('hud-collapsed') ? '\u25B2' : '\u25BC';
    });
  }
  var leftToggle = document.getElementById('hudLeftToggle');
  var leftCol = document.getElementById('hudLeftCol');
  if (leftToggle && leftCol) {
    leftToggle.addEventListener('click', function () {
      leftCol.classList.toggle('hud-col-collapsed');
      leftToggle.textContent = leftCol.classList.contains('hud-col-collapsed') ? '\u25B6' : '\u25C0';
    });
  }
  var rightToggle = document.getElementById('hudRightToggle');
  var rightCol = document.getElementById('hudRightCol');
  if (rightToggle && rightCol) {
    rightToggle.addEventListener('click', function () {
      rightCol.classList.toggle('hud-col-collapsed');
      rightToggle.textContent = rightCol.classList.contains('hud-col-collapsed') ? '\u25C0' : '\u25B6';
    });
  }
});

// ===== Target Points =====
var _editTargetIdx = -1;

function saveTarget() {
  var lat = parseFloat(document.getElementById('targetLat').value);
  var lon = parseFloat(document.getElementById('targetLon').value);
  var name = document.getElementById('targetName').value.trim();
  if (isNaN(lat) || isNaN(lon)) { alert('Enter valid Lat/Lon values.'); return; }
  if (!name) { name = 'T' + (targetPoints.length + 1); }

  if (_editTargetIdx >= 0 && _editTargetIdx < targetPoints.length) {
    targetPoints[_editTargetIdx] = { lat: lat, lon: lon, name: name };
    log('Target updated: ' + name, 'success');
  } else {
    targetPoints.push({ lat: lat, lon: lon, name: name });
    log('Target added: ' + name + ' (' + lat.toFixed(6) + ', ' + lon.toFixed(6) + ')', 'success');
  }
  cancelEditTarget();
  persistTargets();
  renderTargetList();
  renderTargetMarkers();
  updateTargetDistPanel(window.vehicle || {});
}

function cancelEditTarget() {
  _editTargetIdx = -1;
  document.getElementById('targetLat').value = '';
  document.getElementById('targetLon').value = '';
  document.getElementById('targetName').value = '';
  document.getElementById('targetSaveBtn').textContent = '+ ADD';
  document.getElementById('targetCancelBtn').classList.add('hidden');
}

function editTarget(idx) {
  var t = targetPoints[idx];
  if (!t) return;
  _editTargetIdx = idx;
  document.getElementById('targetLat').value = t.lat;
  document.getElementById('targetLon').value = t.lon;
  document.getElementById('targetName').value = t.name || '';
  document.getElementById('targetSaveBtn').textContent = 'UPDATE';
  document.getElementById('targetCancelBtn').classList.remove('hidden');
}

function removeTarget(idx) {
  if (!confirm('Delete target "' + (targetPoints[idx].name || ('T' + (idx + 1))) + '"?')) return;
  if (_editTargetIdx === idx) cancelEditTarget();
  targetPoints.splice(idx, 1);
  persistTargets();
  renderTargetList();
  renderTargetMarkers();
  updateTargetDistPanel(window.vehicle || {});
}

function renderTargetList() {
  var container = document.getElementById('targetListContainer');
  if (!container) return;
  var v = window.vehicle;
  if (targetPoints.length === 0) {
    container.innerHTML = '<div style="color:#475569;font-size:10px;text-align:center;padding:12px 0">No targets added yet.</div>';
    return;
  }
  var h = '<div class="target-list-inner" style="display:flex;flex-direction:column;gap:2px">';
  targetPoints.forEach(function(t, i) {
    var d = (v && v.lat && v.lon) ? haversine(v.lat, v.lon, t.lat, t.lon) : 0;
    var distStr = d >= 1000 ? (d / 1000).toFixed(2) + ' km' : d.toFixed(0) + ' m';
    var name = t.name || ('T' + (i + 1));
    h += '<div class="target-item" data-idx="' + i + '" style="background:#0f172a;border-radius:6px;padding:6px 8px;display:flex;align-items:center;gap:6px">';
    h += '<span style="color:#7c3aed;font-weight:700;font-size:10px;min-width:18px">' + (i + 1) + '</span>';
    h += '<div style="flex:1;min-width:0">';
    h += '<div style="color:#e2e8f0;font-size:11px;font-weight:600">' + name + '</div>';
    h += '<div style="color:#64748b;font-size:9px">' + t.lat.toFixed(6) + ', ' + t.lon.toFixed(6) + '</div>';
    h += '</div>';
    h += '<div style="text-align:right">';
    h += '<div style="color:#22c55e;font-size:11px;font-weight:700">' + distStr + '</div>';
    h += '</div>';
    h += '<div class="target-actions" style="display:flex;gap:3px">';
    h += '<button onclick="editTarget(' + i + ')" style="background:none;border:1px solid #334155;border-radius:4px;color:#94a3b8;cursor:pointer;font-size:10px;padding:2px 6px" title="Edit">&#x270E;</button>';
    h += '<button onclick="removeTarget(' + i + ')" style="background:none;border:1px solid #334155;border-radius:4px;color:#ef4444;cursor:pointer;font-size:10px;padding:2px 6px" title="Delete">&#x2716;</button>';
    h += '</div>';
    h += '</div>';
  });
  h += '</div>';
  container.innerHTML = h;
}

function renderTargetMarkers() {
  if (!targetGroup) return;
  targetGroup.clearLayers();
  targetPoints.forEach(function(t, i) {
    var name = t.name || ('T' + (i + 1));
    var marker = L.marker([t.lat, t.lon], {
      icon: L.divIcon({
        className: 'target-marker',
        html: '<div style="width:26px;height:26px;background:#7c3aed;border:2px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;font-weight:700;box-shadow:0 0 10px rgba(124,58,237,0.6);">' + name + '</div>',
        iconSize: [26, 26], iconAnchor: [13, 13],
      }),
      interactive: false,
    }).addTo(targetGroup);
    marker.bindTooltip('<b>' + name + '</b><br>' + t.lat.toFixed(6) + ', ' + t.lon.toFixed(6), { direction: 'top' });
  });
}

function updateTargetDistPanel(data) {
  var panel = document.getElementById('targetDistPanel');
  var list = document.getElementById('targetDistList');
  var count = document.getElementById('targetDistCount');
  if (!panel || !list) return;
  if (targetPoints.length === 0 || !data.lat || !data.lon) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  if (count) count.textContent = targetPoints.length;
  var h = '';
  targetPoints.forEach(function(t, i) {
    var d = haversine(data.lat, data.lon, t.lat, t.lon);
    var name = t.name || ('T' + (i + 1));
    var cls = 'target-dist-item';
    if (d > 10000) cls += ' far';
    h += '<div class="' + cls + '" style="display:flex;align-items:center;padding:5px 0;border-bottom:1px solid #1e293b">';
    h += '<span style="color:#7c3aed;font-weight:700;font-size:11px;min-width:20px">' + (i + 1) + '</span>';
    h += '<span style="color:#e2e8f0;font-size:11px;font-weight:600;flex:1">' + name + '</span>';
    if (d >= 1000) {
      h += '<span style="color:#22c55e;font-size:12px;font-weight:700">' + (d / 1000).toFixed(2) + ' km</span>';
    } else {
      h += '<span style="color:#22c55e;font-size:12px;font-weight:700">' + d.toFixed(0) + ' m</span>';
    }
    h += '</div>';
  });
  list.innerHTML = h;
}

// ===== State Persistence =====
function persistTargets() {
  try { localStorage.setItem('sgc_targets', JSON.stringify(targetPoints)); } catch(e) {}
}

function saveAppState() {
  persistTargets();
  try {
    var v = window.vehicle;
    if (v && v.connected) {
      sessionStorage.setItem('sgc_was_connected', '1');
      var r = buildConnString();
      sessionStorage.setItem('sgc_conn_str', r.conn);
      sessionStorage.setItem('sgc_conn_baud', String(r.baud));
      if (v.lat) sessionStorage.setItem('sgc_last_lat', String(v.lat));
      if (v.lon) sessionStorage.setItem('sgc_last_lon', String(v.lon));
    } else {
      sessionStorage.setItem('sgc_was_connected', '0');
    }
  } catch(e) {}

  // Notification prev-state
  try {
    sessionStorage.setItem('sgc_n_connected', _nPrevConnected ? '1' : '0');
    sessionStorage.setItem('sgc_n_mode', _nPrevMode);
    sessionStorage.setItem('sgc_n_armed', _nPrevArmed ? '1' : '0');
    sessionStorage.setItem('sgc_n_low20', _nLowBatt20 ? '1' : '0');
    sessionStorage.setItem('sgc_n_low10', _nLowBatt10 ? '1' : '0');
  } catch(e) {}

  // Flight stats
  try {
    sessionStorage.setItem('sgc_fs_home_set', _fsHomeSet ? '1' : '0');
    sessionStorage.setItem('sgc_fs_home_lat', String(_fsHomeLat));
    sessionStorage.setItem('sgc_fs_home_lon', String(_fsHomeLon));
    sessionStorage.setItem('sgc_fs_max_alt', String(_fsMaxAlt));
    sessionStorage.setItem('sgc_fs_max_gs', String(_fsMaxGS));
    sessionStorage.setItem('sgc_fs_max_dist', String(_fsMaxDist));
    sessionStorage.setItem('sgc_fs_armed', _fsArmed ? '1' : '0');
    if (_fsTimerStart) sessionStorage.setItem('sgc_fs_timer_start', String(_fsTimerStart));
  } catch(e) {}

  // HUD state
  try {
    if (_hudConnStart !== null) sessionStorage.setItem('sgc_hud_conn_start', String(_hudConnStart));
    sessionStorage.setItem('sgc_hud_climb', String(_hudClimb));
    if (_hudLastAlt !== null) sessionStorage.setItem('sgc_hud_last_alt', String(_hudLastAlt));
    if (_hudLastTime !== null) sessionStorage.setItem('sgc_hud_last_time', String(_hudLastTime));
  } catch(e) {}

  // Log-request guard
  try {
    sessionStorage.setItem('sgc_logs_requested', _logsRequested ? '1' : '0');
  } catch(e) {}

  // Console content
  try {
    var consoleEl = document.getElementById('consoleOutput');
    if (consoleEl && consoleEl.children.length > 0) {
      sessionStorage.setItem('sgc_console_html', consoleEl.innerHTML);
    }
  } catch(e) {}
}

function restoreAppState() {
  // Restore targets
  try {
    var saved = localStorage.getItem('sgc_targets');
    if (saved) {
      targetPoints = JSON.parse(saved) || [];
      renderTargetList();
      renderTargetMarkers();
      updateTargetDistPanel(window.vehicle || {});
    }
  } catch(e) {}

  // Restore notification prev-state (prevents reconnect popups)
  try {
    var nc = sessionStorage.getItem('sgc_n_connected');
    if (nc !== null) _nPrevConnected = nc === '1';
    var nm = sessionStorage.getItem('sgc_n_mode');
    if (nm !== null) _nPrevMode = nm;
    var na = sessionStorage.getItem('sgc_n_armed');
    if (na !== null) _nPrevArmed = na === '1';
    var nl20 = sessionStorage.getItem('sgc_n_low20');
    if (nl20 !== null) _nLowBatt20 = nl20 === '1';
    var nl10 = sessionStorage.getItem('sgc_n_low10');
    if (nl10 !== null) _nLowBatt10 = nl10 === '1';
  } catch(e) {}

  // Restore flight stats (preserves max alt/speed/dist and flight timer)
  try {
    var fh = sessionStorage.getItem('sgc_fs_home_set');
    if (fh !== null) _fsHomeSet = fh === '1';
    var fhl = sessionStorage.getItem('sgc_fs_home_lat');
    if (fhl !== null) _fsHomeLat = parseFloat(fhl);
    var fhln = sessionStorage.getItem('sgc_fs_home_lon');
    if (fhln !== null) _fsHomeLon = parseFloat(fhln);
    var fma = sessionStorage.getItem('sgc_fs_max_alt');
    if (fma !== null) _fsMaxAlt = parseFloat(fma);
    var fmg = sessionStorage.getItem('sgc_fs_max_gs');
    if (fmg !== null) _fsMaxGS = parseFloat(fmg);
    var fmd = sessionStorage.getItem('sgc_fs_max_dist');
    if (fmd !== null) _fsMaxDist = parseFloat(fmd);
    var fa = sessionStorage.getItem('sgc_fs_armed');
    if (fa !== null) _fsArmed = fa === '1';
    var fts = sessionStorage.getItem('sgc_fs_timer_start');
    if (fts !== null) {
      _fsTimerStart = parseFloat(fts);
      window.clearInterval(_fsTimerInterval);
      _fsTimerInterval = window.setInterval(updateFlightTimer, 1000);
    }
  } catch(e) {}

  // Restore HUD state (preserves connection time counter)
  try {
    var hcs = sessionStorage.getItem('sgc_hud_conn_start');
    if (hcs !== null) _hudConnStart = parseFloat(hcs);
    var hc = sessionStorage.getItem('sgc_hud_climb');
    if (hc !== null) _hudClimb = parseFloat(hc);
    var hla = sessionStorage.getItem('sgc_hud_last_alt');
    if (hla !== null) _hudLastAlt = parseFloat(hla);
    var hlt = sessionStorage.getItem('sgc_hud_last_time');
    if (hlt !== null) _hudLastTime = parseFloat(hlt);
  } catch(e) {}

  // Restore log-request guard
  try {
    var lr = sessionStorage.getItem('sgc_logs_requested');
    if (lr !== null) _logsRequested = lr === '1';
  } catch(e) {}

  // Restore console content (preserves previous log messages across navigation)
  try {
    var consoleHtml = sessionStorage.getItem('sgc_console_html');
    if (consoleHtml) {
      var consoleEl = document.getElementById('consoleOutput');
      if (consoleEl) { consoleEl.innerHTML = consoleHtml; consoleEl.scrollTop = consoleEl.scrollHeight; }
    }
  } catch(e) {}

  // Restore connection — the server already sends state_update on
  // socket reconnect via its on_connect handler, so no connect_request needed.
  try {
    if (sessionStorage.getItem('sgc_was_connected') === '1') {
      var btn = document.getElementById('connectBtn');
      if (btn) { btn.textContent = '\u25CF Connected'; btn.classList.add('connected'); btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
    }
  } catch(e) {}

  // Restore map center
  try {
    var lat = parseFloat(sessionStorage.getItem('sgc_last_lat'));
    var lon = parseFloat(sessionStorage.getItem('sgc_last_lon'));
    if (!isNaN(lat) && !isNaN(lon) && window.map) {
      window.map.setView([lat, lon], window.map.getZoom());
    }
  } catch(e) {}
}

// ===== Camera =====
var _cam = {
  source: 'network',
  netConnected: false,
  netActive: false,
  netRetryTimer: null,
  localStream: null,
  localActive: false,
  fpsInterval: null,
};

var _camEnumCount = 0;

function initCameraDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  navigator.mediaDevices.enumerateDevices().then(function(devices) {
    var sel = document.getElementById('cameraDeviceSelect');
    if (!sel) return;
    var videoDevices = devices.filter(function(d) { return d.kind === 'videoinput'; });
    sel.innerHTML = '';
    if (videoDevices.length === 0) {
      sel.innerHTML = '<option value="">No camera found</option>';
      return;
    }
    videoDevices.forEach(function(device, i) {
      var opt = document.createElement('option');
      // Use a unique placeholder when deviceId is empty (pre-permission state)
      if (device.deviceId && device.deviceId !== '') {
        opt.value = device.deviceId;
      } else {
        opt.value = '__cam_' + i;
      }
      opt.textContent = device.label || 'Camera ' + (i + 1);
      sel.appendChild(opt);
    });
    _camEnumCount = videoDevices.length;
  }).catch(function() {});
}

function switchCameraSource(type) {
  // Disconnect current source first
  if (_cam.source === 'network' && _cam.netConnected) {
    disconnectNetworkStream();
  }
  if (_cam.source === 'local' && _cam.localActive) {
    stopLocalCamera();
  }
  _cam.source = type;
  document.getElementById('camSrcNetwork').className = 'camera-source-btn' + (type === 'network' ? ' active' : '');
  document.getElementById('camSrcLocal').className = 'camera-source-btn' + (type === 'local' ? ' active' : '');
  document.getElementById('cameraUrlRow').classList.toggle('hidden', type !== 'network');
  document.getElementById('cameraDeviceRow').classList.toggle('hidden', type !== 'local');

  var placeholder = document.getElementById('cameraPlaceholder');
  placeholder.classList.remove('hidden');
  placeholder.querySelector('.camera-placeholder-text').textContent = 'No video source';
  placeholder.querySelector('.camera-placeholder-hint').textContent =
    type === 'network' ? 'Enter a stream URL below' : 'Select a camera and click Start';
  document.getElementById('cameraImage').classList.add('hidden');
  document.getElementById('cameraImage').src = '';
  document.getElementById('cameraVideo').classList.add('hidden');
  document.getElementById('cameraVideo').srcObject = null;
  document.getElementById('cameraStatus').classList.add('hidden');
  document.getElementById('cameraInfo').classList.add('hidden');

  if (type === 'local') initCameraDevices();
}

function disconnectNetworkStream() {
  _cam.netConnected = false;
  _cam.netActive = false;
  if (_cam.netRetryTimer) { clearTimeout(_cam.netRetryTimer); _cam.netRetryTimer = null; }
  var img = document.getElementById('cameraImage');
  img.classList.add('hidden');
  img.src = '';
  var btn = document.getElementById('cameraConnectBtn');
  btn.textContent = 'Connect';
  btn.classList.remove('connected');
  btn.disabled = false;
  document.getElementById('cameraPlaceholder').classList.remove('hidden');
  document.getElementById('cameraStatus').classList.add('hidden');
  document.getElementById('cameraInfo').classList.add('hidden');
}

function toggleCameraStream() {
  var btn = document.getElementById('cameraConnectBtn');
  var img = document.getElementById('cameraImage');
  var placeholder = document.getElementById('cameraPlaceholder');
  var status = document.getElementById('cameraStatus');
  var statusText = document.getElementById('cameraStatusText');
  var statusDot = document.getElementById('cameraStatusDot');
  var info = document.getElementById('cameraInfo');

  if (_cam.netConnected) { disconnectNetworkStream(); return; }

  var url = document.getElementById('cameraUrl').value.trim();
  if (!url) { notify('Enter a stream URL', 'warning'); return; }

  _cam.netActive = true;
  btn.textContent = 'Connecting...';
  btn.disabled = true;
  placeholder.classList.add('hidden');
  status.classList.remove('hidden');
  statusDot.className = 'camera-status-dot connecting';
  statusText.textContent = 'Connecting...';

  img.onload = function() {
    _cam.netConnected = true;
    btn.textContent = 'Disconnect';
    btn.classList.add('connected');
    btn.disabled = false;
    statusDot.className = 'camera-status-dot connected';
    statusText.textContent = 'Connected';
    info.classList.remove('hidden');
    document.getElementById('cameraInfoRes').textContent = img.naturalWidth + 'x' + img.naturalHeight;
    _cam.netRetryTimer = null;
  };

  img.onerror = function() {
    if (!_cam.netActive) return;
    statusDot.className = 'camera-status-dot error';
    statusText.textContent = 'Connection failed';
    btn.textContent = 'Retry';
    btn.classList.remove('connected');
    btn.disabled = false;
    info.classList.add('hidden');
    _cam.netConnected = false;
    _cam.netRetryTimer = setTimeout(function() {
      if (_cam.netActive) toggleCameraStream();
    }, 5000);
  };

  img.classList.remove('hidden');
  img.src = url;
}

function toggleLocalCamera() {
  if (_cam.localActive) { stopLocalCamera(); return; }
  startLocalCamera();
}

function startLocalCamera() {
  var sel = document.getElementById('cameraDeviceSelect');

  var btn = document.getElementById('cameraLocalBtn');
  var video = document.getElementById('cameraVideo');
  var placeholder = document.getElementById('cameraPlaceholder');
  var status = document.getElementById('cameraStatus');
  var statusText = document.getElementById('cameraStatusText');
  var statusDot = document.getElementById('cameraStatusDot');
  var info = document.getElementById('cameraInfo');

  btn.textContent = 'Starting...';
  btn.disabled = true;
  placeholder.classList.add('hidden');
  status.classList.remove('hidden');
  statusDot.className = 'camera-status-dot connecting';
  statusText.textContent = 'Starting camera...';

  var constraints = {
    video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  };
  if (sel && sel.value && !sel.value.startsWith('__cam_')) {
    constraints.video.deviceId = { exact: sel.value };
  }

  navigator.mediaDevices.getUserMedia(constraints).then(function(stream) {
    _cam.localStream = stream;
    _cam.localActive = true;
    // Re-enumerate after permission granted to get full device list
    initCameraDevices();
    video.srcObject = stream;
    video.classList.remove('hidden');
    btn.textContent = 'Stop Camera';
    btn.classList.add('connected');
    btn.disabled = false;
    statusDot.className = 'camera-status-dot connected';
    statusText.textContent = 'Connected';
    info.classList.remove('hidden');

    // Wait for video metadata to get resolution
    video.onloadedmetadata = function() {
      document.getElementById('cameraInfoRes').textContent = video.videoWidth + 'x' + video.videoHeight;
    };

    // Estimate FPS
    var frameCount = 0; var lastFpsTime = Date.now();
    if (_cam.fpsInterval) clearInterval(_cam.fpsInterval);
    _cam.fpsInterval = setInterval(function() {
      frameCount++;
      var now = Date.now();
      if (now - lastFpsTime >= 1000) {
        var el = document.getElementById('cameraInfoFps');
        if (el) el.textContent = Math.round(frameCount / ((now - lastFpsTime) / 1000)) + ' fps';
        frameCount = 0; lastFpsTime = now;
      }
    }, 200);
  }).catch(function(err) {
    btn.textContent = 'Start Camera';
    btn.disabled = false;
    statusDot.className = 'camera-status-dot error';
    statusText.textContent = 'Camera error: ' + (err.name === 'NotAllowedError' ? 'Permission denied' : err.message);
    placeholder.classList.remove('hidden');
    notify('Camera error: ' + err.message, 'danger');
  });
}

function stopLocalCamera() {
  if (!_cam.localActive) return;
  _cam.localActive = false;
  if (_cam.localStream) {
    _cam.localStream.getTracks().forEach(function(t) { t.stop(); });
    _cam.localStream = null;
  }
  if (_cam.fpsInterval) { clearInterval(_cam.fpsInterval); _cam.fpsInterval = null; }
  var video = document.getElementById('cameraVideo');
  video.srcObject = null;
  video.classList.add('hidden');
  document.getElementById('cameraPlaceholder').classList.remove('hidden');
  document.getElementById('cameraStatus').classList.add('hidden');
  document.getElementById('cameraInfo').classList.add('hidden');
  var btn = document.getElementById('cameraLocalBtn');
  btn.textContent = 'Start Camera';
  btn.classList.remove('connected');
  btn.disabled = false;
}

function cameraDeviceChanged() {
  if (_cam.localActive) {
    stopLocalCamera();
  }
}

function cameraSnapshot() {
  var img = document.getElementById('cameraImage');
  var video = document.getElementById('cameraVideo');
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d');
  var source = null;

  if (_cam.source === 'network' && _cam.netConnected && !img.classList.contains('hidden')) {
    source = img;
  } else if (_cam.source === 'local' && _cam.localActive && !video.classList.contains('hidden')) {
    source = video;
  }

  if (!source) { notify('No active camera feed', 'warning'); return; }

  canvas.width = source.videoWidth || source.naturalWidth || 640;
  canvas.height = source.videoHeight || source.naturalHeight || 480;
  ctx.drawImage(source, 0, 0);
  var link = document.createElement('a');
  link.download = 'snapshot_' + new Date().toISOString().slice(0,19).replace(/[:-]/g, '') + '.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
  notify('Snapshot saved', 'success');
}

function cameraFullscreen() {
  var feed = document.getElementById('cameraFeed');
  if (!feed) return;
  if (feed.requestFullscreen) { feed.requestFullscreen(); }
  else if (feed.webkitRequestFullscreen) { feed.webkitRequestFullscreen(); }
  else if (feed.msRequestFullscreen) { feed.msRequestFullscreen(); }
}

function cameraSettings() {
  notify('Camera settings coming soon', 'info');
}

function initCameraResize() {
  var handle = document.getElementById('cameraResizeHandle');
  var card = document.getElementById('sideCardCamera');
  if (!handle || !card) return;
  handle.addEventListener('mousedown', function(e) {
    e.preventDefault();
    var startX = e.clientX;
    var startWidth = card.offsetWidth;
    handle.classList.add('active');
    function onMove(ev) {
      var w = startWidth + startX - ev.clientX;
      w = Math.max(240, Math.min(window.innerWidth * 0.9, w));
      card.style.width = w + 'px';
    }
    function onUp() {
      handle.classList.remove('active');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

window.addEventListener('beforeunload', function() {
  saveAppState();
  if (_cam.netRetryTimer) clearTimeout(_cam.netRetryTimer);
  if (_cam.localActive) stopLocalCamera();
});

