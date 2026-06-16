const socket = io();
let map = null;
let vehicleMarker = null;
let isConnected = false;
let mapInitialized = false;
let waypoints = [];
let wpMarkers = [];
let wpPolyline = null;

let polygonPoints = [];
let polygonLayer = null;
let polygonVertexMarkers = [];
let isDrawingPolygon = false;

socket.on('state_update', function(data) {
  isConnected = data.connected;
  if (data.lat && data.lon && vehicleMarker) {
    vehicleMarker.setLatLng([data.lat, data.lon]);
    if (!mapInitialized) { map.setView([data.lat, data.lon], 16); mapInitialized = true; }
  }
});

socket.on('mission_upload_complete', function(data) {
  document.getElementById('surveyStatus').textContent =
    data.success ? 'Upload complete (' + data.result + ').' : 'Upload failed (' + data.result + ').';
});

function initMap(lat, lon) {
  map = L.map('map', { center: [lat, lon], zoom: 16, zoomControl: true, attributionControl: false });

  var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' });
  var sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri' });
  var topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '&copy; OpenTopoMap' });
  var dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '&copy; CARTO' });

  sat.addTo(map);

  vehicleMarker = L.marker([lat, lon], {
    icon: L.divIcon({
      className: 'vehicle-icon',
      html: '<div class="vehicle-arrow" style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:20px solid #0ea5e9;filter:drop-shadow(0 0 4px rgba(14,165,233,0.6));"></div>',
      iconSize: [14, 20], iconAnchor: [7, 10],
    }), zIndexOffset: 1000,
  }).addTo(map);

  var gridLayer = addGrid(map);

  L.control.layers({
    'Street': osm, 'Satellite': sat, 'Topo': topo, 'Dark': dark,
  }, { 'Grid': gridLayer }, { position: 'topright' }).addTo(map);

  map.on('click', function(e) {
    if (e.originalEvent.target.closest('.leaflet-control') || e.originalEvent.target.closest('.context-menu')) return;
    if (isDrawingPolygon) { addPolygonVertex(e.latlng.lat, e.latlng.lng); }
  });

  map.on('contextmenu', function(e) {
    var menu = document.getElementById('mapContextMenu');
    if (!menu) return;
    document.getElementById('ctxFinishPolygon').classList.toggle('hidden', !isDrawingPolygon);
    document.getElementById('ctxClearPolygon').classList.toggle('hidden', polygonPoints.length === 0);
    menu.style.left = e.originalEvent.clientX + 'px';
    menu.style.top = e.originalEvent.clientY + 'px';
    menu.classList.remove('hidden');
  });

  setTimeout(function() { try { map.invalidateSize(); } catch(e) {} }, 200);
}

document.addEventListener('click', function() {
  var menu = document.getElementById('mapContextMenu');
  if (menu) menu.classList.add('hidden');
});

document.addEventListener('DOMContentLoaded', function() {
  initMap(37.7749, -122.4194);
  setTimeout(function() {
    startDrawPolygon();
  }, 500);
});

function toggleSurveyDropdown(e) {
  e.stopPropagation();
  var menu = document.getElementById('surveyDropdown');
  menu.classList.toggle('hidden');
}

document.addEventListener('click', function() {
  closeSurveyDropdown();
});

function closeSurveyDropdown() {
  var menu = document.getElementById('surveyDropdown');
  if (menu) menu.classList.add('hidden');
}

function startDrawPolygon() {
  isDrawingPolygon = true;
  document.getElementById('surveyStatus').textContent = 'Click the map to add polygon vertices. Right-click to finish.';
}

function addPolygonVertex(lat, lon) {
  polygonPoints.push({ lat: lat, lon: lon });
  renderPolygon();
}

function renderPolygon() {
  if (polygonLayer) { map.removeLayer(polygonLayer); polygonLayer = null; }
  polygonVertexMarkers.forEach(function(m) { map.removeLayer(m); });
  polygonVertexMarkers = [];
  if (polygonPoints.length === 0) return;
  var ll = polygonPoints.map(function(p) { return [p.lat, p.lon]; });
  if (polygonPoints.length >= 3) {
    polygonLayer = L.polygon(ll, { color: '#f59e0b', weight: 2, fillColor: '#f59e0b', fillOpacity: 0.15 }).addTo(map);
  } else {
    polygonLayer = L.polyline(ll, { color: '#f59e0b', weight: 2, dashArray: '6,4' }).addTo(map);
  }
  polygonPoints.forEach(function(p, i) {
    var m = L.marker([p.lat, p.lon], {
      draggable: true,
      icon: L.divIcon({
        className: 'polygon-vtx',
        html: '<div style="width:12px;height:12px;background:#f59e0b;border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(245,158,11,0.6);"></div>',
        iconSize: [12, 12], iconAnchor: [6, 6],
      }),
    }).addTo(map);
    m.on('dragend', function() {
      var pos = m.getLatLng();
      polygonPoints[i] = { lat: pos.lat, lon: pos.lng };
      renderPolygon();
    });
    m.on('dblclick', function() {
      polygonPoints.splice(i, 1);
      renderPolygon();
    });
    polygonVertexMarkers.push(m);
  });
}

