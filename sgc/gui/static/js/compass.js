var compassData = [];
var compassHealth = {};
var compassChanged = false;

window.addEventListener('load', function() {
  refreshCompassData();
  socket.on('compass_health', function(data) {
    var idx = data.index;
    compassHealth[idx] = data;
    updateHealthCard(idx);
  });
  socket.on('state_update', function(data) {
    var ekfMag = data.ekf_compass_variance;
    var el = document.getElementById('compassEKFVariance');
    if (el) {
      if (ekfMag !== undefined) {
        el.textContent = ekfMag.toFixed(4);
        el.className = 'health-field-value' + (ekfMag < 0.5 ? ' good' : ekfMag < 1.0 ? ' warn' : ' bad');
      }
    }
  });
});

function refreshCompassData() {
  var loading = document.getElementById('compassLoading');
  var content = document.getElementById('compassContent');
  loading.classList.remove('hidden');
  content.classList.add('hidden');
  fetch('/api/compass/list')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      loading.classList.add('hidden');
      if (data.error) {
        content.classList.add('hidden');
        showNotification(data.error, 'danger');
        return;
      }
      compassData = data.compasses || [];
      content.classList.remove('hidden');
      compassChanged = false;
      renderCompassTable();
      renderEnableControls();
      renderHealthCards();
      renderRecommendations();
      renderBanners();
    })
    .catch(function(err) {
      loading.classList.add('hidden');
      showNotification('Failed to load compass data: ' + err, 'danger');
    });
}

function renderCompassTable() {
  var tbody = document.getElementById('compassTbody');
  var noData = document.getElementById('compassNoData');
  tbody.innerHTML = '';
  if (!compassData.length) {
    noData.classList.remove('hidden');
    return;
  }
  noData.classList.add('hidden');
  compassData.forEach(function(c, i) {
    var tr = document.createElement('tr');
    tr.setAttribute('draggable', 'true');
    tr.dataset.index = i;
    tr.dataset.id = c.id;

    var prioClass = 'compass-prio-other';
    if (i === 0) prioClass = 'compass-prio-1';
    else if (i === 1) prioClass = 'compass-prio-2';
    else if (i === 2) prioClass = 'compass-prio-3';

    var busBadge = '';
    var busLower = (c.bus_type || '').toLowerCase();
    if (busLower.indexOf('can') !== -1) busBadge = 'badge badge-can';
    else if (busLower.indexOf('spi') !== -1) busBadge = 'badge badge-spi';
    else if (busLower.indexOf('i2c') !== -1) busBadge = 'badge badge-i2c';

    var healthClass = c.healthy ? 'healthy' : 'unknown';

    tr.innerHTML =
      '<td><span class="compass-drg">&#x2630;</span></td>' +
      '<td><span class="compass-prio-badge ' + prioClass + '">' + (i + 1) + '</span></td>' +
      '<td><span class="compass-name">' + escHtml(c.name) + '</span></td>' +
      '<td><span class="' + busBadge + '">' + escHtml(c.bus_type) + '</span></td>' +
      '<td><span class="compass-device-id">' + c.id + '</span></td>' +
      '<td><span class="compass-ext ' + (c.external ? 'yes' : 'no') + '">' + (c.external ? 'Yes' : 'No') + '</span></td>' +
      '<td><span class="compass-health-dot ' + healthClass + '" title="' + (c.healthy ? 'Healthy' : 'Unknown') + '"></span></td>' +
      '<td><input type="checkbox" class="compass-enabled" data-index="' + i + '" ' + (c.enabled ? 'checked' : '') + '></td>';

    tr.addEventListener('dragstart', function(e) {
      e.dataTransfer.setData('text/plain', this.dataset.index);
      setTimeout(function() { tr.classList.add('dragging'); }, 0);
    });
    tr.addEventListener('dragend', function() {
      tr.classList.remove('dragging');
      document.querySelectorAll('#compassTbody tr').forEach(function(r) {
        r.classList.remove('drag-over');
      });
    });
    tr.addEventListener('dragover', function(e) {
      e.preventDefault();
      document.querySelectorAll('#compassTbody tr').forEach(function(r) {
        r.classList.remove('drag-over');
      });
      tr.classList.add('drag-over');
    });
    tr.addEventListener('dragleave', function() {
      tr.classList.remove('drag-over');
    });
    tr.addEventListener('drop', function(e) {
      e.preventDefault();
      document.querySelectorAll('#compassTbody tr').forEach(function(r) {
        r.classList.remove('drag-over');
      });
      var fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
      var toIdx = parseInt(this.dataset.index);
      if (fromIdx === toIdx) return;
      var item = compassData.splice(fromIdx, 1)[0];
      compassData.splice(toIdx, 0, item);
      compassChanged = true;
      renderCompassTable();
      renderEnableControls();
      renderHealthCards();
      renderRecommendations();
      renderBanners();
    });

    tbody.appendChild(tr);
  });

  document.querySelectorAll('.compass-enabled').forEach(function(cb) {
    cb.addEventListener('change', function() {
      var idx = parseInt(this.dataset.index);
      compassData[idx].enabled = this.checked;
      compassChanged = true;
      renderRecommendations();
      renderBanners();
    });
  });
}

