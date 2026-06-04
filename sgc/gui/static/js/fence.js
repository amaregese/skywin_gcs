const socket = io();
let fencePoints = [];
let fencePolygon = null;
let fenceVertexMarkers = [];
let map = null;
let vehicleMarker = null;
let isConnected = false;
let wpGroup = null;
let wpOverlayPoints = [];

// --- Socket Events ---
socket.on('connect', () => {});
let mapInitialized = false;

socket.on('state_update', (data) => {
  isConnected = data.connected;
  const btn = document.getElementById('connectBtn');
  if (data.connected) {
    btn.textContent = 'DISCONNECT';
    btn.className = 'connected';
    document.getElementById('statusMessage').textContent = 'Connected';
    if (!window._reqFence) {
      window._reqFence = true;
      socket.emit('request_fence');
    }
    if (!window._reqMissionFence) {
      window._reqMissionFence = true;
      socket.emit('request_mission');
    }
  } else {
    btn.textContent = 'CONNECT';
    btn.className = '';
    document.getElementById('statusMessage').textContent = 'Not connected';
    window._reqFence = false;
    window._reqMissionFence = false;
    fencePoints = [];
    wpOverlayPoints = [];
    _homePos = null;
    if (wpGroup) wpGroup.clearLayers();
    renderFence();
  }
  if (data.lat && data.lon && vehicleMarker) {
    vehicleMarker.setLatLng([data.lat, data.lon]);
    _homePos = { lat: data.lat, lon: data.lon };
    if (!mapInitialized) {
      map.setView([data.lat, data.lon], 16);
      mapInitialized = true;
    }
  }
});
socket.on('fence_data', (data) => {
  fencePoints = (data.points || []).map(function(p) { return { lat: p[0], lon: p[1] }; });
  renderFence();
  document.getElementById('fenceStatus').textContent = fencePoints.length + ' fence point(s) loaded from FCU.';
});

socket.on('fence_upload_complete', (data) => {
  if (data.success) {
    document.getElementById('fenceStatus').textContent = 'Uploaded ' + data.count + ' fence points to FCU.';
  } else {
    document.getElementById('fenceStatus').textContent = 'Fence upload failed.';
  }
});

socket.on('mission_data', (data) => {
  wpOverlayPoints = data.waypoints || [];
  drawWaypointsOverlay();
});

// --- Map ---
function initMap(lat, lon) {
  map = L.map('map', { center: [lat, lon], zoom: 16, zoomControl: true, attributionControl: false });

  var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
  var sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' });
  var topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '&copy; OpenTopoMap' });
  var dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '&copy; CARTO' });

  osm.addTo(map);

  var gridLayer = addGrid(map);

  vehicleMarker = L.marker([lat, lon], {
    icon: L.divIcon({
      className: 'vehicle-icon',
      html: `<div class="vehicle-arrow" style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:20px solid #0ea5e9;filter:drop-shadow(0 0 4px rgba(14,165,233,0.6));"></div>`,
      iconSize: [14, 20], iconAnchor: [7, 10],
    }), zIndexOffset: 1000,
  }).addTo(map);

  wpGroup = L.layerGroup().addTo(map);

  L.control.layers({
    'Street': osm,
    'Satellite': sat,
    'Topo': topo,
    'Dark': dark,
  }, {
    'Grid': gridLayer,
    'Waypoints': wpGroup,
  }, { position: 'topright' }).addTo(map);

  map.on('click', function(e) {
    addFencePoint(e.latlng.lat, e.latlng.lng);
  });

  map.on('contextmenu', (e) => {
    const menu = document.getElementById('mapContextMenu');
    if (!menu) return;
    menu.style.left = `${e.originalEvent.clientX}px`;
    menu.style.top = `${e.originalEvent.clientY}px`;
    menu.dataset.lat = e.latlng.lat.toFixed(7);
    menu.dataset.lon = e.latlng.lng.toFixed(7);
    menu.classList.remove('hidden');
  });

  setTimeout(() => { try { map.invalidateSize(); } catch {} }, 200);
}

