const socket = io();
let vehicle = {
  connected: false, lat: 0, lon: 0, heading: 0, mode: '---',
  armed: false, ground_speed: 0, alt: 0, satellites: 0, fix_type: 0,
  battery_remaining: 100, battery_voltage: 0, roll: 0, pitch: 0,
  hdop: 99.99,
};
let vehicleMarker = null;
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

socket.on('state_update', (data) => {
  vehicle = data;
  updateTelemetry(data);
  updateMap(data);
  updateActions(data);
  updateStatusBar(data);
  feedCharts(data);
  const btn = document.getElementById('connectBtn');
  if (data.connected) {
    btn.textContent = 'DISCONNECT';
    btn.className = 'connected';
  } else {
    btn.textContent = 'CONNECT';
    btn.className = '';
  }
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
});

socket.on('mission_data', (data) => {
  window._lastMissionData = data;
  drawMissionWaypoints(data.waypoints || []);
  var el = document.getElementById('s_mission');
  if (el) el.textContent = '\u25CF Mission: ' + (data.count || 0);
});

socket.on('fence_data', (data) => {
  window._lastFenceData = data;
  drawFencePoints(data.points || []);
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
  } else {
    socket.emit('start_tlog');
  }
}

function log(message, level = 'info') {
  const el = document.getElementById('consoleOutput');
  const div = document.createElement('div');
  div.className = `log-${level}`;
  var t = new Date();
  div.textContent = '[' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0') + '] ' + message;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function toggleConnection() {
  if (vehicle.connected) {
    disconnectVehicle();
  } else {
    showConnectDialog();
  }
}

function disconnectVehicle() {
  socket.emit('disconnect_vehicle');
  const btn = document.getElementById('connectBtn');
  btn.textContent = 'CONNECT';
  btn.className = '';
  btn.disabled = false;
}

function connectVehicle(type, port, baud, host, portNum) {
  log(`Connecting: ${type}${port ? ' ' + port : ''} @ ${baud} baud...`, 'info');
  const btn = document.getElementById('connectBtn');
  btn.textContent = 'CONNECTING...';
  btn.disabled = true;
  socket.emit('connect_vehicle', {
    type, port, baud: parseInt(baud),
    host: host || '', port_num: parseInt(portNum) || 0,
  });
}

function showConnectDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog-box" style="width:420px">
      <h3>Connect to Vehicle</h3>
      <div class="dialog-row">
        <label>Type:</label>
        <select id="connType" style="flex:1;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:8px 12px;font-size:13px;outline:none;">
          <option value="sitl">SITL (UDP 127.0.0.1:14550)</option>
          <option value="serial">Serial Port</option>
          <option value="tcp_client">TCP Client</option>
          <option value="tcp_server">TCP Server</option>
          <option value="udp">UDP (listen)</option>
        </select>
      </div>

      <div id="connSerial" style="display:none">
        <div class="dialog-row">
          <label>Port:</label>
          <select id="dialPort" style="flex:1;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:8px 12px;font-size:13px;outline:none;"></select>
        </div>
        <div class="dialog-row">
          <label>Baud:</label>
          <select id="dialBaud" style="flex:1;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:8px 12px;font-size:13px;outline:none;">
            <option>9600</option><option>19200</option><option>38400</option>
            <option selected>57600</option><option>115200</option><option>921600</option>
          </select>
        </div>
      </div>

      <div id="connNet" style="display:none">
        <div class="dialog-row">
          <label>Host:</label>
          <input type="text" id="dialHost" value="127.0.0.1" style="flex:1;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:8px 12px;font-size:13px;outline:none;" />
        </div>
        <div class="dialog-row">
          <label>Port:</label>
          <input type="text" id="dialPortNum" value="5760" style="flex:1;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:8px 12px;font-size:13px;outline:none;" />
        </div>
      </div>

      <div class="dialog-btns">
        <button class="secondary" onclick="this.closest('.dialog-overlay').remove()">Cancel</button>
        <button class="primary" onclick="doConnect()">Connect</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const typeSel = overlay.querySelector('#connType');
  const serialDiv = overlay.querySelector('#connSerial');
  const netDiv = overlay.querySelector('#connNet');

  const updateFields = () => {
    const v = typeSel.value;
    serialDiv.style.display = v === 'serial' ? '' : 'none';
    netDiv.style.display = (v === 'tcp_client' || v === 'tcp_server' || v === 'udp') ? '' : 'none';
  };
  typeSel.addEventListener('change', updateFields);

  // Populate serial ports when type is auto/serial
  const loadSer = async () => {
    const sel = overlay.querySelector('#dialPort');
    sel.innerHTML = '<option value="">Scanning...</option>';
    try {
      const r = await fetch('/api/ports');
      const ports = await r.json();
      sel.innerHTML = '';
      if (ports.length === 0) {
        sel.innerHTML = '<option value="">No ports found</option>';
      }
      ports.forEach(p => {
        const o = document.createElement('option');
        o.value = p.device;
        o.textContent = `${p.device}  (${p.description})`;
        sel.appendChild(o);
      });
    } catch {
      sel.innerHTML = '<option value="">Error loading ports</option>';
    }
  };
  loadSer();
  updateFields();
}

