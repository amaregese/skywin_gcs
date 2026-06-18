var _fwCards = [];
var _fwActiveTab = null;
var _fwActiveCategory = 'stable';
var _fwFirmwareData = {};
var _fwSelectedBoard = null;
var _fwSearchTerm = '';
var _fwAllBoards = [];
var _fwDisplayCount = 30;
var _fwDownloadedPath = null;
var _fwSocket = null;

function fwInit() {
  _fwSocket = io({ transports: ['websocket', 'polling'] });

  _fwSocket.on('connect', function () {
    fwLog('Socket connected', 'info');
  });

  _fwSocket.on('flash_progress', function (data) {
    fwUpdateProgress(data);
  });

  _fwSocket.on('flash_log', function (data) {
    fwLog(data.message || JSON.stringify(data), data.level || 'info');
  });

  _fwSocket.on('fw_board_detect_progress', function (data) {
    fwLog(data.port + ': ' + (data.found ? 'Found' : 'No response'), 'info');
  });

  _fwSocket.on('download_progress', function (data) {
    fwUpdateProgress(data);
  });

  _fwSocket.on('verification_progress', function (data) {
    fwUpdateProgress(data);
  });

  fetch('/api/firmware/cards')
    .then(function (r) { return r.json(); })
    .then(function (cards) {
      _fwCards = cards;
      fwRenderTabs();
      if (cards.length > 0) fwSwitchTab(cards[0].id);
    })
    .catch(function (err) { console.error(err); });
}

function fwRenderTabs() {
  var bar = document.getElementById('fwTabBar');
  bar.innerHTML = '';
  _fwCards.forEach(function (card) {
    var tab = document.createElement('div');
    tab.className = 'fw-tab';
    tab.dataset.id = card.id;
    tab.innerHTML = '<span class="fw-tab-icon">' + (card.icon || '') + '</span> ' + card.name;
    tab.onclick = function () { fwSwitchTab(card.id); };
    bar.appendChild(tab);
  });
}

function fwGetVehicleIcon(vehicle) {
  if (!vehicle) return '&#x1F539;';
  for (var i = 0; i < _fwCards.length; i++) {
    if (_fwCards[i].vehicles.indexOf(vehicle) !== -1) {
      return _fwCards[i].icon || '&#x1F539;';
    }
  }
  return '&#x1F539;';
}

function fwSwitchTab(tabId) {
  _fwActiveTab = tabId;
  _fwSelectedBoard = null;
  _fwAllBoards = [];
  _fwDisplayCount = 30;
  fwUpdateSelection();

  var tabs = document.querySelectorAll('.fw-tab');
  tabs.forEach(function (t) { t.classList.remove('active'); });
  var active = document.querySelector('.fw-tab[data-id="' + tabId + '"]');
  if (active) active.classList.add('active');

  fwFetchFirmwareList(_fwActiveCategory);
}

function fwSwitchCategory(cat) {
  _fwActiveCategory = cat;
  _fwSelectedBoard = null;
  _fwDisplayCount = 30;
  fwUpdateSelection();

  var pills = document.querySelectorAll('.fw-pill');
  pills.forEach(function (p) { p.classList.remove('active'); });
  var active = document.querySelector('.fw-pill[data-cat="' + cat + '"]');
  if (active) active.classList.add('active');

  if (_fwActiveTab) fwFetchFirmwareList(cat);
}

function fwFetchFirmwareList(category) {
  fetch('/api/firmware/list/' + category)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      _fwFirmwareData = data;
      _fwAllBoards = (data.firmwares || []).filter(function (b) {
        var card = _fwCards.find(function (c) { return c.id === _fwActiveTab; });
        if (!card) return true;
        return card.vehicles.indexOf(b.vehicle) !== -1;
      });
      fwRenderBoards();
    })
    .catch(function (err) { console.error(err); });
}

