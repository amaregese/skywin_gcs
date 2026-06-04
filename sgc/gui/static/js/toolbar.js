// Shared toolbar state — loaded on every page for consistent indicators

socket.on('state_update', function(data) {
  var btn = document.getElementById('connectBtn');
  if (btn) {
    if (data.connected) {
      btn.textContent = 'DISCONNECT';
      btn.className = 'connected';
      btn.disabled = false;
    } else {
      btn.textContent = 'CONNECT';
      btn.className = '';
      btn.disabled = false;
    }
  }

  var hb = document.getElementById('heartbeatInd');
  if (hb) {
    if (data.connected) {
      hb.textContent = '\u25CF Heartbeat: OK';
      hb.style.color = '#22c55e';
    } else {
      hb.textContent = '\u25CF Heartbeat: --';
      hb.style.color = '#64748b';
    }
  }

  var sysid = document.getElementById('sysidInd');
  if (sysid) {
    sysid.textContent = data.connected
      ? 'SysID: ' + (data.sysid || '?') + ' | CompID: ' + (data.compid || '?')
      : 'SysID: --';
  }

  setText('tt_type', data.vehicle_type || '---');
  setText('tt_firmware', data.firmware ? data.firmware.substring(0, 12) : '---');

  var cpu = document.getElementById('tt_cpu_load');
  if (cpu) {
    if (data.connected && data.cpu_load != null) {
      cpu.textContent = 'CPU: ' + data.cpu_load.toFixed(1) + '%';
      cpu.style.color = data.cpu_load > 80 ? '#ef4444' : '#e2e8f0';
    } else {
      cpu.textContent = 'CPU: ---';
      cpu.style.color = '#64748b';
    }
  }

  var statusMsg = document.getElementById('statusMessage');
  if (statusMsg) {
    statusMsg.textContent = data.connected ? 'Connected' : 'Not connected';
  }
});

function setText(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}

// --- Connection ---

function toggleConnection() {
  var btn = document.getElementById('connectBtn');
  if (btn && btn.classList.contains('connected')) {
    disconnectVehicle();
  } else {
    showConnectDialog();
  }
}

function disconnectVehicle() {
  socket.emit('disconnect_vehicle');
  var btn = document.getElementById('connectBtn');
  if (btn) { btn.textContent = 'CONNECT'; btn.className = ''; btn.disabled = false; }
}

function connectVehicle(type, port, baud, host, portNum) {
  log('Connecting: ' + type + (port ? ' ' + port : '') + ' @ ' + baud + ' baud...', 'info');
  var btn = document.getElementById('connectBtn');
  if (btn) { btn.textContent = 'CONNECTING...'; btn.disabled = true; }
  socket.emit('connect_vehicle', {
    type: type, port: port, baud: parseInt(baud),
    host: host || '', port_num: parseInt(portNum) || 0,
  });
}

function showConnectDialog() {
  var overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML =
    '<div class="dialog-box conn-dialog">' +
      '<div class="conn-header">' +
        '<h3>Connect to Vehicle</h3>' +
        '<div class="conn-close" onclick="this.closest(\'.dialog-overlay\').remove()">\u2715</div>' +
      '</div>' +

      '<div class="conn-devices" style="padding:0 24px">' +
        '<div class="conn-section-title" style="padding:0">Simulator</div>' +
        '<div class="conn-device-card" style="cursor:default">' +
          '<div class="conn-device-icon">\uD83D\uDCF6</div>' +
          '<div class="conn-device-info">' +
            '<div class="conn-device-name">SITL (Software In The Loop)</div>' +
            '<div class="conn-device-detail">UDP \u2022 127.0.0.1:14550</div>' +
          '</div>' +
          '<button class="conn-device-connect" id="connSitlBtn">Connect</button>' +
        '</div>' +
      '</div>' +

      '<div id="connDetectedSection">' +
        '<div class="conn-section-title">Detected Devices <span class="conn-refresh" id="connRefreshBtn">\u21bb Refresh</span></div>' +
        '<div id="connDeviceList" class="conn-devices">' +
          '<div class="conn-scanning"><div class="conn-spinner"></div> Scanning serial ports for FCU...</div>' +
        '</div>' +
      '</div>' +

      '<div id="connError" class="conn-error" style="display:none"></div>' +

      '<div class="conn-divider">or</div>' +

      '<details class="conn-manual" id="connManualDetails">' +
        '<summary class="conn-manual-summary">Connect manually (specify port &amp; baud)</summary>' +
        '<div class="conn-manual-body">' +
          '<div class="dialog-row">' +
            '<label style="width:80px">Type:</label>' +
            '<select id="connManualType" class="conn-select">' +
              '<option value="serial">Serial Port</option>' +
              '<option value="tcp_client">TCP Client</option>' +
              '<option value="tcp_server">TCP Server</option>' +
              '<option value="udp">UDP</option>' +
            '</select>' +
          '</div>' +
          '<div id="connSerialFields">' +
            '<div class="dialog-row">' +
              '<label style="width:80px">Port:</label>' +
              '<select id="connManualPort" class="conn-select"><option value="">Loading...</option></select>' +
            '</div>' +
            '<div class="dialog-row">' +
              '<label style="width:80px">Baud:</label>' +
              '<select id="connManualBaud" class="conn-select">' +
                '<option>9600</option><option>19200</option><option>38400</option>' +
                '<option selected>57600</option><option>115200</option><option>921600</option>' +
              '</select>' +
            '</div>' +
          '</div>' +
          '<div id="connNetFields" style="display:none">' +
            '<div class="dialog-row">' +
              '<label style="width:80px">Host:</label>' +
              '<input type="text" id="connManualHost" value="127.0.0.1" class="conn-input" />' +
            '</div>' +
            '<div class="dialog-row">' +
              '<label style="width:80px">Port:</label>' +
              '<input type="text" id="connManualPortNum" value="14550" class="conn-input" />' +
            '</div>' +
          '</div>' +
          '<button class="conn-btn-primary" id="connManualBtn" onclick="manualConnect()">Connect</button>' +
        '</div>' +
      '</details>' +
    '</div>';

  document.body.appendChild(overlay);

  var typeSel = overlay.querySelector('#connManualType');
  var serialFields = overlay.querySelector('#connSerialFields');
  var netFields = overlay.querySelector('#connNetFields');
  typeSel.addEventListener('change', function() {
    var v = this.value;
    serialFields.style.display = v === 'serial' ? '' : 'none';
    netFields.style.display = (v === 'tcp_client' || v === 'tcp_server' || v === 'udp') ? '' : 'none';
  });

  loadManualPorts(overlay);
  scanDevices(overlay);

  overlay.querySelector('#connRefreshBtn').addEventListener('click', function() {
    scanDevices(overlay);
  });
  overlay.querySelector('#connSitlBtn').addEventListener('click', function() {
    this.textContent = 'Connecting...';
    this.disabled = true;
    connectVehicle('udp', '', '57600', '127.0.0.1', '14550');
    overlay.remove();
  });
}