function finishPolygon() {
  if (polygonPoints.length < 3) {
    document.getElementById('surveyStatus').textContent = 'Need at least 3 polygon vertices.';
    return;
  }
  isDrawingPolygon = false;
  document.getElementById('surveyStatus').textContent = 'Polygon complete (' + polygonPoints.length + ' pts). Click GENERATE to set grid parameters.';
}

function clearPolygon() {
  polygonPoints = [];
  if (polygonLayer) { map.removeLayer(polygonLayer); polygonLayer = null; }
  polygonVertexMarkers.forEach(function(m) { map.removeLayer(m); });
  polygonVertexMarkers = [];
  isDrawingPolygon = false;
}

function showGridDialog() {
  if (polygonPoints.length < 3) { alert('Draw and finish a polygon first.'); return; }
  var d = document.getElementById('gridDialog');
  if (d) d.classList.remove('hidden');
}

function closeGridDialog() {
  var d = document.getElementById('gridDialog');
  if (d) d.classList.add('hidden');
}

function generateGrid() {
  if (polygonPoints.length < 3) { alert('Need a polygon with at least 3 points.'); return; }
  var alt = parseFloat(document.getElementById('gridAlt').value) || 50;
  var space = parseFloat(document.getElementById('gridSpacing').value) || 10;
  var angle = parseFloat(document.getElementById('gridAngle').value) || 0;
  if (space < 1) { alert('Spacing must be at least 1 meter.'); return; }
  var wps = computeGridWaypoints(polygonPoints, space, angle, alt);
  if (wps.length === 0) { alert('No waypoints generated. Check polygon and parameters.'); return; }
  waypoints = wps.map(function(wp, i) {
    return { seq: i, x: wp.lat, y: wp.lon, z: wp.alt, command: 16, frame: 3, param1: 0, param2: 0, param3: 0, param4: 0 };
  });
  renderWaypoints();
  closeGridDialog();
  document.getElementById('surveyStatus').textContent = 'Generated ' + waypoints.length + ' survey grid waypoints. Click UPLOAD to send to vehicle.';
}

function computeGridWaypoints(polygon, spacing, angleDeg, altitude) {
  if (polygon.length < 3) return [];
  var angle = angleDeg * Math.PI / 180;
  var n = polygon.length;
  var cx = 0, cy = 0;
  for (var i = 0; i < n; i++) { cx += polygon[i].lat; cy += polygon[i].lon; }
  cx /= n; cy /= n;
  var R = 6371000;
  var cl = Math.cos(cx * Math.PI / 180);
  function toLocal(lat, lon) { return { x: (lon - cy) * R * cl * Math.PI / 180, y: (lat - cx) * R * Math.PI / 180 }; }
  function toGeo(x, y) { return { lat: y / R * 180 / Math.PI + cx, lon: x / (R * cl * Math.PI / 180) + cy }; }
  function rotate(p, a) { var c = Math.cos(a), s = Math.sin(a); return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }; }
  var localPts = polygon.map(function(p) { return toLocal(p.lat, p.lon); });
  var rotPts = localPts.map(function(p) { return rotate(p, -angle); });
  var mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
  for (var i = 0; i < n; i++) { var p = rotPts[i]; if (p.x < mnX) mnX = p.x; if (p.x > mxX) mxX = p.x; if (p.y < mnY) mnY = p.y; if (p.y > mxY) mxY = p.y; }
  mnY -= spacing * 0.5; mxY += spacing * 0.5;
  var wps = []; var y = mnY; var dir = 1;
  while (y <= mxY) {
    var xs = [];
    for (var i = 0; i < n; i++) {
      var a = rotPts[i], b = rotPts[(i + 1) % n];
      if (Math.abs(a.y - b.y) < 1e-10) continue;
      var t = (y - a.y) / (b.y - a.y);
      if (t > 1e-10 && t < 1 - 1e-10) xs.push(a.x + t * (b.x - a.x));
    }
    xs.sort(function(a, b) { return a - b; });
    var fx = [];
    for (var k = 0; k < xs.length; k++) { if (k === 0 || Math.abs(xs[k] - xs[k - 1]) > spacing * 0.1) fx.push(xs[k]); }
    for (var k = 0; k + 1 < fx.length; k += 2) {
      var r1 = rotate({ x: fx[k], y: y }, angle);
      var r2 = rotate({ x: fx[k + 1], y: y }, angle);
      var g1 = toGeo(r1.x, r1.y);
      var g2 = toGeo(r2.x, r2.y);
      if (dir === 1) { wps.push({ lat: g1.lat, lon: g1.lon, alt: altitude }); wps.push({ lat: g2.lat, lon: g2.lon, alt: altitude }); }
      else { wps.push({ lat: g2.lat, lon: g2.lon, alt: altitude }); wps.push({ lat: g1.lat, lon: g1.lon, alt: altitude }); }
    }
    y += spacing; dir *= -1;
  }
  return wps;
}

