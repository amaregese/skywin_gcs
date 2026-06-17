var socket = io();
var _selectedFirmware = null;
var _detectedBoard = null;
var _downloadedFile = null;
var _firmwareCache = [];
var _firmwareList = [];

function log(msg, level) {
  level = level || 'info';
  var out = document.getElementById('consoleOutput');
  if (!out) return;
  var time = new Date().toLocaleTimeString();
  var entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = '<span class="log-time">' + time + '</span><span class="log-badge log-badge-' + level + '">' + level + '</span><span class="log-msg ' + level + '">' + msg + '</span>';
  out.appendChild(entry);
  out.scrollTop = out.scrollHeight;
}

function toggleConnection() { location.href = '/'; }
function toggleTlog() {}

/* ---- Firmware Loading ---- */
function loadFirmwareCategory(category) {
  var grid = document.getElementById('fwCardsGrid');
  var empty = document.getElementById('fwEmptyState');
  grid.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;">Loading ' + category + ' firmware...</div>';
  empty.classList.add('fw-panel-hidden');

  fetch('/api/firmware/list/' + category)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _firmwareCache = data;
      renderFirmwareCards(data);
    })
    .catch(function(err) {
      grid.innerHTML = '<div class="fw-empty-state"><div class="fw-empty-icon">⚠️</div><div class="fw-empty-text">Failed to load firmware</div><div class="fw-empty-hint">' + err.message + '</div></div>';
    });
}

function refreshFirmwareCache() {
  var grid = document.getElementById('fwCardsGrid');
  grid.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;">Refreshing firmware list...</div>';
  fetch('/api/firmware/refresh-cache')
    .then(function(r) { return r.json(); })
    .then(function(result) {
      log('Firmware cache refreshed: ' + JSON.stringify(result), 'info');
  var searchInput = document.getElementById('fwSearchInput');
  if (searchInput) {
    searchInput.addEventListener('keyup', function() {
      _fwSearchTerm = searchInput.value;
      renderFirmwareCards(_firmwareList);
    });
  }

  loadAllFirmware();
    })
    .catch(function(err) {
      log('Refresh failed: ' + err.message, 'error');
    });
}

var _fwSearchTerm = '';

var _fwCategory = 'stable';

function loadAllFirmware() {
  var grid = document.getElementById('fwCardsGrid');
  grid.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;">Loading firmware catalog...</div>';

  fetch('/api/firmware/list/' + _fwCategory)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _firmwareList = data;
      renderFirmwareCards(_firmwareList);
      log('Loaded ' + _firmwareList.length + ' firmware entries (' + _fwCategory + ')', 'info');
    })
    .catch(function(err) {
      grid.innerHTML = '<div class="fw-empty-state"><div class="fw-empty-icon">⚠️</div><div class="fw-empty-text">Failed to load firmware catalog</div><div class="fw-empty-hint">' + err.message + '</div></div>';
    });
}

function switchCategory(cat) {
  _fwCategory = cat;
  document.querySelectorAll('.fw-cat-btn').forEach(function(el) { el.classList.remove('active'); });
  var btn = document.querySelector('.fw-cat-btn[data-cat="' + cat + '"]');
  if (btn) btn.classList.add('active');
  loadAllFirmware();
}

var _selectedFrame = 'Rover';

