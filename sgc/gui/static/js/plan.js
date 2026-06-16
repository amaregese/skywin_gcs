const socket = io();
let waypoints = [];
let wpMarkers = [];
let wpLine = null;
let homePos = null;
let homeMarker = null;
let homeLine = null;
let map = null;
let vehicleMarker = null;
let isConnected = false;
let selectedWp = -1;
let mapInitialized = false;
let autoDownloaded = false;


const CMD_NAMES = {
  16: 'Waypoint', 17: 'Loiter', 18: 'Loiter_Turns', 19: 'Loiter_Time',
  20: 'Return_to_Launch', 21: 'Land', 22: 'Takeoff', 24: 'Spline_WP',
  25: 'Spline_Speed', 28: 'Guided', 30: 'Set_HOME', 31: 'Stop',
  33: 'Channel', 34: 'Delay', 112: 'Set_Home',
  115: 'Jump', 177: 'Do_Set_Servo', 178: 'Do_Set_Relay',
  183: 'Do_Gripper', 191: 'Do_Sprayer', 192: 'Do_Landing_Abort',
};

// --- Socket Events ---
socket.on('connect', () => {});
socket.on('state_update', (data) => {
  isConnected = data.connected;
  if (!data.connected) {
    waypoints = [];
    homePos = null;
    renderWaypoints();
    updateMarkers();
    autoDownloaded = false;

  }
  if (data.lat && data.lon && vehicleMarker) {
    vehicleMarker.setLatLng([data.lat, data.lon]);
    homePos = { lat: data.lat, lon: data.lon };
    if (!mapInitialized) {
      map.setView([data.lat, data.lon], 16);
      mapInitialized = true;
    }
  }
  if (!autoDownloaded && data.connected && waypoints.length === 0) {
    socket.emit('request_mission');
    autoDownloaded = true;
  }

});
socket.on('mission_data', (data) => {
  waypoints = data.waypoints || [];
  renderWaypoints();
  updateMarkers();
  document.getElementById('planStatus').textContent = `Downloaded ${data.count} waypoints from FCU.`;
});
socket.on('mission_upload_complete', (data) => {
  document.getElementById('planStatus').textContent =
    data.success ? `Upload complete — ${data.result}` : `Upload failed — ${data.result}`;
});


// --- Map ---
function initMap(lat, lon) {
  map = L.map('map', { center: [lat, lon], zoom: 16, zoomControl: true, attributionControl: false });

  var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
  var sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' });
  var topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '&copy; OpenTopoMap' });
  var dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '&copy; CARTO' });

  sat.addTo(map);

  vehicleMarker = L.marker([lat, lon], {
    icon: L.divIcon({
      className: 'vehicle-icon',
      html: `<div class="vehicle-arrow" style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:20px solid #0ea5e9;filter:drop-shadow(0 0 4px rgba(14,165,233,0.6));"></div>`,
      iconSize: [14, 20], iconAnchor: [7, 10],
    }), zIndexOffset: 1000,
  }).addTo(map);

  var gridLayer = addGrid(map);

  L.control.layers({
    'Street': osm,
    'Satellite': sat,
    'Topo': topo,
    'Dark': dark,
  }, {
    'Grid': gridLayer,
  }, { position: 'topright' }).addTo(map);

  map.on('click', (e) => {
    if (e.originalEvent.target.closest('.leaflet-control') || e.originalEvent.target.closest('.context-menu')) return;
    addWaypoint(e.latlng.lat, e.latlng.lng, 50);
  });

  map.on('contextmenu', (e) => {
    const menu = document.getElementById('mapContextMenu');
    if (!menu) return;
    menu.style.left = `${e.originalEvent.clientX}px`;
    menu.style.top = `${e.originalEvent.clientY}px`;
    menu.dataset.lat = e.latlng.lat.toFixed(7);
    menu.dataset.lon = e.latlng.lng.toFixed(7);
    var ctxNum = document.getElementById('ctxInsertNum');
    if (ctxNum) ctxNum.textContent = selectedWp >= 0 ? selectedWp + 1 : waypoints.length + 1;
    menu.classList.remove('hidden');
  });

  setTimeout(() => { try { map.invalidateSize(); } catch {} }, 200);
}

document.addEventListener('click', () => {
  const menu = document.getElementById('mapContextMenu');
  if (menu) menu.classList.add('hidden');
  closePlanDropdown();
});

function togglePlanDropdown(e) {
  e.stopPropagation();
  var dd = document.getElementById('planDropdown');
  dd.classList.toggle('hidden');
}

function closePlanDropdown() {
  var dd = document.getElementById('planDropdown');
  if (dd) dd.classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
  initMap(37.7749, -122.4194);
});

// --- Waypoints ---
function addWaypoint(lat, lon, alt, cmd) {
  const idx = waypoints.length;
  waypoints.push({
    seq: idx, x: lat, y: lon, z: alt || 50,
    command: cmd || 16, frame: 3,
    param1: 0, param2: 0, param3: 0, param4: 0,
  });
  updateMarkers();
  renderWaypoints();
  updateStatus();
}