function renderEnableControls() {
  var container = document.getElementById('enableControls');
  container.innerHTML = '';
  if (!compassData.length) {
    container.innerHTML = '<div class="compass-empty">No compasses to control.</div>';
    return;
  }
  compassData.forEach(function(c, i) {
    var label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;margin-bottom:4px;background:#1e293b;border:1px solid #334155;border-radius:8px;cursor:pointer;';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = c.enabled;
    cb.style.cssText = 'width:18px;height:18px;accent-color:#818cf8;cursor:pointer;';
    cb.addEventListener('change', function() {
      compassData[i].enabled = this.checked;
      compassChanged = true;
      renderCompassTable();
      renderRecommendations();
      renderBanners();
    });
    var nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'font-size:13px;font-weight:600;color:#e2e8f0;';
    nameSpan.textContent = 'Compass ' + (i + 1) + ': ' + c.name;
    var detail = document.createElement('span');
    detail.style.cssText = 'font-size:11px;color:#64748b;margin-left:auto;';
    detail.textContent = (c.external ? 'External' : 'Internal') + ' \u00B7 ' + c.bus_type;
    label.appendChild(cb);
    label.appendChild(nameSpan);
    label.appendChild(detail);
    container.appendChild(label);
  });
}

function renderHealthCards() {
  var grid = document.getElementById('healthGrid');
  grid.innerHTML = '';
  if (!compassData.length) {
    grid.innerHTML = '<div class="compass-empty" style="grid-column:1/-1">No compass health data.</div>';
    return;
  }
  compassData.forEach(function(c, i) {
    var card = document.createElement('div');
    card.className = 'health-card';
    card.id = 'healthCard' + i;
    var healthId = c.healthy ? 'healthy' : 'unknown';
    card.innerHTML =
      '<div class="health-card-header">' +
        '<span class="compass-health-dot ' + healthId + '"></span>' +
        '<span class="health-card-name">' + escHtml(c.name) + '</span>' +
        '<span class="health-card-prio">Priority ' + (i + 1) + '</span>' +
      '</div>' +
      '<div class="health-field"><span class="health-field-label">Field Strength</span><span class="health-field-value" id="fieldStr' + i + '">---</span></div>' +
      '<div class="health-field"><span class="health-field-label">Offset X</span><span class="health-field-value" id="ofsX' + i + '">---</span></div>' +
      '<div class="health-field"><span class="health-field-label">Offset Y</span><span class="health-field-value" id="ofsY' + i + '">---</span></div>' +
      '<div class="health-field"><span class="health-field-label">Offset Z</span><span class="health-field-value" id="ofsZ' + i + '">---</span></div>' +
      '<div class="health-field"><span class="health-field-label">EKF Variance</span><span class="health-field-value" id="compassEKFVariance">---</span></div>' +
      '<div class="health-field"><span class="health-field-label">Calibration</span><span class="health-field-value" id="calState' + i + '">Unknown</span></div>';
    grid.appendChild(card);
  });
}

function updateHealthCard(idx) {
  var h = compassHealth[idx];
  if (!h) return;
  var fs = document.getElementById('fieldStr' + idx);
  if (fs) {
    fs.textContent = h.field_strength ? h.field_strength.toFixed(2) + ' mG' : '---';
    var fv = h.field_strength || 0;
    fs.className = 'health-field-value' + (fv > 200 && fv < 600 ? ' good' : fv > 0 ? ' warn' : '');
  }
  var ox = document.getElementById('ofsX' + idx);
  if (ox) ox.textContent = h.xmag !== undefined ? h.xmag : '---';
  var oy = document.getElementById('ofsY' + idx);
  if (oy) oy.textContent = h.ymag !== undefined ? h.ymag : '---';
  var oz = document.getElementById('ofsZ' + idx);
  if (oz) oz.textContent = h.zmag !== undefined ? h.zmag : '---';
}