function fwRenderBoards() {
  var list = document.getElementById('fwBoardList');
  var filtered = _fwAllBoards.filter(function (b) {
    if (!_fwSearchTerm) return true;
    var term = _fwSearchTerm.toLowerCase();
    return (b.name || '').toLowerCase().indexOf(term) !== -1 ||
           (b.board || '').toLowerCase().indexOf(term) !== -1 ||
           (b.version || '').toLowerCase().indexOf(term) !== -1 ||
           (b.vehicle || '').toLowerCase().indexOf(term) !== -1;
  });

  if (filtered.length === 0) {
    list.innerHTML = '<div class="fw-empty">' +
      (_fwSearchTerm ? 'No firmware matching "' + _fwSearchTerm + '"' : 'No firmware available for this vehicle') +
      '</div>';
    return;
  }

  var show = filtered.slice(0, _fwDisplayCount);
  var html = '';
  show.forEach(function (b) {
    var icon = fwGetVehicleIcon(b.vehicle);
    var isSelected = _fwSelectedBoard && _fwSelectedBoard.name === b.name && _fwSelectedBoard.version === b.version;
    html += '<div class="fw-board-item' + (isSelected ? ' selected' : '') + '" onclick="fwSelectBoard(\'' + b.name.replace(/'/g, "\\'") + '\',\'' + (b.version || '').replace(/'/g, "\\'") + '\',\'' + (b.vehicle || '').replace(/'/g, "\\'") + '\',\'' + ((b.fw_url || b.url) || '').replace(/'/g, "\\'") + '\')">';
    html += '<span class="fw-board-icon">' + icon + '</span>';
    html += '<div class="fw-board-info">';
    html += '<div class="fw-board-name">' + (b.name || b.board) + '</div>';
    html += '<div class="fw-board-version">v' + (b.version || '?') + '</div>';
    html += '</div>';
    html += '<span class="fw-board-frame">' + (b.vehicle || '') + '</span>';
    html += '</div>';
  });

  var remaining = filtered.length - show.length;
  if (remaining > 0) {
    html += '<div class="fw-show-more" onclick="fwShowMore()">Show all ' + filtered.length + ' boards (' + remaining + ' more) &#9660;</div>';
  }

  list.innerHTML = html;
}

function fwShowMore() {
  _fwDisplayCount = _fwAllBoards.length;
  fwRenderBoards();
}

function fwSelectBoard(name, version, vehicle, fwUrl) {
  _fwSelectedBoard = { name: name, version: version, vehicle: vehicle, fw_url: fwUrl };
  fwUpdateSelection();
  fwRenderBoards();
}

function fwUpdateSelection() {
  var label = document.getElementById('fwSelectionLabel');
  var btn = document.getElementById('fwFlashBtn');
  if (_fwSelectedBoard) {
    label.textContent = _fwSelectedBoard.name + ' v' + _fwSelectedBoard.version;
    btn.disabled = false;
  } else {
    label.textContent = 'No board selected';
    btn.disabled = true;
  }
}

function fwFilterBoards() {
  var input = document.getElementById('fwSearchInput');
  _fwSearchTerm = input.value;
  _fwDisplayCount = 30;
  fwRenderBoards();
}

function fwStartFlash() {
  if (!_fwSelectedBoard) return;

  var port = document.getElementById('fwPortInput').value.trim();
  if (!port) {
    fwLog('Please enter a COM port (e.g. COM5)', 'warning');
    return;
  }

  document.getElementById('fwFlashModal').classList.add('open');
  document.getElementById('fwProgressFill').style.width = '0%';
  document.getElementById('fwLogPanel').innerHTML = '';
  document.getElementById('fwFlashInfo').textContent = 'Flashing ' + _fwSelectedBoard.name + ' on ' + port + '...';

  fwLog('Downloading firmware...', 'info');
  var btn = document.getElementById('fwFlashBtn');
  btn.disabled = true;

  fetch('/api/firmware/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: _fwSelectedBoard.name,
      version: _fwSelectedBoard.version,
      frame: _fwSelectedBoard.vehicle,
      category: _fwActiveCategory,
      url: _fwSelectedBoard.fw_url,
    })
  })
    .then(function (r) { return r.json(); })
    .then(function (dlResult) {
      if (dlResult.error) {
        fwLog('Download failed: ' + dlResult.error, 'error');
        btn.disabled = false;
        return null;
      }
      _fwDownloadedPath = dlResult.path;
      fwLog('Downloaded to ' + dlResult.path, 'success');
      fwLog('Verifying checksum...', 'info');
      return fetch('/api/firmware/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_path: dlResult.path,
          checksum_sha256: dlResult.checksum_sha256,
        })
      });
    })
    .then(function (r) { return r ? r.json() : null; })
    .then(function (verifyResult) {
      if (!verifyResult) return;
      if (verifyResult.error) {
        fwLog('Verify error: ' + verifyResult.error, 'warning');
      } else if (verifyResult.valid) {
        fwLog('Checksum verified', 'success');
      } else {
        fwLog('Checksum mismatch!', 'warning');
      }

      if (!_fwDownloadedPath) {
        fwLog('No firmware to flash', 'error');
        btn.disabled = false;
        return;
      }

      fwLog('Starting flash...', 'info');
      return fetch('/api/firmware/flash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_path: _fwDownloadedPath,
          port: port,
          baud: 115200,
          board_name: _fwSelectedBoard.name,
          fw_name: _fwSelectedBoard.name,
          fw_version: _fwSelectedBoard.version,
        })
      });
    })
    .then(function (r) { return r ? r.json() : null; })
    .then(function (flashResult) {
      if (!flashResult) return;
      if (flashResult.error) {
        fwLog('Flash error: ' + flashResult.error, 'error');
      } else if (flashResult.started) {
        fwLog('Flash process started in background', 'info');
      }
      btn.disabled = false;
    })
    .catch(function (err) {
      fwLog('Error: ' + err.message, 'error');
      btn.disabled = false;
    });
}