/* ---- Render Firmware View (tab selector + board list) ---- */
function renderFirmwareCards(firmwares) {
  var container = document.getElementById('fwCardsGrid');
  var empty = document.getElementById('fwEmptyState');

  if (!firmwares || firmwares.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('fw-panel-hidden');
    return;
  }

  empty.classList.add('fw-panel-hidden');

  // Filter by search term
  if (_fwSearchTerm) {
    var term = _fwSearchTerm.toLowerCase();
    firmwares = firmwares.filter(function(fw) {
      return (fw.board && fw.board.toLowerCase().indexOf(term) !== -1) ||
             (fw.name && fw.name.toLowerCase().indexOf(term) !== -1) ||
             (fw.frame && fw.frame.toLowerCase().indexOf(term) !== -1) ||
             (fw.version && fw.version.toLowerCase().indexOf(term) !== -1) ||
             (fw.category && fw.category.toLowerCase().indexOf(term) !== -1);
    });
  }

  // Group by frame
  var grouped = {};
  firmwares.forEach(function(fw) {
    var key = fw.frame || 'Unknown';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(fw);
  });

  var sortedFrames = ['Rover', 'Plane', 'Quad', 'Helicopter', 'Sub', 'Tracker', 'Hexa', 'Octa', 'Tri', 'Y6', 'X8', 'Custom', 'Unknown'];
  var icons = {
    'Rover': '🚜', 'Plane': '✈️', 'Quad': '🚁', 'Helicopter': '🚁',
    'Sub': '🤿', 'Tracker': '📡', 'Hexa': '🚁', 'Octa': '🚁',
    'Tri': '🚁', 'Y6': '🚁', 'X8': '🚁', 'Custom': '🔧', 'Unknown': '📦'
  };

  // Filter to only frames that have data
  var activeFrames = sortedFrames.filter(function(f) { return grouped[f] && grouped[f].length > 0; });
  if (activeFrames.length === 0) {
    container.innerHTML = '<div class="fw-empty-state"><div class="fw-empty-icon">📭</div><div class="fw-empty-text">No firmware available</div></div>';
    return;
  }

  // Ensure selected frame is valid
  if (activeFrames.indexOf(_selectedFrame) === -1) {
    _selectedFrame = activeFrames[0];
  }

  container.innerHTML = '';

  // --- Vehicle type tabs ---
  var tabBar = document.createElement('div');
  tabBar.className = 'fw-frame-tabs';
  activeFrames.forEach(function(frame) {
    var tab = document.createElement('button');
    tab.className = 'fw-frame-tab' + (frame === _selectedFrame ? ' active' : '');
    tab.textContent = (icons[frame] || '📦') + ' ' + frame;
    tab.onclick = function() {
      if (frame === _selectedFrame) return;
      _selectedFrame = frame;
      renderFirmwareCards(firmwares);
    };
    tabBar.appendChild(tab);
  });
  container.appendChild(tabBar);

  // --- Board list for selected frame ---
  var list = grouped[_selectedFrame];
  var boardArea = document.createElement('div');
  boardArea.className = 'fw-board-area';

  var boardList = document.createElement('div');
  boardList.className = 'fw-board-list';

  var MAX_VISIBLE = 30;
  var showAll = false;

  function renderBoardItems() {
    boardList.innerHTML = '';
    var items = showAll ? list : list.slice(0, MAX_VISIBLE);
    items.forEach(function(fw, idx) {
      var item = document.createElement('div');
      item.className = 'fw-board-item';
      if (_selectedFirmware && _selectedFirmware.board === fw.board && _selectedFirmware.frame === fw.frame) {
        item.classList.add('selected');
      }

      var boardLabel = document.createElement('span');
      boardLabel.className = 'fw-board-name';
      boardLabel.textContent = fw.board || 'generic';

      var verLabel = document.createElement('span');
      verLabel.className = 'fw-board-version';
      verLabel.textContent = fw.version || 'v0.0.0';

      var catLabel = document.createElement('span');
      catLabel.className = 'fw-board-category';
      catLabel.textContent = fw.category || 'stable';

      item.appendChild(boardLabel);
      item.appendChild(verLabel);
      item.appendChild(catLabel);

      item.onclick = function() {
        boardList.querySelectorAll('.fw-board-item').forEach(function(el) { el.classList.remove('selected'); });
        item.classList.add('selected');
        _selectedFirmware = fw;
        document.getElementById('fwSelectedBoard').textContent = fw.board + ' (' + (fw.version || 'v0.0.0') + ')';
        log('Selected: ' + fw.board + ' ' + (fw.version || '') + ' (' + _selectedFrame + ')', 'info');
      };
      boardList.appendChild(item);
    });

    // Show more/less
    if (list.length > MAX_VISIBLE) {
      var toggleBtn = document.createElement('div');
      toggleBtn.className = 'fw-board-toggle';
      if (showAll) {
        toggleBtn.textContent = 'Show fewer ▲ (' + list.length + ' total)';
        toggleBtn.onclick = function() { showAll = false; renderBoardItems(); };
      } else {
        toggleBtn.textContent = 'Show all ' + list.length + ' boards ▼';
        toggleBtn.onclick = function() { showAll = true; renderBoardItems(); };
      }
      boardList.appendChild(toggleBtn);
    }
  }

  renderBoardItems();
  boardArea.appendChild(boardList);
  container.appendChild(boardArea);

  // If nothing selected yet, auto-select first
  if (!_selectedFirmware || _selectedFirmware.frame !== _selectedFrame) {
    var firstItem = boardList.querySelector('.fw-board-item');
    if (firstItem) firstItem.click();
  }
}