function doConnect() {
  const type = document.querySelector('#connType').value;
  const port = document.querySelector('#dialPort')?.value || '';
  const baud = document.querySelector('#dialBaud')?.value || '57600';
  const host = document.querySelector('#dialHost')?.value || '';
  const portNum = document.querySelector('#dialPortNum')?.value || '0';

  if (type === 'sitl') {
    connectVehicle('udp', '', '57600', '127.0.0.1', '14550');
  } else if (type === 'serial') {
    if (!port) { log('Select a serial port', 'warning'); return; }
    connectVehicle('serial', port, baud, '', '');
  } else {
    connectVehicle(type, '', baud, host, portNum);
  }
  document.querySelector('.dialog-overlay').remove();
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
  setTimeout(() => {
    socket.emit('arm');
  }, 500);
  setTimeout(() => {
    command('TAKEOFF', { altitude: parseFloat(alt) || 10 });
  }, 2000);
}

// Legacy stubs for menu references
function showConnectionDialog() { showConnectDialog(); }
function connectFromDialog() { doConnect(); }

function menuAction(action) {
  if (action === 'Exit') { window.close(); return; }
  if (action === 'About') {
    alert('SGC v0.1.0\nSkywin Ground Control Station\n\nA professional MAVLink GCS\nbuilt with Python, Flask & pymavlink.\n\nCompatible with ArduPilot and PX4.');
    return;
  }
  if (['Serial Port', 'TCP Client', 'TCP Server', 'UDP'].includes(action)) {
    showConnectDialog();
    return;
  }
  log(`Menu: ${action}`, 'info');
}