document.addEventListener('click', () => {
  const menu = document.getElementById('mapContextMenu');
  if (menu) menu.classList.add('hidden');
});

document.addEventListener('DOMContentLoaded', () => {
  initMap(37.7749, -122.4194);
});

// --- Fence ---
function downloadFence() {
  if (!isConnected) { alert('Not connected.'); return; }
  document.getElementById('fenceStatus').textContent = 'Downloading fence...';
  socket.emit('fence_download');
}

function uploadFence() {
  if (!isConnected) { alert('Not connected.'); return; }
  if (fencePoints.length < 3) { alert('Need at least 3 fence points.'); return; }
  var pts = fencePoints.map(function(p) { return { lat: p.lat, lon: p.lon }; });
  socket.emit('fence_upload', { points: pts });
  document.getElementById('fenceStatus').textContent = 'Uploading ' + pts.length + ' fence points and enabling...';
}

function clearFence() {
  if (fencePoints.length > 0 && !confirm('Clear all fence points?')) return;
  fencePoints = [];
  socket.emit('fence_clear');
  socket.emit('fence_enable', { enable: false });
  renderFence();
  document.getElementById('fenceStatus').textContent = 'Fence cleared.';
}

function renderFence() {
  if (fencePolygon) { map.removeLayer(fencePolygon); fencePolygon = null; }
  fenceVertexMarkers.forEach(function(m) { map.removeLayer(m); });
  fenceVertexMarkers = [];

  if (fencePoints.length >= 3) {
    var latlngs = fencePoints.map(function(p) { return [p.lat, p.lon]; });
    fencePolygon = L.polygon(latlngs, {
      color: '#eab308', weight: 2, fillColor: '#eab308', fillOpacity: 0.15,
    }).addTo(map);
  } else if (fencePoints.length === 2) {
    var latlngs = fencePoints.map(function(p) { return [p.lat, p.lon]; });
    fencePolygon = L.polyline(latlngs, {
      color: '#eab308', weight: 2, dashArray: '6,4',
    }).addTo(map);
  }

  fencePoints.forEach(function(p, i) {
    var marker = L.marker([p.lat, p.lon], {
      draggable: true,
      icon: L.divIcon({
        className: 'fence-vertex',
        html: '<div style="width:12px;height:12px;background:#eab308;border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(234,179,8,0.6);"></div>',
        iconSize: [12, 12], iconAnchor: [6, 6],
      }),
    }).addTo(map);
    marker.on('dragend', function() {
      var pos = marker.getLatLng();
      fencePoints[i] = { lat: pos.lat, lon: pos.lng };
      renderFence();
    });
    marker.on('dblclick', function() {
      fencePoints.splice(i, 1);
      renderFence();
    });
    fenceVertexMarkers.push(marker);
  });

  renderFenceTable();
}

function renderFenceTable() {
  var tbody = document.getElementById('fenceList');
  if (!tbody) return;
  tbody.innerHTML = '';
  fencePoints.forEach(function(p, i) {
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="wp-num">' + (i + 1) + '</td>' +
      '<td><input type="text" value="' + p.lat.toFixed(7) + '" onchange="updateFencePoint(' + i + ',\'lat\',this.value)"></td>' +
      '<td><input type="text" value="' + p.lon.toFixed(7) + '" onchange="updateFencePoint(' + i + ',\'lon\',this.value)"></td>' +
      '<td class="delete-wp" onclick="removeFencePoint(' + i + ')">&#x2716;</td>';
    tbody.appendChild(tr);
  });
}

function updateFencePoint(idx, field, val) {
  var n = parseFloat(val);
  if (isNaN(n)) return;
  fencePoints[idx][field] = n;
  renderFence();
}

function removeFencePoint(idx) {
  fencePoints.splice(idx, 1);
  renderFence();
}

function addFencePoint(lat, lon) {
  fencePoints.push({ lat: lat, lon: lon });
  renderFence();
  document.getElementById('fenceStatus').textContent = fencePoints.length + ' fence point(s).';
}