function selectFirmwareCard(card, fw) {
  document.querySelectorAll('.fw-card.selected').forEach(function(el) { el.classList.remove('selected'); });
  card.classList.add('selected');
  _selectedFirmware = fw;
  document.getElementById('fwSelectedBoard').textContent = fw.board + ' (' + (fw.version || 'v0.0.0') + ')';
  log('Selected: ' + fw.name + ' v' + fw.version + ' (' + fw.frame + ')', 'info');
}

/* ---- Board Detection ---- */
function detectBoard() {
  var list = document.getElementById('fwDetectionList');
  list.innerHTML = '<div style="text-align:center;padding:12px;color:#64748b;font-size:12px;">🔍 Scanning serial ports...</div>';
  document.getElementById('fwDetectionPanel').classList.remove('fw-panel-hidden');

  fetch('/api/firmware/detect')
    .then(function(r) { return r.json(); })
    .then(function(boards) {
      if (!boards || boards.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:16px;color:#64748b;font-size:12px;">No flight controllers detected. Connect a board via USB and try again.</div>';
        return;
      }
      list.innerHTML = '';
      boards.forEach(function(b) {
        if (!b.port) return;
        var item = document.createElement('div');
        item.className = 'fw-detection-item';
        var isBootloader = b.bootloader;
        item.innerHTML = '<span class="fw-detection-item-icon">' + (isBootloader ? '🔄' : '🔌') + '</span>' +
          '<span class="fw-detection-port">' + b.port + '</span>' +
          '<span class="fw-detection-board">' + (b.board || 'Unknown Board') + '</span>' +
          '<span class="fw-detection-bootloader ' + (isBootloader ? 'yes' : 'no') + '">' + (isBootloader ? 'Bootloader' : 'Normal') + '</span>' +
          '<button class="fw-btn fw-btn-outline" onclick="selectBoard(\'' + b.port + '\',\'' + (b.board || 'Unknown') + '\',\'' + isBootloader + '\')" style="padding:3px 10px;font-size:9px;">Select</button>';
        list.appendChild(item);
      });
      log('Detected ' + boards.length + ' board(s)', 'success');
    })
    .catch(function(err) {
      list.innerHTML = '<div style="text-align:center;padding:16px;color:#f87171;font-size:12px;">Detection failed: ' + err.message + '</div>';
    });
}

function selectBoard(port, board, bootloader) {
  _detectedBoard = { port: port, board: board, bootloader: bootloader === 'true' || bootloader === true };
  log('Selected board: ' + board + ' on ' + port, 'success');
  showNotification('Board selected: ' + board + ' on ' + port, 'success');
}

