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

socket.on('connect', () => {
  socket.emit('request_logs');
});

function connectVehicle() {
  socket.emit('connect_request', { connection: 'udpin:0.0.0.0:14550', baud: 57600 });
  var btn = document.getElementById('connectBtn');
  if (btn) { btn.textContent = '\u25CF Connecting...'; btn.disabled = true; btn.style.opacity = '0.5'; }
}

socket.on('state_update', (data) => {
  vehicle = data;
  updateWaterfall(data);
  updateTelemetry(data);

  var wf = document.getElementById('waterfallWrap');
  if (wf) {
    wf.classList.toggle('connected', !!data.connected);
    wf.classList.toggle('disconnected', !data.connected);
  }
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
    var banner = document.getElementById('prearmBanner');
    var text = document.getElementById('prearmText');
    if (banner && text) {
      text.textContent = data.message;
      banner.classList.remove('hidden');
      clearTimeout(banner._timer);
      banner._timer = setTimeout(function() { banner.classList.add('hidden'); }, 15000);
    }
  }
  if (_calActive && !msg.includes('got command_ack') && (msg.includes('place') || msg.includes('rotate') || msg.includes('calibration') || msg.includes('progress') || msg.includes('orient') || msg.includes('finished') || msg.includes('complete') || msg.includes('continue') || msg.includes('success') || msg.includes('failed') || msg.includes('rejected'))) {
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

var CAL_PROGRESS = {
  gyro: { steps: 1, label: 'Gyroscope' },
  accel: { steps: 6, label: 'Accelerometer' },
  mag: { steps: 1, label: 'Compass' },
  level: { steps: 1, label: 'Level Horizon' },
  radio: { steps: 1, label: 'Radio' },
  pressure: { steps: 1, label: 'Pressure' },
};

function startCalibration(type) {
  _calActive = true;
  _calType = type;

  var label = CAL_PROGRESS[type] ? CAL_PROGRESS[type].label : type;
  document.getElementById('calTitle').textContent = label + ' Calibration';
  document.getElementById('calInstruction').textContent = 'Starting ' + label.toLowerCase() + ' calibration...';
  document.getElementById('calStatus').textContent = '';
  document.getElementById('calProgressBar').style.width = '0%';
  document.getElementById('calContinueBtn').classList.add('hidden');
  document.getElementById('calModal').classList.remove('hidden');

  socket.emit('calibrate', { type: type });
}

function continueCalibration() {
  if (!_calActive) return;
  document.getElementById('calInstruction').textContent = 'Waiting for next step...';
  document.getElementById('calStatus').textContent = 'Position confirmed, communicating with FCU...';
  document.getElementById('calContinueBtn').classList.add('hidden');
  socket.emit('calibrate', { type: _calType });
}

function abortCalibration() {
  _calActive = false;
  _calType = '';
  document.getElementById('calModal').classList.add('hidden');
}

function updateCalibration(msg) {
  if (!_calActive) return;
  document.getElementById('calInstruction').textContent = msg;
  document.getElementById('calStatus').textContent = msg;

  var lower = msg.toLowerCase();
  var finished = lower.includes('finished') || lower.includes('complete') || lower.includes('success') || lower.includes('passed');

  var needsContinue = _calType === 'accel' && !finished && (lower.includes('place') || lower.includes('orient') || lower.includes('position') || lower.includes('level'));
  document.getElementById('calContinueBtn').classList.toggle('hidden', !needsContinue);

  if (finished || lower.includes('failed') || lower.includes('rejected')) {
    document.getElementById('calProgressBar').style.width = '100%';
    setTimeout(function() {
      _calActive = false;
      _calType = '';
      document.getElementById('calModal').classList.add('hidden');
    }, 2500);
  }
}

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

function switchActionTab(tab) {
  var tabs = document.querySelectorAll('.action-tab');
  tabs.forEach(function(t) { t.classList.remove('active'); });
  var activeTab = document.querySelector('.action-tab[data-tab="' + tab + '"]');
  if (activeTab) activeTab.classList.add('active');
  document.getElementById('controlPanel').classList.add('hidden');
  document.getElementById('healthPanel').classList.add('hidden');
  document.getElementById('statsPanel').classList.add('hidden');
  document.getElementById(tab + 'Panel').classList.remove('hidden');
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
  var cardId = tab === 'charts' ? 'sideCardCharts' : tab === 'inspector' ? 'sideCardInspector' : 'sideCardTelemetry';
  var card = document.getElementById(cardId);
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
  var cards = ['sideCardTelemetry', 'sideCardCharts', 'sideCardInspector'];
  cards.forEach(function(id) { document.getElementById(id).classList.add('hidden'); });
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
  initWaterfall('waterfallCanvas');
  initCharts();
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