function addWaypointFromMenu() {
  const menu = document.getElementById('mapContextMenu');
  const lat = parseFloat(menu.dataset.lat);
  const lon = parseFloat(menu.dataset.lon);
  menu.classList.add('hidden');
  const alt = prompt('Altitude (m):', '50');
  if (alt === null) return;
  addWaypoint(lat, lon, parseFloat(alt) || 50);
}

function addMarker(idx) {
  const wp = waypoints[idx];
  if (!wp) return;
  var isSel = idx === selectedWp;
  var bg = isSel ? '#0ea5e9' : '#7c3aed';
  var border = isSel ? '#fff' : '#fff';
  var shadow = isSel ? 'rgba(14,165,233,0.7)' : 'rgba(124,58,237,0.5)';
  const marker = L.marker([wp.x, wp.y], {
    draggable: true,
    icon: L.divIcon({
      className: 'wp-marker',
      html: `<div style="width:22px;height:22px;background:${bg};border:2px solid ${border};border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;box-shadow:0 0 8px ${shadow};">${idx + 1}</div>`,
      iconSize: [22, 22], iconAnchor: [11, 11],
    }),
  }).addTo(map);
  marker.on('dragend', () => {
    const pos = marker.getLatLng();
    waypoints[idx].x = pos.lat;
    waypoints[idx].y = pos.lng;
    renderWaypoints();
  });
  marker.on('click', () => {
    selectedWp = idx;
    updateMarkers();
    renderWaypoints();
  });
  wpMarkers.push(marker);
}

function updateMarkers() {
  if (!map) return;
  wpMarkers.forEach(m => map.removeLayer(m));
  wpMarkers = [];
  if (wpLine) { map.removeLayer(wpLine); wpLine = null; }
  if (homeLine) { map.removeLayer(homeLine); homeLine = null; }
  if (homeMarker) { map.removeLayer(homeMarker); homeMarker = null; }
  waypoints.forEach((_, i) => addMarker(i));
  if (waypoints.length > 0) {
    var pts = waypoints.map(wp => [wp.x, wp.y]);
    wpLine = L.polyline(pts, {color: '#7c3aed', weight: 2, opacity: 0.5, dashArray: '6,4', interactive: false}).addTo(map);
    if (homePos) {
      homeMarker = L.marker([homePos.lat, homePos.lon], {
        icon: L.divIcon({
          className: 'home-marker',
          html: '<div style="width:24px;height:24px;background:#22c55e;border:2px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700;box-shadow:0 0 8px rgba(34,197,94,0.5);">H</div>',
          iconSize: [24, 24], iconAnchor: [12, 12],
        }), interactive: false,
      }).addTo(map);
      homeLine = L.polyline([[homePos.lat, homePos.lon], [pts[0][0], pts[0][1]]], {
        color: '#22c55e', weight: 2, opacity: 0.4, dashArray: '4,4', interactive: false,
      }).addTo(map);
    }
    var bounds = wpMarkers.map(m => m.getLatLng());
    map.fitBounds(bounds, { padding: [50, 50] });
  }
}

function removeWaypoint(idx) {
  waypoints.splice(idx, 1);
  waypoints.forEach((wp, i) => wp.seq = i);
  updateMarkers();
  renderWaypoints();
  updateStatus();
}

var WP_ORDER = Object.entries(CMD_NAMES).sort(function(a,b){return a[0]-b[0]});