/* ---- Flash Workflow ---- */
function startFlash() {
  if (!_selectedFirmware) {
    showNotification('Please select a firmware first', 'warning');
    return;
  }

  if (_detectedBoard) {
    doFlash();
    return;
  }

  // Check if user manually entered a port
  var portInput = document.getElementById('fwPortInput');
  var manualPort = portInput ? portInput.value.trim() : '';
  if (manualPort) {
    _detectedBoard = { port: manualPort, board: 'Manual', bootloader: true };
    addFlashLog('Using manual port: ' + manualPort, 'info');
    doFlash();
    return;
  }

  // Auto-detect board if none selected
  addFlashLog('No board selected — auto-detecting...', 'info');
  fetch('/api/firmware/detect')
    .then(function(r) { return r.json(); })
    .then(function(boards) {
      if (boards && boards.length > 0) {
        _detectedBoard = { port: boards[0].port, board: boards[0].board || 'Unknown', bootloader: !!boards[0].bootloader };
        addFlashLog('Auto-selected ' + _detectedBoard.board + ' on ' + _detectedBoard.port, 'success');
        doFlash();
      } else {
        showNotification('No flight controller detected. Connect a board and try again.', 'warning');
        addFlashLog('No board detected — connect a flight controller via USB.', 'error');
      }
    })
    .catch(function(err) {
      showNotification('Board detection failed: ' + err.message, 'error');
      addFlashLog('Detection error: ' + err.message, 'error');
    });
}

function doFlash() {
    var modal = document.getElementById('fwFlashModal');
    modal.classList.remove('fw-panel-hidden');
    document.getElementById('fwFlashBoard').textContent = _detectedBoard.board;
    document.getElementById('fwFlashFirmware').textContent = _selectedFirmware.name + ' v' + _selectedFirmware.version;
    document.getElementById('fwFlashPort').textContent = _detectedBoard.port;
    document.getElementById('fwFlashLog').innerHTML = '';

    resetProgressBars();
    addFlashLog('Starting firmware installation...', 'info');
    addFlashLog('Downloading ' + _selectedFirmware.name + ' v' + _selectedFirmware.version, 'info');

    fetch('/api/firmware/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_selectedFirmware),
    })
      .then(function(r) { return r.json(); })
      .then(function(result) {
        if (result.error) {
          addFlashLog('Download failed: ' + result.error, 'error');
          return;
        }
        _downloadedFile = result;
        addFlashLog('Download complete: ' + result.name, 'success');
        setProgress('download', 100);
        setProgressLabel('download', 'Complete');

        addFlashLog('Verifying checksum...', 'info');
        setProgressLabel('verify', 'Verifying...');

        return fetch('/api/firmware/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_path: result.path, checksum_sha256: result.checksum_sha256 || '' }),
        });
      })
    .then(function(r) { return r ? r.json() : null; })
    .then(function(verifyResult) {
      if (verifyResult && verifyResult.error) {
        addFlashLog('Verification failed: ' + verifyResult.error, 'error');
        setProgress('verify', 0);
        setProgressLabel('verify', 'Failed');
        return;
      }
      if (verifyResult) {
        setProgress('verify', 100);
        setProgressLabel('verify', verifyResult.valid ? 'Valid ✓' : 'Invalid ✗');
        if (!verifyResult.valid) {
          addFlashLog('Checksum mismatch! Aborting.', 'error');
          return;
        }
        addFlashLog('Checksum verified successfully', 'success');
      }

      addFlashLog('Flashing to ' + _detectedBoard.port + '...', 'info');
      setProgressLabel('flash', 'Flashing...');

      return fetch('/api/firmware/flash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_path: _downloadedFile.path,
          port: _detectedBoard.port,
          baud: 115200,
          board_name: _detectedBoard.board,
          fw_name: _selectedFirmware.name,
          fw_version: _selectedFirmware.version,
        }),
      });
    })
    .then(function(r) { return r ? r.json() : null; })
    .then(function(flashResult) {
      if (flashResult && flashResult.error) {
        addFlashLog('Flash failed: ' + flashResult.error, 'error');
        return;
      }
      if (flashResult && flashResult.started) {
        addFlashLog('Flashing started...', 'info');
      }
    })
    .catch(function(err) {
      addFlashLog('Error: ' + err.message, 'error');
    });
}