function toggleConsoleSize() {
  var rc = document.getElementById('rightConsole');
  var btn = document.getElementById('consoleExpandBtn');
  rc.classList.toggle('expanded');
  btn.innerHTML = rc.classList.contains('expanded') ? '&#9660;' : '&#9650;';
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
  if (pts.length > 1) {
    L.polyline(pts, {color: '#0ea5e9', weight: 2, opacity: 0.5, dashArray: '6,4', interactive: false}).addTo(missionWpGroup);
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
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(window.map);

    addGrid(window.map);
    trailGroup = L.featureGroup().addTo(window.map);
    missionWpGroup = L.featureGroup().addTo(window.map);
    fenceGroup = L.featureGroup().addTo(window.map);
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
  totalDistance: 0,
};

function startMeasuring() {
  document.getElementById('mapContextMenu').classList.add('hidden');
  if (measure.active) { stopMeasuring(); return; }
  measure.active = true;
  measure.points = [];
  measure.totalDistance = 0;
  measure.polyline = L.polyline([], { color: '#f59e0b', weight: 2, dashArray: '6,4' }).addTo(window.map);
  window.map.getContainer().style.cursor = 'crosshair';
  window.map.on('click', measureClick);
  var item = document.querySelector('#mapContextMenu div:last-child');
  if (item) item.textContent = 'Stop Measuring';
  log('Measurement: click points on map. Right-click or Esc to finish.', 'info');
}

function stopMeasuring() {
  measure.active = false;
  measure.points = [];
  measure.totalDistance = 0;
  if (measure.polyline) { window.map.removeLayer(measure.polyline); measure.polyline = null; }
  measure.markers.forEach(function(m) { window.map.removeLayer(m); });
  measure.markers = [];
  measure.labels.forEach(function(l) { window.map.removeLayer(l); });
  measure.labels = [];
  window.map.off('click', measureClick);
  window.map.getContainer().style.cursor = '';
  var item = document.querySelector('#mapContextMenu div:last-child');
  if (item) item.textContent = 'Start Measuring';
}

function stopMeasuring() {
  measure.active = false;
  measure.points = [];
  measure.totalDistance = 0;
  if (measure.polyline) { window.map.removeLayer(measure.polyline); measure.polyline = null; }
  measure.markers.forEach(function(m) { window.map.removeLayer(m); });
  measure.markers = [];
  measure.labels.forEach(function(l) { window.map.removeLayer(l); });
  measure.labels = [];
  window.map.off('click', measureClick);
  window.map.getContainer().style.cursor = '';
}

function measureClick(e) {
  var ll = e.latlng;
  measure.points.push(ll);
  var idx = measure.points.length - 1;

  var marker = L.circleMarker([ll.lat, ll.lng], {
    radius: 4, color: '#f59e0b', fillColor: '#fbbf24', fillOpacity: 1, weight: 2,
  }).addTo(window.map);
  measure.markers.push(marker);

  var label = L.tooltip({ permanent: true, direction: 'top', className: 'measure-label' });
  if (idx === 0) {
    label.setContent('Start');
    marker.bindTooltip('Start', { permanent: true, direction: 'top' }).openTooltip();
  } else {
    var prev = measure.points[idx - 1];
    var d = ll.distanceTo(prev);
    measure.totalDistance += d;
    var totalStr = measure.totalDistance >= 1000
      ? (measure.totalDistance / 1000).toFixed(2) + ' km'
      : measure.totalDistance.toFixed(1) + ' m';
    var segStr = d >= 1000 ? (d / 1000).toFixed(2) + ' km' : d.toFixed(1) + ' m';
    marker.bindTooltip(segStr, { permanent: true, direction: 'top' }).openTooltip();
    measure.labels.forEach(function(l) { window.map.removeLayer(l); });
    measure.labels = [];
    var totalLabel = L.tooltip({
      permanent: true, direction: 'bottom', className: 'measure-total',
      latlng: ll,
    }).setContent('Total: ' + totalStr).addTo(window.map);
    measure.labels.push(totalLabel);
  }

  measure.polyline.setLatLngs(measure.points);
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && measure.active) stopMeasuring();
});

window.startMeasuring = startMeasuring;

function updateActions(data) {
  setText('i_sysid', data.sysid ?? '---');
  setText('i_compid', data.compid ?? '---');
  setText('i_type', data.vehicle_type ?? '---');
  setText('i_firmware', data.firmware ?? '---');

  if (data.connected) {
    const btn = document.getElementById('connectBtn');
    btn.textContent = 'DISCONNECT';
    btn.className = 'connected';
    btn.disabled = false;
  }
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
  var tabs = document.querySelectorAll('.sidebar-tab');
  tabs.forEach(function(t) { t.classList.remove('active'); });
  var activeTab = document.querySelector('.sidebar-tab[data-tab="' + tab + '"]');
  if (activeTab) activeTab.classList.add('active');
  var telemetryPanel = document.getElementById('telemetryPanel');
  var chartsPanel = document.getElementById('chartsPanel');
  var inspectorPanel = document.getElementById('inspectorPanel');
  telemetryPanel.classList.add('hidden');
  chartsPanel.classList.add('hidden');
  inspectorPanel.classList.add('hidden');
  if (tab === 'charts') {
    chartsPanel.classList.remove('hidden');
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
    inspectorPanel.classList.remove('hidden');
    inspectorState.active = true;
    socket.emit('start_inspector');
  } else {
    if (inspectorState.active) {
      inspectorState.active = false;
      socket.emit('stop_inspector');
    }
    telemetryPanel.classList.remove('hidden');
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

document.addEventListener('DOMContentLoaded', () => {
  initMap(37.7749, -122.4194);
  initCharts();
});