function renderRecommendations() {
  var container = document.getElementById('recommendations');
  container.innerHTML = '';

  var hasExternal = compassData.some(function(c) { return c.external; });
  var hasInternal = compassData.some(function(c) { return !c.external; });
  var enabledInternal = compassData.some(function(c) { return !c.external && c.enabled; });

  if (hasExternal) {
    var wb = document.createElement('div');
    wb.className = 'warning-banner';
    wb.innerHTML =
      '<span class="warning-banner-icon">&#x26A0;</span>' +
      '<span class="warning-banner-text">External compass detected. Internal compasses may be affected by electrical interference. Consider disabling internal compasses.</span>' +
      '<div class="banner-actions"><button class="action-btn warning" onclick="useExternalOnly()" style="margin:0;white-space:nowrap">Use External Only</button></div>';
    container.appendChild(wb);
  }

  if (!hasExternal && hasInternal) {
    var ab = document.createElement('div');
    ab.className = 'advisory-banner';
    ab.innerHTML =
      '<span class="advisory-banner-icon">&#x2139;</span>' +
      '<span class="advisory-banner-text">Internal compasses may be susceptible to magnetic interference. For best results, use an external compass.</span>';
    container.appendChild(ab);
  }
}

function renderBanners() {
  var container = document.getElementById('compassBanners');
  container.innerHTML = '';

  var enabledCount = compassData.filter(function(c) { return c.enabled; }).length;
  if (enabledCount === 0) {
    var eb = document.createElement('div');
    eb.className = 'error-banner';
    eb.innerHTML =
      '<span class="error-banner-icon">&#x2716;</span>' +
      '<span class="error-banner-text">At least one compass must remain enabled. Please enable a compass before saving.</span>';
    container.appendChild(eb);
  } else {
    var onlyInternal = compassData.every(function(c) { return !c.external || !c.enabled; });
    if (onlyInternal) {
      var ab = document.createElement('div');
      ab.className = 'advisory-banner';
      ab.innerHTML =
        '<span class="advisory-banner-icon">&#x2139;</span>' +
        '<span class="advisory-banner-text">Internal compasses may be susceptible to magnetic interference.</span>';
      container.appendChild(ab);
    }
  }

  if (compassChanged) {
    var rb = document.createElement('div');
    rb.className = 'reboot-banner';
    rb.id = 'rebootBanner';
    rb.innerHTML =
      '<span class="reboot-banner-icon">&#x21BB;</span>' +
      '<span class="reboot-banner-text">Compass configuration changed. Reboot flight controller to apply changes.</span>' +
      '<div class="banner-actions">' +
        '<button class="action-btn warning" onclick="rebootFcu()" style="margin:0;white-space:nowrap">Reboot Now</button>' +
        '<button class="action-btn" onclick="dismissRebootBanner()" style="margin:0;white-space:nowrap">Apply Later</button>' +
      '</div>';
    container.appendChild(rb);
    document.getElementById('rebootNowBtn').classList.remove('hidden');
  } else {
    document.getElementById('rebootNowBtn').classList.add('hidden');
  }
}

function useExternalOnly() {
  compassData.forEach(function(c) {
    c.enabled = c.external;
  });
  compassData.sort(function(a, b) {
    if (a.external && !b.external) return -1;
    if (!a.external && b.external) return 1;
    return 0;
  });
  compassChanged = true;
  renderCompassTable();
  renderEnableControls();
  renderHealthCards();
  renderRecommendations();
  renderBanners();
  showNotification('External compass set as primary. Internal compasses disabled.', 'success');
}

function dismissRebootBanner() {
  compassChanged = false;
  renderBanners();
  document.getElementById('rebootNowBtn').classList.add('hidden');
}

function saveCompassConfig() {
  var enabledCount = compassData.filter(function(c) { return c.enabled; }).length;
  if (enabledCount === 0) {
    showNotification('At least one compass must remain enabled.', 'danger');
    return;
  }

  var saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  var priorities = compassData.map(function(c) { return c.id; });
  var enabled = compassData.filter(function(c) { return c.enabled; }).map(function(c) { return c.id; });

  fetch('/api/compass/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priorities: priorities, enabled: enabled })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Configuration';
    if (data.success) {
      compassChanged = false;
      showNotification('Compass configuration saved. Reboot required.', 'success');
      renderBanners();
      document.getElementById('rebootNowBtn').classList.remove('hidden');
    } else {
      showNotification('Failed to save: ' + (data.error || 'Unknown error'), 'danger');
    }
  })
  .catch(function(err) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Configuration';
    showNotification('Error saving: ' + err, 'danger');
  });
}

function rebootFcu() {
  if (!socket || !socket.connected) {
    showNotification('Not connected to vehicle', 'danger');
    return;
  }
  socket.emit('reboot_fcu');
  showNotification('Reboot command sent to flight controller.', 'info');
}

function showNotification(msg, level) {
  var container = document.getElementById('notifContainer');
  var notif = document.createElement('div');
  notif.className = 'notif';
  notif.innerHTML = '<span class="notif-dot ' + level + '"></span><span class="notif-msg">' + escHtml(msg) + '</span>';
  container.appendChild(notif);
  setTimeout(function() {
    notif.style.transition = 'opacity 0.3s';
    notif.style.opacity = '0';
    setTimeout(function() { notif.remove(); }, 300);
  }, 4000);
}

function escHtml(str) {
  if (!str) return '';
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
