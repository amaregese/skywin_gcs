// Shared toolbar state — loaded on every page for consistent indicators

function setText(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}

/* Default stubs (overridden by page-specific JS when available) */
function toggleConnection() {}
function toggleTlog() {}
function log(msg, level) {}
function clearConsole() {}

/* Console toggle */
function toggleConsole() {
  var el = document.getElementById('rightConsole');
  if (!el) return;
  el.classList.toggle('expanded');
  var btn = document.getElementById('consoleExpandBtn');
  if (btn) btn.title = el.classList.contains('expanded') ? 'Collapse console' : 'Expand to bottom panel';
}

/* Menu action dispatcher */
function menuAction(action) {
  switch (action) {
    case 'New Mission':
      if (typeof clearMission === 'function') { clearMission(); return; }
      if (window._lastMissionData) { window._lastMissionData = { waypoints: [], count: 0 }; }
      log('New Mission', 'info');
      break;
    case 'Open Mission':
      if (typeof openMissionFile === 'function') { openMissionFile(); return; }
      log('Open Mission — not available on this page', 'warning');
      break;
    case 'Save Mission':
      if (typeof saveMission === 'function') { saveMission(); return; }
      log('Save Mission — not available on this page', 'warning');
      break;
    case 'Save Mission As':
      if (typeof saveMissionAs === 'function') { saveMissionAs(); return; }
      log('Save Mission As — not available on this page', 'warning');
      break;
    case 'Export Log':
      log('Export Log — not yet implemented', 'info');
      break;
    case 'Exit':
      if (typeof close === 'function') close();
      else if (typeof window.close === 'function') window.close();
      break;
    case 'Vehicle Setup':
      location.href = '/config';
      break;
    case 'Parameter Editor':
      location.href = '/params';
      break;
    case 'App Settings':
      log('App Settings — not yet implemented', 'info');
      break;
    case 'Telemetry Logs':
      if (typeof loadTlogFile === 'function') { loadTlogFile(); return; }
      log('Telemetry Logs — not available on this page', 'warning');
      break;
    case 'DataFlash Logs':
      log('DataFlash Logs — not yet implemented', 'info');
      break;
    case 'About':
      alert('SGC — Skywin Ground Control Station\nVersion 1.0');
      break;
  }
}

/* ── Simplified hamburger menu ── */
/* Only main section headers; sub-items rendered inside the main page body */

var MENU_SECTIONS = [
  { icon: '\uD83D\uDCC1', label: 'FILE', action: 'File' },
  { icon: '\uD83D\uDDFA\uFE0F', label: 'FLIGHT PLAN', url: '/plan' },
  { icon: '\u2699\uFE0F', label: 'CONFIG', url: '/config' },
  { icon: '\u26A1', label: 'FIRMWARE', url: '/firmware' },
  { icon: '\uD83D\uDCCB', label: 'LOGS', action: 'Logs' },
  { icon: '\u2753', label: 'HELP', action: 'About' },
];

function renderToolbarMenu() {
  var menu = document.getElementById('tbMenu');
  if (!menu) return;
  menu.innerHTML = '';
  MENU_SECTIONS.forEach(function (section) {
    var btn = document.createElement('button');
    btn.className = 'tb-menu-btn tb-menu-section';
    if (section.url) {
      btn.onclick = function () { location.href = section.url; closeToolbarMenu(); };
    } else if (section.action === 'File') {
      btn.onclick = function () { closeToolbarMenu(); openMissionFile(); };
    } else if (section.action === 'Logs') {
      btn.onclick = function () { closeToolbarMenu(); toggleConsole(); };
    } else if (section.action) {
      btn.onclick = function () { menuAction(section.action); closeToolbarMenu(); };
    }
    btn.innerHTML = '<span class="tb-menu-btn-icon">' + (section.icon || '') + '</span> ' + section.label;
    menu.appendChild(btn);
  });
}

/* Hamburger toolbar menu — hover + click with slide animation */
function toggleToolbarMenu() {
  var menu = document.getElementById('tbMenu');
  if (!menu) return;
  if (menu.classList.contains('open')) {
    closeToolbarMenu();
  } else {
    openToolbarMenu();
  }
}

function openToolbarMenu() {
  var menu = document.getElementById('tbMenu');
  if (!menu) return;
  menu.classList.add('open');
  if (window._tbMenuTimer) clearTimeout(window._tbMenuTimer);
}

function closeToolbarMenu() {
  var menu = document.getElementById('tbMenu');
  if (!menu) return;
  menu.classList.remove('open');
}

function hideToolbarMenu() {
  if (window._tbMenuTimer) clearTimeout(window._tbMenuTimer);
  window._tbMenuTimer = setTimeout(function() {
    closeToolbarMenu();
  }, 200);
}

function cancelHideToolbarMenu() {
  if (window._tbMenuTimer) {
    clearTimeout(window._tbMenuTimer);
    window._tbMenuTimer = null;
  }
}

document.addEventListener('DOMContentLoaded', function() {
  renderToolbarMenu();
  var hamburger = document.getElementById('tbHamburger');
  var menu = document.getElementById('tbMenu');
  if (hamburger && menu) {
    hamburger.addEventListener('mouseenter', openToolbarMenu);
    hamburger.addEventListener('mouseleave', hideToolbarMenu);
    menu.addEventListener('mouseenter', cancelHideToolbarMenu);
    menu.addEventListener('mouseleave', hideToolbarMenu);
  }
  /* Close menu on click outside */
  document.addEventListener('click', function(e) {
    if (!menu || !hamburger) return;
    if (!menu.contains(e.target) && !hamburger.contains(e.target)) {
      closeToolbarMenu();
    }
  });
});
