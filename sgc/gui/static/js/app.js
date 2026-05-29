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

socket.on('connect', () => {
  log('Connected to SGC server', 'system');
});

socket.on('state_update', (data) => {
  vehicle = data;
  updateTelemetry(data);
  updateMap(data);
  updateActions(data);
  updateStatusBar(data);
});

socket.on('log', (data) => {
  log(data.message, data.level);
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
    const port = document.getElementById('portSelect').value;
    const baud = document.getElementById('baudSelect').value;
    if (port === 'auto') {
      autoScanConnect(baud);
      return;
    }
    if (!port) {
      log('Select a serial port or use Auto', 'warning');
      return;
    }
    connectVehicle('serial', port, baud, '', '');
  }
}

async function autoScanConnect(baud) {
  const btn = document.getElementById('connectBtn');
  btn.textContent = 'SCANNING...';
  btn.disabled = true;
  log('Scanning serial ports for MAVLink device...', 'info');
  try {
    const res = await fetch(`/api/auto_scan?baud=${baud}&timeout=2`);
    const data = await res.json();
    if (data.found && data.found.length > 0) {
      const device = data.found[0];
      log(`Auto-detected: ${device.device} (${device.description})`, 'success');
      const sel = document.getElementById('portSelect');
      sel.value = device.device;
      connectVehicle('serial', device.device, baud, '', '');
    } else {
      log('No MAVLink device found on any serial port', 'error');
      btn.textContent = 'CONNECT';
      btn.disabled = false;
    }
  } catch (e) {
    log(`Auto-scan failed: ${e}`, 'error');
    btn.textContent = 'CONNECT';
    btn.disabled = false;
  }
}

function connectVehicle(connType, port, baud, host, portNum) {
  log(`Connecting: ${connType} ${port ? port + ' ' : ''}@ ${baud} baud...`, 'info');
  const btn = document.getElementById('connectBtn');
  btn.textContent = 'CONNECTING...';
  btn.disabled = true;
  socket.emit('connect_vehicle', {
    type: connType,
    port: port,
    baud: parseInt(baud),
    host: host || '',
    port_num: parseInt(portNum) || 0,
  });
}

function disconnectVehicle() {
  socket.emit('disconnect_vehicle');
  const btn = document.getElementById('connectBtn');
  btn.textContent = 'CONNECT';
  btn.className = '';
  btn.disabled = false;
}

function setMode() {
  const mode = document.getElementById('flightModeSelect').value;
  log(`Setting mode: ${mode}`, 'info');
  socket.emit('set_mode', { mode });
}

function arm() {
  log('ARM command sent', 'warning');
  socket.emit('arm');
}
function disarm() {
  log('DISARM command sent', 'info');
  socket.emit('disarm');
}
function command(cmd) {
  log(`Command: ${cmd}`, 'info');
  socket.emit('command', { command: cmd });
}

function showConnectionDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog-box" style="width:400px">
      <h3>Connect to Vehicle</h3>
      <div class="dialog-row">
        <label>Type:</label>
        <select id="connTypeSelect" style="flex:1;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:8px 12px;font-size:13px;outline:none;">
          <option value="serial">Serial Port</option>
          <option value="tcp_client">TCP Client</option>
          <option value="tcp_server">TCP Server</option>
          <option value="udp">UDP</option>
        </select>
      </div>
      <div id="serialFields">
        <div class="dialog-row">
          <label>Port:</label>
          <input type="text" id="dialPort" value="/dev/ttyACM0" />
        </div>
        <div class="dialog-row">
          <label>Baud:</label>
          <select id="dialBaud" style="flex:1;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:8px 12px;font-size:13px;outline:none;">
            <option>9600</option><option>19200</option><option>38400</option>
            <option selected>57600</option><option>115200</option><option>921600</option>
          </select>
        </div>
      </div>
      <div id="netFields" style="display:none">
        <div class="dialog-row">
          <label>Host:</label>
          <input type="text" id="dialHost" value="127.0.0.1" />
        </div>
        <div class="dialog-row">
          <label>Port:</label>
          <input type="text" id="dialPortNum" value="5760" />
        </div>
      </div>
      <div class="dialog-btns">
        <button class="secondary" onclick="this.closest('.dialog-overlay').remove()">Cancel</button>
        <button class="primary" onclick="connectFromDialog()">Connect</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const typeSelect = overlay.querySelector('#connTypeSelect');
  const serialFields = overlay.querySelector('#serialFields');
  const netFields = overlay.querySelector('#netFields');

  typeSelect.addEventListener('change', () => {
    const val = typeSelect.value;
    serialFields.style.display = val === 'serial' ? '' : 'none';
    netFields.style.display = val === 'serial' ? 'none' : '';
  });
}