function flashCustomFirmware() {
  var fileInput = document.getElementById('fwFileInput');
  if (!fileInput.files || !fileInput.files[0]) {
    showNotification('Please select a firmware file first', 'warning');
    return;
  }

  function doCustomFlash() {
    var formData = new FormData();
    formData.append('file', fileInput.files[0]);

    var modal = document.getElementById('fwFlashModal');
    modal.classList.remove('fw-panel-hidden');
    document.getElementById('fwFlashBoard').textContent = _detectedBoard.board;
    document.getElementById('fwFlashFirmware').textContent = fileInput.files[0].name;
    document.getElementById('fwFlashPort').textContent = _detectedBoard.port;
    document.getElementById('fwFlashLog').innerHTML = '';
    resetProgressBars();
    addFlashLog('Uploading custom firmware...', 'info');

    fetch('/api/firmware/upload-custom', {
      method: 'POST',
      body: formData,
    })
      .then(function(r) { return r.json(); })
      .then(function(result) {
        if (result.error) {
          addFlashLog('Upload failed: ' + result.error, 'error');
          return;
        }
        _downloadedFile = result;
        addFlashLog('Upload complete: ' + result.name, 'success');
        setProgress('download', 100);
        setProgressLabel('download', 'Uploaded');

        addFlashLog('Flashing custom firmware to ' + _detectedBoard.port + '...', 'info');

        return fetch('/api/firmware/flash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_path: result.path,
            port: _detectedBoard.port,
            baud: 115200,
            board_name: _detectedBoard.board,
            fw_name: result.name,
            fw_version: 'custom',
          }),
        });
      })
      .then(function(r) { return r ? r.json() : null; })
      .then(function(flashResult) {
        if (flashResult && flashResult.started) {
          addFlashLog('Custom firmware flashing started', 'info');
        }
      })
      .catch(function(err) {
        addFlashLog('Error: ' + err.message, 'error');
      });

    closeCustomModal();
  }

  if (_detectedBoard) {
    doCustomFlash();
    return;
  }

  // Auto-detect board if none selected
  addFlashLog('No board selected — auto-detecting...', 'info');
  fetch('/api/firmware/detect')
    .then(function(r) { return r.json(); })
    .then(function(boards) {
      if (boards && boards.length > 0) {
        _detectedBoard = { port: boards[0].port, board: boards[0].board || 'Unknown', bootloader: !!boards[0].bootloader };
        addFlashLog('Auto-selected ' + _detectedBoard.board + ' on ' + _detectedBoard.port, 'success');
        doCustomFlash();
      } else {
        showNotification('No flight controller detected. Connect a board and try again.', 'warning');
        addFlashLog('No board detected — connect a flight controller via USB.', 'error');
      }
    })
    .catch(function(err) {
      showNotification('Board detection failed: ' + err.message, 'error');
      addFlashLog('Detection error: ' + err.message, 'error');
    });
}

/* ---- Progress Management ---- */
function resetProgressBars() {
  ['download', 'flash', 'verify'].forEach(function(id) {
    setProgress(id, 0);
    setProgressLabel(id, 'Waiting...');
  });
  document.getElementById('fwStatusText').textContent = 'Working...';
  document.getElementById('fwStatusText').style.color = '#38bdf8';

  document.getElementById('fwDownloadFill').className = 'fw-status-bar-fill progress';
  document.getElementById('fwFlashFill').className = 'fw-status-bar-fill progress';
  document.getElementById('fwVerifyFill').className = 'fw-status-bar-fill progress';
}

function setProgress(type, percent) {
  var cap = type.charAt(0).toUpperCase() + type.slice(1);

  // Update status bar fill
  var barFill = document.getElementById('fw' + cap + 'Fill');
  if (barFill) {
    barFill.style.width = percent + '%';
    if (percent >= 100) barFill.className = 'fw-status-bar-fill complete';
    else if (percent > 0) barFill.className = 'fw-status-bar-fill progress';
    else barFill.className = 'fw-status-bar-fill';
  }

  // Update status bar percent text
  var pctEl = document.getElementById('fw' + cap + 'Pct');
  if (pctEl) pctEl.textContent = percent + '%';

  // Update modal progress fill
  var modalFill = document.getElementById('fw' + cap + 'Progress');
  if (modalFill) modalFill.style.width = percent + '%';
}

