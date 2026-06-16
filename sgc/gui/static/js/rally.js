var socket;
try { socket = io(); } catch (_e) { console.warn('Socket.IO CDN blocked'); }

var rallyPoints = [];
var rallyMarkers = [];
var rallyPolygon = null;
var rallyGroup = null;
var map = null;
var vehicleMarker = null;
var isConnected = false;
var mapInitialized = false;
var homePos = null;
var wpGroup = null;

if (socket) {
  socket.on('state_update', function(data) {
    isConnected = data.connected;
    if (data.connected) {
      if (!window._reqRally) {
        window._reqRally = true;
        socket.emit('request_rally');
      }
    } else {
      window._reqRally = false;
      rallyPoints = [];
      homePos = null;
      renderRally();
    }
    if (data.lat && data.lon && vehicleMarker) {
      vehicleMarker.setLatLng([data.lat, data.lon]);
      homePos = { lat: data.lat, lon: data.lon };
      if (!mapInitialized) {
        map.setView([data.lat, data.lon], 16);
        mapInitialized = true;
      }
    }
  });

  socket.on('rally_data', function(data) {
    rallyPoints = (data.points || []).map(function(p) { return { lat: p[0], lon: p[1], alt: p[2] || 100 }; });
    renderRally();
    document.getElementById('rallyStatus').textContent = rallyPoints.length + ' rally point(s) loaded from FCU.';
  });

  socket.on('rally_upload_complete', function(data) {
    document.getElementById('rallyStatus').textContent =
      data.success ? 'Uploaded ' + data.count + ' rally points to FCU.' : 'Rally upload failed.';
  });
}