function addFencePointFromMenu() {
  var menu = document.getElementById('mapContextMenu');
  var lat = parseFloat(menu.dataset.lat);
  var lon = parseFloat(menu.dataset.lon);
  menu.classList.add('hidden');
  addFencePoint(lat, lon);
}

function drawWaypointsOverlay() {
  if (!wpGroup) return;
  wpGroup.clearLayers();
  var pts = [];
  wpOverlayPoints.forEach(function(wp, i) {
    if (!wp.x || !wp.y) return;
    var latlng = [wp.x, wp.y];
    pts.push(latlng);
    var marker = L.marker(latlng, {
      icon: L.divIcon({
        className: 'wp-marker-overlay',
        html: '<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;background:rgba(14,165,233,0.8);color:#fff;border:2px solid #fff;border-radius:50%;font-size:10px;font-weight:bold;box-shadow:0 0 6px rgba(0,0,0,0.4);">' + (i + 1) + '</span>',
        iconSize: [20, 20], iconAnchor: [10, 10],
      }),
      interactive: false,
    });
    wpGroup.addLayer(marker);
  });
  if (pts.length >= 1) {
    wpGroup.addLayer(L.polyline(pts, {
      color: '#0ea5e9', weight: 2, opacity: 0.5, dashArray: '6,4', interactive: false,
    }));
  }
  if (_homePos && pts.length > 0) {
    wpGroup.addLayer(L.marker([_homePos.lat, _homePos.lon], {
      icon: L.divIcon({
        className: 'home-marker-overlay',
        html: '<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:#22c55e;color:#fff;border:2px solid #fff;border-radius:50%;font-size:12px;font-weight:bold;box-shadow:0 0 8px rgba(34,197,94,0.5);">H</span>',
        iconSize: [24, 24], iconAnchor: [12, 12],
      }),
      interactive: false,
    }));
    wpGroup.addLayer(L.polyline([[_homePos.lat, _homePos.lon], pts[0]], {
      color: '#22c55e', weight: 2, opacity: 0.4, dashArray: '4,4', interactive: false,
    }));
  }
}

// --- File Save/Load ---
function saveFenceFile() {
  var lines = ['# SGC Geo-Fence'];
  lines.push('# Format: lat lon');
  fencePoints.forEach(function(p) {
    lines.push(p.lat.toFixed(7) + '\t' + p.lon.toFixed(7));
  });
  var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'geofence.fence';
  a.click();
  URL.revokeObjectURL(a.href);
}

function loadFenceFile() {
  document.getElementById('fenceFileInput').click();
}

document.getElementById('fenceFileInput').onchange = function(e) {
  var file = e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(ev) {
    var text = ev.target.result;
    var lines = text.split('\n').filter(function(l) { return l.trim(); });
    var newPts = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.startsWith('#')) continue;
      var parts = line.split('\t');
      if (parts.length < 2) parts = line.split(/\s+/);
      if (parts.length < 2) continue;
      var lat = parseFloat(parts[0]);
      var lon = parseFloat(parts[1]);
      if (isNaN(lat) || isNaN(lon)) continue;
      newPts.push({ lat: lat, lon: lon });
    }
    if (newPts.length > 0) {
      fencePoints = newPts;
      renderFence();
      document.getElementById('fenceStatus').textContent = 'Loaded ' + newPts.length + ' fence points from file.';
    }
  };
  reader.readAsText(file);
  e.target.value = '';
};

// --- Connection Helpers ---
function toggleConnection() {
  var btn = document.getElementById('connectBtn');
  if (btn && btn.classList.contains('connected')) {
    socket.emit('disconnect_vehicle');
  } else {
    showConnectDialog();
  }
}

function disconnectVehicle() {
  socket.emit('disconnect_vehicle');
}

function toggleTlog() {
  var btn = document.getElementById('tlogBtn');
  if (!btn) return;
  if (btn.classList.contains('active')) { socket.emit('stop_tlog'); }
  else { socket.emit('start_tlog'); }
}