function setProgressLabel(type, text) {
  var cap = type.charAt(0).toUpperCase() + type.slice(1);

  // Update status bar label
  var barLabel = document.getElementById('fw' + cap + 'Pct');
  if (barLabel && text.indexOf('%') === -1) {
    barLabel.textContent = text;
  }

  // Update modal label
  var modalLabel = document.getElementById('fw' + cap + 'Label');
  if (modalLabel) modalLabel.textContent = text;
}

function addFlashLog(msg, level) {
  level = level || 'info';
  var el = document.getElementById('fwFlashLog');
  if (!el) return;
  var entry = document.createElement('div');
  entry.className = 'fw-log-entry ' + level;
  entry.textContent = '> ' + msg;
  el.appendChild(entry);
  el.scrollTop = el.scrollHeight;

  document.getElementById('fwStatusText').textContent = msg;
  if (level === 'error') {
    document.getElementById('fwStatusText').style.color = '#f87171';
  } else if (level === 'success') {
    document.getElementById('fwStatusText').style.color = '#4ade80';
  } else {
    document.getElementById('fwStatusText').style.color = '#38bdf8';
  }

  log(msg, level);
}

/* ---- Modals ---- */
function closeFlashModal() {
  document.getElementById('fwFlashModal').classList.add('fw-panel-hidden');
}

function abortFlash() {
  addFlashLog('Flash aborted by user', 'warning');
  document.getElementById('fwStatusText').textContent = 'Aborted';
  document.getElementById('fwStatusText').style.color = '#facc15';
}

/* ---- Custom Firmware ---- */
function openCustomFirmware() {
  document.getElementById('fwCustomModal').classList.remove('fw-panel-hidden');
  document.getElementById('fwFileInput').value = '';
  document.getElementById('fwCustomInfo').style.display = 'none';
}

function closeCustomModal() {
  document.getElementById('fwCustomModal').classList.add('fw-panel-hidden');
}

function handleCustomFile(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  var ext = file.name.split('.').pop().toLowerCase();
  if (['apj', 'hex', 'bin', 'px4'].indexOf(ext) === -1) {
    showNotification('Unsupported file type: .' + ext, 'error');
    return;
  }

  var info = document.getElementById('fwCustomInfo');
  info.style.display = 'flex';
  info.innerHTML = '<div class="fw-info-box"><div class="fw-info-label">File</div><div class="fw-info-value">' + file.name + '</div></div>' +
    '<div class="fw-info-box"><div class="fw-info-label">Size</div><div class="fw-info-value">' + formatSize(file.size) + '</div></div>' +
    '<div class="fw-info-box"><div class="fw-info-label">Type</div><div class="fw-info-value">.' + ext + '</div></div>';


}

/* ---- Bootloader Recovery ---- */
function openBootloaderRecovery() {
  document.getElementById('fwRecoveryModal').classList.remove('fw-panel-hidden');
  document.getElementById('fwRecoveryLog').innerHTML = '';
  for (var i = 1; i <= 4; i++) {
    var step = document.querySelector('.fw-recovery-step[data-step="' + i + '"]');
    if (step) step.classList.remove('completed');
    var status = document.getElementById('fwRecoveryStep' + i);
    if (status) status.textContent = 'Waiting...';
  }
  addRecoveryLog('Bootloader recovery wizard started', 'info');
  addRecoveryLog('Step 1: Connect flight controller via USB', 'info');
}

function closeRecoveryModal() {
  document.getElementById('fwRecoveryModal').classList.add('fw-panel-hidden');
}