function initMap(lat, lon) {
  map = L.map('map', { center: [lat, lon], zoom: 16, zoomControl: true, attributionControl: false });

  var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
  var sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' });
  var topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '&copy; OpenTopoMap' });
  var dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '&copy; CARTO' });

  sat.addTo(map);

  rallyGroup = L.layerGroup().addTo(map);

  vehicleMarker = L.marker([lat, lon], {
    icon: L.divIcon({
      className: 'vehicle-icon',
      html: '<div class="vehicle-arrow" style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:20px solid #0ea5e9;filter:drop-shadow(0 0 4px rgba(14,165,233,0.6));"></div>',
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
    'Rally Points': rallyGroup,
  }, { position: 'topright' }).addTo(map);

  map.on('click', function(e) {
    if (e.originalEvent.target.closest('.leaflet-control') || e.originalEvent.target.closest('.context-menu')) return;
    addRallyPoint(e.latlng.lat, e.latlng.lng, 100);
  });

  map.on('contextmenu', function(e) {
    var menu = document.getElementById('mapContextMenu');
    if (!menu) return;
    menu.style.left = e.originalEvent.clientX + 'px';
    menu.style.top = e.originalEvent.clientY + 'px';
    menu.dataset.lat = e.latlng.lat.toFixed(7);
    menu.dataset.lon = e.latlng.lng.toFixed(7);
    menu.classList.remove('hidden');
  });

  setTimeout(function() { try { map.invalidateSize(); } catch(_e) {} }, 200);
}

document.addEventListener('click', function() {
  var menu = document.getElementById('mapContextMenu');
  if (menu) menu.classList.add('hidden');
  closeRallyDropdown();
});

document.addEventListener('DOMContentLoaded', function() {
  initMap(37.7749, -122.4194);
});

function toggleRallyDropdown(e) {
  e.stopPropagation();
  var dd = document.getElementById('rallyDropdown');
  dd.classList.toggle('hidden');
}

function closeRallyDropdown() {
  var dd = document.getElementById('rallyDropdown');
  if (dd) dd.classList.add('hidden');
}

function downloadRally() {
  if (!isConnected) { alert('Not connected.'); return; }
  document.getElementById('rallyStatus').textContent = 'Downloading rally points...';
  socket.emit('rally_download');
}

function uploadRally() {
  if (!isConnected) { alert('Not connected.'); return; }
  if (rallyPoints.length === 0) { alert('No rally points to upload.'); return; }
  var pts = rallyPoints.map(function(p) { return { lat: p.lat, lon: p.lon, alt: p.alt || 100 }; });
  socket.emit('rally_upload', { points: pts });
  document.getElementById('rallyStatus').textContent = 'Uploading ' + pts.length + ' rally points...';
}

function clearRally() {
  if (rallyPoints.length > 0 && !confirm('Clear all rally points?')) return;
  rallyPoints = [];
  socket.emit('rally_clear');
  renderRally();
  document.getElementById('rallyStatus').textContent = 'Rally points cleared.';
}

function renderRally() {
  if (rallyPolygon) { map.removeLayer(rallyPolygon); rallyPolygon = null; }
  rallyMarkers.forEach(function(m) { map.removeLayer(m); });
  rallyMarkers = [];

  if (rallyPoints.length >= 2) {
    var latlngs = rallyPoints.map(function(p) { return [p.lat, p.lon]; });
    rallyPolygon = L.polyline(latlngs, {
      color: '#22c55e', weight: 2, dashArray: '6,4', opacity: 0.6,
    }).addTo(map);
  }

  rallyPoints.forEach(function(p, i) {
    var marker = L.marker([p.lat, p.lon], {
      draggable: true,
      icon: L.divIcon({
        className: 'rally-vertex',
        html: '<div style="width:20px;height:20px;background:#22c55e;border:2px solid #fff;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#0f172a;font-size:10px;font-weight:800;box-shadow:0 0 8px rgba(34,197,94,0.6);">R' + (i + 1) + '</div>',
        iconSize: [20, 20], iconAnchor: [10, 10],
      }),
    }).addTo(map);
    marker.on('dragend', function() {
      var pos = marker.getLatLng();
      rallyPoints[i] = { lat: pos.lat, lon: pos.lng, alt: rallyPoints[i].alt || 100 };
      renderRally();
    });
    marker.on('dblclick', function() {
      rallyPoints.splice(i, 1);
      renderRally();
    });
    rallyMarkers.push(marker);
  });

  if (homePos && !mapInitialized) {
    map.setView([homePos.lat, homePos.lon], 16);
    mapInitialized = true;
  }

  renderRallyTable();
}

function renderRallyTable() {
  var tbody = document.getElementById('rallyList');
  if (!tbody) return;
  tbody.innerHTML = '';
  rallyPoints.forEach(function(p, i) {
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="wp-num">' + (i + 1) + '</td>' +
      '<td><input type="text" value="' + p.lat.toFixed(7) + '" onchange="updateRallyPoint(' + i + ',\'lat\',this.value)"></td>' +
      '<td><input type="text" value="' + p.lon.toFixed(7) + '" onchange="updateRallyPoint(' + i + ',\'lon\',this.value)"></td>' +
      '<td><input type="text" value="' + (p.alt || 100).toFixed(1) + '" onchange="updateRallyPoint(' + i + ',\'alt\',this.value)"></td>' +
      '<td class="delete-wp" onclick="removeRallyPoint(' + i + ')">&#x2716;</td>';
    tbody.appendChild(tr);
  });
}

function updateRallyPoint(idx, field, val) {
  var n = parseFloat(val);
  if (isNaN(n)) return;
  rallyPoints[idx][field] = n;
  renderRally();
}

function removeRallyPoint(idx) {
  rallyPoints.splice(idx, 1);
  renderRally();
}

function addRallyPoint(lat, lon, alt) {
  rallyPoints.push({ lat: lat, lon: lon, alt: alt || 100 });
  renderRally();
  document.getElementById('rallyStatus').textContent = rallyPoints.length + ' rally point(s).';
}

function addRallyPointFromMenu() {
  var menu = document.getElementById('mapContextMenu');
  var lat = parseFloat(menu.dataset.lat);
  var lon = parseFloat(menu.dataset.lon);
  menu.classList.add('hidden');
  var alt = prompt('Altitude (m):', '100');
  if (alt === null) return;
  addRallyPoint(lat, lon, parseFloat(alt) || 100);
}

function saveRallyFile() {
  var lines = ['# SGC Rally Points'];
  lines.push('# Format: lat\tlon\talt');
  rallyPoints.forEach(function(p) {
    lines.push(p.lat.toFixed(7) + '\t' + p.lon.toFixed(7) + '\t' + (p.alt || 100).toFixed(1));
  });
  var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'rally_points.rally';
  a.click();
  URL.revokeObjectURL(a.href);
}

function loadRallyFile() {
  document.getElementById('rallyFileInput').click();
}

document.getElementById('rallyFileInput').onchange = function(e) {
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
      var alt = parts.length >= 3 ? parseFloat(parts[2]) : 100;
      if (isNaN(lat) || isNaN(lon)) continue;
      newPts.push({ lat: lat, lon: lon, alt: isNaN(alt) ? 100 : alt });
    }
    if (newPts.length > 0) {
      rallyPoints = newPts;
      renderRally();
      document.getElementById('rallyStatus').textContent = 'Loaded ' + newPts.length + ' rally points from file.';
    }
  };
  reader.readAsText(file);
  e.target.value = '';
};

function toggleTlog() {
  if (!socket) return;
  var btn = document.getElementById('tlogBtn');
  if (!btn) return;
  if (btn.classList.contains('active')) { socket.emit('stop_tlog'); }
  else { socket.emit('start_tlog'); }
}