function connectFromDialog() {
  const type = document.querySelector('#connTypeSelect').value;
  const port = document.querySelector('#dialPort')?.value || '';
  const baud = document.querySelector('#dialBaud')?.value || '57600';
  const host = document.querySelector('#dialHost')?.value || '';
  const portNum = document.querySelector('#dialPortNum')?.value || '0';

  connectVehicle(type, port, baud, host, portNum);
  document.querySelector('.dialog-overlay').remove();
}

function menuAction(action) {
  if (action === 'Exit') { window.close(); return; }
  if (action === 'About') {
    alert('SGC v0.1.0\nSkywin Ground Control Station\n\nA professional MAVLink GCS\nbuilt with Python, Flask & pymavlink.\n\nCompatible with ArduPilot and PX4.');
    return;
  }
  if (['TCP Client', 'TCP Server', 'UDP'].includes(action)) {
    showConnectionDialog();
    return;
  }
  if (action === 'Serial Port') {
    toggleConnection();
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
  if (!window.map) {
    initMap(data.lat || 37.7749, data.lon || -122.4194);
  }
  if (data.lat && data.lon && vehicleMarker) {
    const latlng = [data.lat, data.lon];
    vehicleMarker.setLatLng(latlng);
    if (data.connected) {
      map.setView(latlng, map.getZoom());
    }
    if (data.ground_speed > 0.1) {
      trail.push(latlng);
      if (trail.length > 500) trail.shift();
      if (window.trailLine) map.removeLayer(window.trailLine);
      window.trailLine = L.polyline(trail, {
        color: '#0ea5e9', weight: 2, opacity: 0.6
      }).addTo(map);
    }
  }
}

function initMap(lat, lon) {
  window.map = L.map('map', {
    center: [lat, lon], zoom: 16, zoomControl: true, attributionControl: false,
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
  }).addTo(window.map);

  const vehicleIcon = L.divIcon({
    className: 'vehicle-icon',
    html: `<div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:18px solid #0ea5e9;"></div>`,
    iconSize: [16, 18],
    iconAnchor: [8, 9],
  });

  vehicleMarker = L.marker([lat, lon], { icon: vehicleIcon }).addTo(window.map);
  vehicleCircle = L.circle([lat, lon], {
    radius: 3, color: '#0ea5e9', fillColor: '#0ea5e9',
    fillOpacity: 0.3, weight: 1,
  }).addTo(window.map);

  if (lat !== 37.7749 || lon !== -122.4194) {
    L.circleMarker([lat - 0.0007, lon - 0.0005], {
      radius: 5, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.8,
    }).addTo(window.map).bindTooltip('Home', { direction: 'top' });
  }
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

async function loadPorts() {
  try {
    const res = await fetch('/api/ports');
    const ports = await res.json();
    const sel = document.getElementById('portSelect');
    sel.innerHTML = '<option value="auto">Auto</option>';
    ports.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.device;
      opt.textContent = `${p.device}  (${p.description})`;
      sel.appendChild(opt);
    });
  } catch (e) {
    console.warn('Could not load serial ports', e);
  }
}

loadPorts();