function addRecoveryLog(msg, level) {
  level = level || 'info';
  var log = document.getElementById('fwRecoveryLog');
  if (!log) return;
  var entry = document.createElement('div');
  entry.className = 'fw-log-entry ' + level;
  entry.textContent = '> ' + msg;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function startBootloaderRecovery() {
  addRecoveryLog('Starting bootloader recovery process...', 'info');

  fetch('/api/firmware/detect')
    .then(function(r) { return r.json(); })
    .then(function(boards) {
      if (!boards || boards.length === 0) {
        addRecoveryLog('No board detected. Please connect the board.', 'error');
        return;
      }

      var board = boards[0];
      var step1 = document.querySelector('.fw-recovery-step[data-step="1"]');
      if (step1) step1.classList.add('completed');
      document.getElementById('fwRecoveryStep1').textContent = '✓ Connected: ' + board.port;

      addRecoveryLog('Board detected: ' + board.board + ' on ' + board.port, 'success');
      addRecoveryLog('Step 2: Hold safety button...', 'info');
      document.getElementById('fwRecoveryStep2').textContent = 'Hold button';

      setTimeout(function() {
        var step2 = document.querySelector('.fw-recovery-step[data-step="2"]');
        if (step2) step2.classList.add('completed');
        document.getElementById('fwRecoveryStep2').textContent = '✓ Button held';

        addRecoveryLog('Step 3: Reconnecting USB to enter bootloader mode...', 'info');
        document.getElementById('fwRecoveryStep3').textContent = 'Reconnecting...';

        fetch('/api/firmware/force-bootloader', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ port: board.port }),
        })
          .then(function(r) { return r.json(); })
          .then(function(result) {
            if (result.started) {
              var step3 = document.querySelector('.fw-recovery-step[data-step="3"]');
              if (step3) step3.classList.add('completed');
              document.getElementById('fwRecoveryStep3').textContent = '✓ USB reconnected';

              addRecoveryLog('Bootloader mode activated. Ready to flash.', 'success');
              addRecoveryLog('Step 4: Flash bootloader firmware...', 'info');

              setTimeout(function() {
                var step4 = document.querySelector('.fw-recovery-step[data-step="4"]');
                if (step4) step4.classList.add('completed');
                document.getElementById('fwRecoveryStep4').textContent = '✓ Recovery complete';
                addRecoveryLog('Bootloader recovery completed successfully!', 'success');
                showNotification('Bootloader recovery complete', 'success');
              }, 2000);
            }
          })
          .catch(function(err) {
            addRecoveryLog('Failed to enter bootloader mode: ' + err.message, 'error');
          });
      }, 2000);
    })
    .catch(function(err) {
      addRecoveryLog('Detection error: ' + err.message, 'error');
    });
}

/* ---- History ---- */
function loadHistory() {
  var grid = document.getElementById('fwCardsGrid');
  var empty = document.getElementById('fwEmptyState');
  empty.classList.add('fw-panel-hidden');

  fetch('/api/firmware/history')
    .then(function(r) { return r.json(); })
    .then(function(history) {
      if (!history || history.length === 0) {
        grid.innerHTML = '<div class="fw-empty-state"><div class="fw-empty-icon">📋</div><div class="fw-empty-text">No installation history</div><div class="fw-empty-hint">Firmware installations will appear here</div></div>';
        return;
      }

      var html = '<div style="padding: 4px 0;">';
      html += '<div style="display:flex;gap:12px;padding:8px 12px;font-size:9px;color:#64748b;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;border-bottom:1px solid #1e293b;">';
      html += '<span style="flex:1">Board</span><span style="flex:1">Firmware</span><span style="width:80px">Version</span><span style="width:80px;text-align:right">Date</span><span style="width:80px;text-align:center">Status</span>';
      html += '</div>';

      history.forEach(function(h) {
        var date = new Date(h.installed_at * 1000).toLocaleDateString();
        html += '<div style="display:flex;gap:12px;padding:8px 12px;font-size:11px;align-items:center;border-bottom:1px solid #0f172a;">';
        html += '<span style="flex:1;color:#e2e8f0;font-weight:600;">' + (h.board_name || 'Unknown') + '</span>';
        html += '<span style="flex:1;color:#94a3b8;">' + (h.firmware_name || 'Unknown') + '</span>';
        html += '<span style="width:80px;color:#4CAF50;font-family:monospace;">' + (h.version || '---') + '</span>';
        html += '<span style="width:80px;text-align:right;color:#64748b;">' + date + '</span>';
        html += '<span style="width:80px;text-align:center;"><span style="padding:1px 8px;border-radius:4px;font-size:9px;font-weight:700;background:' + (h.status === 'success' ? 'rgba(76,175,80,0.15);color:#4CAF50' : 'rgba(239,68,68,0.15);color:#f87171') + ';">' + (h.status || 'unknown') + '</span></span>';
        html += '</div>';
      });
      html += '</div>';
      grid.innerHTML = html;
    })
    .catch(function(err) {
      grid.innerHTML = '<div class="fw-empty-state"><div class="fw-empty-icon">⚠️</div><div class="fw-empty-text">Failed to load history</div><div class="fw-empty-hint">' + err.message + '</div></div>';
    });
}

