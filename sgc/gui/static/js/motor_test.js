var socket = io({ autoConnect: true });

var _mtTesting = false;
var _mtTimer = null;
var _mtConnected = false;
var _mtArmed = false;

socket.on('connect', function() {
  mtLog('Socket connected', 'info');
  updateMtSafety();
});

socket.on('disconnect', function() {
  _mtConnected = false;
  mtLog('Socket disconnected', 'warning');
  updateMtSafety();
});

socket.on('state_update', function(data) {
  if (data.hasOwnProperty('connected')) _mtConnected = data.connected;
  if (data.hasOwnProperty('armed')) _mtArmed = data.armed;
  updateMtSafety();
});

socket.on('log', function(data) {
  mtLog(data.message, data.level || 'info');
});

function updateMtSafety() {
  var connEl = document.getElementById('mtSafetyConnected');
  var armedEl = document.getElementById('mtSafetyArmed');
  if (_mtConnected) {
    connEl.className = 'mt-safety ok';
    connEl.innerHTML = '<span class="mt-safety-icon">&#x2713;</span><span>Connected to vehicle</span>';
  } else {
    connEl.className = 'mt-safety danger';
    connEl.innerHTML = '<span class="mt-safety-icon">&#x26A0;</span><span>Not connected to vehicle</span>';
  }
  if (_mtArmed) {
    armedEl.className = 'mt-safety danger';
    armedEl.innerHTML = '<span class="mt-safety-icon">&#x26A0;</span><span>DISARMED: Vehicle must be disarmed to test motors</span>';
  } else {
    armedEl.className = 'mt-safety ok';
    armedEl.innerHTML = '<span class="mt-safety-icon">&#x2713;</span><span>Vehicle is disarmed</span>';
  }
}

function selectMotor(n) {
  document.querySelectorAll('.mt-motor-btn').forEach(function(el) {
    el.classList.remove('active');
  });
  var btn = document.querySelector('.mt-motor-btn[data-motor="' + n + '"]');
  if (btn) btn.classList.add('active');
  document.getElementById('mtMotorSelect').value = n;
  document.getElementById('selectedMotorDisplay').textContent = 'M' + n;
}

function onMotorSelectChange() {
  var val = parseInt(document.getElementById('mtMotorSelect').value);
  selectMotor(val);
}

function updateMtThrottleDisplay() {
  var val = document.getElementById('mtThrottle').value;
  document.getElementById('mtThrottleVal').textContent = val + '%';
}

function setMtStatus(text, cls) {
  var el = document.getElementById('mtStatusBox');
  el.textContent = text;
  el.className = 'mt-status-box ' + (cls || 'idle');
}

function mtLog(msg, level) {
  level = level || 'info';
  var container = document.getElementById('mtLog');
  var empty = container.querySelector('.mt-log-empty');
  if (empty) empty.remove();

  var now = new Date();
  var time = now.toLocaleTimeString('en-US', { hour12: false });
  var entry = document.createElement('div');
  entry.className = 'mt-log-entry';
  entry.innerHTML = '<span class="mt-log-time">[' + time + ']</span><span class="mt-log-msg ' + level + '">' + escapeHtml(msg) + '</span>';
  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;

  var entries = container.querySelectorAll('.mt-log-entry');
  if (entries.length > 200) entries[0].remove();
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function clearMtLog() {
  var container = document.getElementById('mtLog');
  container.innerHTML = '<div class="mt-log-empty">Motor test events will appear here</div>';
}

function startMotorTest() {
  if (!_mtConnected) {
    setMtStatus('Cannot test: not connected to vehicle', 'stopped');
    mtLog('Cannot test motor: not connected', 'error');
    return;
  }
  if (_mtArmed) {
    setMtStatus('Cannot test: vehicle is armed', 'stopped');
    mtLog('Cannot test motor: vehicle is armed — disarm first', 'error');
    return;
  }

  var motor = parseInt(document.getElementById('mtMotorSelect').value);
  var throttle = parseInt(document.getElementById('mtThrottle').value);
  var duration = parseInt(document.getElementById('mtDuration').value) || 3;
  var type = parseInt(document.getElementById('mtTestType').value);

  if (duration < 1) duration = 1;
  if (duration > 60) duration = 60;

  _mtTesting = true;
  document.getElementById('mtStartBtn').disabled = true;
  document.getElementById('mtStopBtn').disabled = false;

  document.querySelectorAll('.mt-motor-btn').forEach(function(el) {
    el.classList.remove('running');
  });
  var motorBtn = document.querySelector('.mt-motor-btn[data-motor="' + motor + '"]');
  if (motorBtn) motorBtn.classList.add('running');

  setMtStatus('Running motor ' + motor + ' at ' + throttle + '%...', 'running');
  mtLog('Motor test STARTED: motor #' + motor + ' throttle=' + throttle + '% duration=' + duration + 's type=' + type, 'warning');

  socket.emit('motor_test', { motor: motor, type: type, throttle: throttle, timeout: duration });

  if (_mtTimer) clearTimeout(_mtTimer);
  _mtTimer = setTimeout(function() {
    _mtTesting = false;
    document.getElementById('mtStartBtn').disabled = false;
    document.getElementById('mtStopBtn').disabled = true;
    document.querySelectorAll('.mt-motor-btn').forEach(function(el) {
      el.classList.remove('running');
    });
    setMtStatus('Test complete', 'success');
    mtLog('Motor test completed', 'success');
  }, (duration * 1000) + 500);
}

function stopMotorTest() {
  if (_mtTimer) { clearTimeout(_mtTimer); _mtTimer = null; }
  _mtTesting = false;
  document.getElementById('mtStartBtn').disabled = false;
  document.getElementById('mtStopBtn').disabled = true;

  document.querySelectorAll('.mt-motor-btn').forEach(function(el) {
    el.classList.remove('running');
  });

  socket.emit('motor_test', { motor: 0, type: 0, throttle: 0, timeout: 1 });
  setMtStatus('Test stopped', 'stopped');
  mtLog('Motor test STOPPED by user', 'error');
}

document.addEventListener('DOMContentLoaded', function() {
  selectMotor(1);
});