function renderWaypoints() {
  if (wpPolyline) { map.removeLayer(wpPolyline); wpPolyline = null; }
  wpMarkers.forEach(function(m) { map.removeLayer(m); });
  wpMarkers = [];

  var tbody = document.getElementById('surveyWpList');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (waypoints.length === 0) return;

  var pts = waypoints.map(function(wp) { return [wp.x, wp.y]; });
  wpPolyline = L.polyline(pts, { color: '#7c3aed', weight: 2, opacity: 0.5, dashArray: '6,4', interactive: false }).addTo(map);

  waypoints.forEach(function(wp, i) {
    var marker = L.marker([wp.x, wp.y], {
      icon: L.divIcon({
        className: 'wp-marker-survey',
        html: '<div style="width:20px;height:20px;background:#7c3aed;border:2px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;font-weight:700;box-shadow:0 0 6px rgba(124,58,237,0.5);">' + (i + 1) + '</div>',
        iconSize: [20, 20], iconAnchor: [10, 10],
      }),
      interactive: false,
    }).addTo(map);
    wpMarkers.push(marker);

    var tr = document.createElement('tr');
    tr.innerHTML = '<td class="wp-num">' + (i + 1) + '</td><td>' + wp.x.toFixed(6) + '</td><td>' + wp.y.toFixed(6) + '</td><td>' + wp.z.toFixed(1) + '</td>';
    tbody.appendChild(tr);
  });

  var bounds = wpMarkers.map(function(m) { return m.getLatLng(); });
  map.fitBounds(bounds, { padding: [50, 50] });
}

function uploadSurvey() {
  if (waypoints.length === 0) { alert('No waypoints to upload. Generate a grid first.'); return; }
  if (!isConnected) { alert('Not connected to a vehicle.'); return; }
  document.getElementById('surveyStatus').textContent = 'Uploading ' + waypoints.length + ' waypoints...';
  socket.emit('mission_upload', { waypoints: waypoints });
}

function clearSurvey() {
  waypoints = [];
  renderWaypoints();
  clearPolygon();
  document.getElementById('surveyStatus').textContent = 'Survey cleared. Draw a new polygon.';
  setTimeout(function() { startDrawPolygon(); }, 100);
}

function saveSurveyFile() {
  if (waypoints.length === 0) { alert('No waypoints to save. Generate a grid first.'); return; }
  var lines = ['QGC WPL 110'];
  waypoints.forEach(function(wp) {
    lines.push(wp.seq + '\t0\t' + wp.frame + '\t' + wp.command + '\t' + wp.param1 + '\t' + wp.param2 + '\t' + wp.param3 + '\t' + wp.param4 + '\t' + wp.x + '\t' + wp.y + '\t' + wp.z + '\t1');
  });
  var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'survey_grid.waypoints';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function loadSurveyFile() {
  document.getElementById('surveyFileInput').click();
}

document.getElementById('surveyFileInput').addEventListener('change', function(e) {
  var file = e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(ev) {
    var text = ev.target.result;
    var lines = text.split('\n');
    var parsed = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.startsWith('QGC WPL') || line.startsWith('#')) continue;
      var parts = line.split('\t');
      if (parts.length < 12) continue;
      var seq = parseInt(parts[0]) || 0;
      var frame = parseInt(parts[2]) || 3;
      var command = parseInt(parts[3]) || 16;
      var param1 = parseFloat(parts[4]) || 0;
      var param2 = parseFloat(parts[5]) || 0;
      var param3 = parseFloat(parts[6]) || 0;
      var param4 = parseFloat(parts[7]) || 0;
      var x = parseFloat(parts[8]);
      var y = parseFloat(parts[9]);
      var z = parseFloat(parts[10]) || 50;
      if (isNaN(x) || isNaN(y)) continue;
      parsed.push({ seq: seq, x: x, y: y, z: z, command: command, frame: frame, param1: param1, param2: param2, param3: param3, param4: param4 });
    }
    if (parsed.length === 0) { alert('No valid waypoints found in file.'); return; }
    waypoints = parsed;
    renderWaypoints();
    document.getElementById('surveyStatus').textContent = 'Loaded ' + waypoints.length + ' waypoints from file.';
  };
  reader.readAsText(file);
  e.target.value = '';
});