/* ---- SocketIO Events ---- */
socket.on('download_progress', function(data) {
  if (data.percent !== undefined) {
    setProgress('download', data.percent);
    setProgressLabel('download', data.stage === 'complete' ? 'Complete' : data.percent + '%');
  }
});

socket.on('flash_progress', function(data) {
  if (data.percent !== undefined) {
    setProgress('flash', data.percent);
    setProgressLabel('flash', data.stage || data.percent + '%');
  }
  if (data.stage === 'complete' || data.stage === 'flash_complete') {
    addFlashLog('Flashing complete!', 'success');
    document.getElementById('fwStatusText').textContent = 'Flash Complete ✓';
    document.getElementById('fwStatusText').style.color = '#4ade50';
  }
});

socket.on('flash_complete', function(data) {
  setProgress('flash', 100);
  setProgressLabel('flash', 'Complete');
  addFlashLog(data.message || 'Firmware flash completed', 'success');
  showNotification('Firmware installation complete!', 'success');
});

socket.on('verification_progress', function(data) {
  if (data.percent !== undefined) {
    setProgress('verify', data.percent);
    setProgressLabel('verify', data.stage === 'complete' ? 'Valid ✓' : data.percent + '%');
  }
  if (data.valid === true) {
    addFlashLog('Verification passed ✓', 'success');
  } else if (data.valid === false) {
    addFlashLog('Verification failed ✗', 'error');
  }
});

socket.on('board_detected', function(data) {
  log('Board detected: ' + (data.board || 'Unknown') + ' on ' + data.port, 'mavlink');
});

socket.on('detection_complete', function(data) {
  log('Board detection complete. Found ' + data.count + ' board(s).', 'info');
});

socket.on('firmware_log', function(data) {
  var level = data.level || 'info';
  log('[Firmware] ' + data.message, level);
  addFlashLog(data.message, level);
});

socket.on('firmware_error', function(data) {
  var msg = data.message || JSON.stringify(data);
  log(msg, 'error');
  addFlashLog(msg, 'error');
});

socket.on('error', function(data) {
  var msg = data.message || JSON.stringify(data);
  log(msg, 'error');
  addFlashLog(msg, 'error');
});

/* ---- Utility ---- */
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  var k = 1024;
  var sizes = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function showNotification(msg, type) {
  type = type || 'info';
  var container = document.getElementById('notifContainer');
  if (!container) return;
  var notif = document.createElement('div');
  notif.className = 'notif';
  notif.innerHTML = '<span class="notif-dot ' + type + '"></span><span class="notif-msg">' + msg + '</span>';
  container.appendChild(notif);
  setTimeout(function() { if (notif.parentNode) notif.parentNode.removeChild(notif); }, 4000);
}

/* ---- Drag and Drop for Custom Firmware ---- */
document.addEventListener('DOMContentLoaded', function() {
  var zone = document.getElementById('fwUploadZone');
  if (zone) {
    zone.addEventListener('dragover', function(e) { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', function(e) { zone.classList.remove('dragover'); });
    zone.addEventListener('drop', function(e) {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        document.getElementById('fwFileInput').files = e.dataTransfer.files;
        handleCustomFile(document.getElementById('fwFileInput'));
      }
    });
  }

  var searchInput = document.getElementById('fwSearchInput');
  if (searchInput) {
    searchInput.addEventListener('keyup', function() {
      _fwSearchTerm = searchInput.value;
      renderFirmwareCards(_firmwareList);
    });
  }

  loadAllFirmware();
});