function scanDevices(overlay) {
  var list = overlay.querySelector('#connDeviceList');
  var error = overlay.querySelector('#connError');
  error.style.display = 'none';
  list.innerHTML = '<div class="conn-scanning"><div class="conn-spinner"></div> Scanning serial ports for FCU...</div>';

  fetch('/api/auto_scan')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var devices = data.found || [];
      if (devices.length === 0) {
        list.innerHTML = '<div class="conn-no-devices"><strong>No FCU detected</strong><br>Make sure the device is connected and powered.<br>If using macOS, check USB serial driver (CH340/CP210x/FTDI).<br>Try a different USB cable or port, or connect manually below.</div>';
        overlay.querySelector('#connManualDetails').open = true;
        return;
      }
      list.innerHTML = '';
      devices.forEach(function(d) {
        var card = document.createElement('div');
        card.className = 'conn-device-card';
        card.innerHTML =
          '<div class="conn-device-icon">\u26A1</div>' +
          '<div class="conn-device-info">' +
            '<div class="conn-device-name">' + escHtml(d.description || d.device) + '</div>' +
            '<div class="conn-device-detail">' + d.device + ' \u2022 ' + d.sysid + ':' + d.compid + ' \u2022 ' + d.baud + ' baud</div>' +
          '</div>' +
          '<div class="conn-device-badge">FCU</div>' +
          '<button class="conn-device-connect">Connect</button>';
        list.appendChild(card);

        card.querySelector('.conn-device-connect').addEventListener('click', function() {
          this.textContent = 'Connecting...';
          this.disabled = true;
          card.classList.add('connecting');
          connectVehicle('serial', d.device, d.baud, '', '');
          overlay.remove();
        });
      });
    })
    .catch(function() {
      list.innerHTML = '<div class="conn-no-devices"><strong>Scan failed</strong><br>Could not scan serial ports. Check permissions.</div>';
    });
}

function loadManualPorts(overlay) {
  fetch('/api/ports')
    .then(function(r) { return r.json(); })
    .then(function(ports) {
      var sel = overlay.querySelector('#connManualPort');
      sel.innerHTML = '';
      if (ports.length === 0) {
        sel.innerHTML = '<option value="">No ports found</option>';
        return;
      }
      ports.forEach(function(p) {
        var o = document.createElement('option');
        o.value = p.device;
        o.textContent = p.device + '  (' + p.description + ')';
        sel.appendChild(o);
      });
    })
    .catch(function() {
      var sel = overlay.querySelector('#connManualPort');
      sel.innerHTML = '<option value="">Error loading ports</option>';
    });
}

function manualConnect() {
  var type = document.querySelector('#connManualType').value;
  var port = document.querySelector('#connManualPort')?.value || '';
  var baud = document.querySelector('#connManualBaud')?.value || '57600';
  var host = document.querySelector('#connManualHost')?.value || '';
  var portNum = document.querySelector('#connManualPortNum')?.value || '0';

  if (type === 'serial' && !port) { log('Select a serial port', 'warning'); return; }
  var btn = document.querySelector('#connManualBtn');
  btn.textContent = 'Connecting...';
  btn.disabled = true;

  connectVehicle(
    type,
    type === 'serial' ? port : '',
    type === 'serial' ? baud : baud,
    type !== 'serial' ? host : '',
    type !== 'serial' ? portNum : ''
  );
  var overlay = btn.closest('.dialog-overlay');
  if (overlay) overlay.remove();
}

function escHtml(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