function fwUpdateProgress(data) {
  var fill = document.getElementById('fwProgressFill');
  if (data.percent !== undefined) {
    fill.style.width = Math.min(data.percent, 100) + '%';
  }
  if (data.stage) {
    fwLog('Stage: ' + data.stage + (data.percent !== undefined ? ' (' + data.percent + '%)' : ''), 'info');
  }
}

function fwLog(message, level) {
  var panel = document.getElementById('fwLogPanel');
  if (!panel) return;
  var entry = document.createElement('div');
  entry.className = 'fw-log-entry ' + (level || 'info');
  var ts = new Date().toLocaleTimeString();
  entry.textContent = '[' + ts + '] ' + message;
  panel.appendChild(entry);
  panel.scrollTop = panel.scrollHeight;
}

function fwCloseModal() {
  document.getElementById('fwFlashModal').classList.remove('open');
}

function fwDetectBoards() {
  fwLog('Scanning serial ports...', 'info');
  fetch('/api/firmware/detect')
    .then(function (r) { return r.json(); })
    .then(function (boards) {
      if (boards.length === 0) {
        fwLog('No boards detected', 'warning');
      } else {
        fwLog('Detected ' + boards.length + ' board(s): ' +
          boards.map(function (b) { return b.port + ' (' + (b.board_name || 'Unknown') + ')'; }).join(', '), 'success');
        if (boards[0].port) document.getElementById('fwPortInput').value = boards[0].port;
      }
    })
    .catch(function (err) {
      fwLog('Detection error: ' + err.message, 'error');
    });
}

function fwRefreshCache() {
  fwLog('Refreshing firmware cache...', 'info');
  fetch('/api/firmware/refresh-cache')
    .then(function (r) { return r.json(); })
    .then(function (result) {
      if (result.status === 'ok') {
        var counts = result.counts || {};
        fwLog('Cache refreshed: ' + Object.keys(counts).map(function (k) { return k + '=' + counts[k]; }).join(', '), 'success');
        if (_fwActiveTab) fwFetchFirmwareList(_fwActiveCategory);
      } else {
        fwLog('Cache refresh failed', 'error');
      }
    })
    .catch(function (err) {
      fwLog('Cache refresh error: ' + err.message, 'error');
    });
}

document.addEventListener('DOMContentLoaded', fwInit);