function renderWaypoints() {
  const tbody = document.getElementById('wpList');
  tbody.innerHTML = '';
  waypoints.forEach((wp, i) => {
    const tr = document.createElement('tr');
    if (i === selectedWp) tr.className = 'active';
    var cmdOpts = WP_ORDER.map(function(e) {
      return '<option value="' + e[0] + '"' + (wp.command == e[0] ? ' selected' : '') + '>' + e[1] + '</option>';
    }).join('');
    var editing = selectedWp === i;
    var latStr = wp.x.toFixed(6);
    var lonStr = wp.y.toFixed(6);
    var altStr = wp.z.toFixed(1);
    tr.innerHTML = `
      <td class="wp-num">${i + 1}</td>
      <td>
        <select onchange="updateWp(${i},'command',parseInt(this.value))">${cmdOpts}</select>
      </td>
      <td>${editing ? '<input type="text" value="' + latStr + '" onchange="updateWp(' + i + ',\'x\',parseFloat(this.value)||0)" class="wp-edit">' : '<span class="wp-cell" ondblclick="editWp(' + i + ')">' + latStr + '</span>'}</td>
      <td>${editing ? '<input type="text" value="' + lonStr + '" onchange="updateWp(' + i + ',\'y\',parseFloat(this.value)||0)" class="wp-edit">' : '<span class="wp-cell" ondblclick="editWp(' + i + ')">' + lonStr + '</span>'}</td>
      <td>${editing ? '<input type="text" value="' + altStr + '" onchange="updateWp(' + i + ',\'z\',parseFloat(this.value)||0)" class="wp-edit" style="width:50px">' : '<span class="wp-cell" ondblclick="editWp(' + i + ')">' + altStr + '</span>'}</td>
      <td style="text-align:center">
        <span class="delete-wp" onclick="removeWaypoint(${i})">&#x2716;</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function updateWp(idx, field, value) {
  if (idx >= waypoints.length) return;
  waypoints[idx][field] = value;
  updateMarkers();
  updateStatus();
}

function updateStatus() {
  document.getElementById('planStatus').textContent =
    waypoints.length > 0
      ? `${waypoints.length} waypoint(s) — distance: ${totalDistance().toFixed(1)}m`
      : 'No waypoints. Click the map to add.';
}

function totalDistance() {
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1], b = waypoints[i];
    total += dist(a.x, a.y, b.x, b.y);
  }
  return total;
}

function dist(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function editWp(idx) {
  selectedWp = idx;
  renderWaypoints();
}

function reverseMission() {
  if (waypoints.length < 2) { alert('Need at least 2 waypoints to reverse.'); return; }
  waypoints.reverse();
  waypoints.forEach((wp, i) => wp.seq = i);
  selectedWp = -1;
  updateMarkers();
  renderWaypoints();
  updateStatus();
  document.getElementById('planStatus').textContent = 'Mission reversed.';
}


function setAllAltitudes() {
  if (waypoints.length === 0) { alert('No waypoints to adjust.'); return; }
  const alt = prompt('Set all waypoint altitudes to (m):', waypoints[0].z.toFixed(1));
  if (alt === null) return;
  const val = parseFloat(alt);
  if (isNaN(val)) return;
  waypoints.forEach(function(wp) { wp.z = val; });
  updateMarkers();
  renderWaypoints();
  updateStatus();
  document.getElementById('planStatus').textContent = `All altitudes set to ${val.toFixed(1)}m.`;
}

// --- Actions ---

// --- Mission Commands ---
function uploadMission() {
  if (waypoints.length === 0) {
    alert('No waypoints to upload.');
    return;
  }
  if (!isConnected) {
    alert('Not connected to a vehicle.');
    return;
  }
  document.getElementById('planStatus').textContent = `Uploading ${waypoints.length} waypoints...`;
  socket.emit('mission_upload', { waypoints });
}

function downloadMission() {
  if (!isConnected) {
    alert('Not connected to a vehicle.');
    return;
  }
  document.getElementById('planStatus').textContent = 'Downloading mission from FCU...';
  socket.emit('mission_download');
}

function clearMission() {
  if (waypoints.length > 0 && !confirm('Clear all waypoints?')) return;
  waypoints = [];
  updateMarkers();
  renderWaypoints();
  updateStatus();
}

function startMission() {
  if (!isConnected) {
    alert('Not connected.');
    return;
  }
  socket.emit('set_mode', { mode: 'AUTO' });
  document.getElementById('planStatus').textContent = 'Mode set to AUTO — mission started.';
}

// --- File Save/Load ---
function saveMissionFile() {
  const lines = ['QGC WPL 110'];
  waypoints.forEach((wp, i) => {
    lines.push(`${i}\t0\t${wp.frame || 3}\t${wp.command || 16}\t${wp.param1 || 0}\t${wp.param2 || 0}\t${wp.param3 || 0}\t${wp.param4 || 0}\t${(wp.x || 0).toFixed(7)}\t${(wp.y || 0).toFixed(7)}\t${(wp.z || 0).toFixed(1)}\t1`);
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mission.waypoints';
  a.click();
  URL.revokeObjectURL(a.href);
}

function loadMissionFile() {
  document.getElementById('missionFileInput').click();
}

document.getElementById('missionFileInput').onchange = function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result;
    const lines = text.split('\n').filter(l => l.trim());
    const newWps = [];
    for (const line of lines) {
      if (line.startsWith('QGC WPL')) continue;
      const parts = line.split('\t');
      if (parts.length < 12) continue;
      newWps.push({
        seq: parseInt(parts[0]) || 0,
        frame: parseInt(parts[2]) || 3,
        command: parseInt(parts[3]) || 16,
        param1: parseFloat(parts[4]) || 0,
        param2: parseFloat(parts[5]) || 0,
        param3: parseFloat(parts[6]) || 0,
        param4: parseFloat(parts[7]) || 0,
        x: parseFloat(parts[8]) || 0,
        y: parseFloat(parts[9]) || 0,
        z: parseFloat(parts[10]) || 0,
      });
    }
    if (newWps.length > 0) {
      waypoints = newWps;
      updateMarkers();
      renderWaypoints();
      updateStatus();
      document.getElementById('planStatus').textContent = `Loaded ${newWps.length} waypoints from file.`;
    }
  };
  reader.readAsText(file);
  e.target.value = '';
};


