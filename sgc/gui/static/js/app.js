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
const TRAIL_MAX = 500;
const TRAIL_SEGMENTS = 10;

socket.on('connect', () => {
});

socket.on('state_update', (data) => {
  vehicle = data;
  updateTelemetry(data);
  updateMap(data);
  updateActions(data);
  updateStatusBar(data);
  const btn = document.getElementById('connectBtn');
  if (data.connected) {
    btn.textContent = 'DISCONNECT';
    btn.className = 'connected';
  } else {
    btn.textContent = 'CONNECT';
    btn.className = '';
  }
});

socket.on('log', (data) => {
  log(data.message, data.level);
});

socket.on('mission_data', (data) => {
  drawMissionWaypoints(data.waypoints || []);
});

function log(message, level = 'info') {
  const el = document.getElementById('consoleOutput');
  const div = document.createElement('div');
  div.className = `log-${level}`;
  div.textContent = message;
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

function toggleConsole() {
  document.getElementById('console').classList.toggle('hidden');
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

document.addEventListener('DOMContentLoaded', () => {
  initMap(37.7749, -122.4194);
});


