const socket = io();
let allParams = [];
let loading = false;
let _totalCount = 0;
let _pendingReboot = new Set();
socket.on('connect', () => {
  fetch('/api/params/snapshot')
    .then(r => r.json())
    .then(data => {
      if (data.params && data.params.length > 0) {
        allParams = data.params;
        allParams.forEach(p => { p._initial = p.value; });
        _totalCount = data.count;
        renderParams();
        document.getElementById('paramCount').textContent =
          `${allParams.length} / ${_totalCount} parameters loaded`;
      } else {
        requestParams();
      }
    })
    .catch(() => requestParams());
});

socket.on('param_value', (data) => {
  const existing = allParams.findIndex(p => p.name === data.name);
  if (existing >= 0) {
    data._initial = allParams[existing]._initial;
    allParams[existing] = data;
  } else {
    if (data.index !== 65535) {
      data._initial = data.value;
      allParams.push(data);
    }
  }
  allParams.sort((a, b) => a.index - b.index);
  renderParams();
  document.getElementById('paramCount').textContent =
    `${allParams.length} / ${data.count} parameters loaded`;
  if (allParams.length === data.count) {
    loading = false;
    document.getElementById('refreshBtn').disabled = false;
    document.getElementById('refreshBtn').textContent = '\u21bb Refresh';
    document.getElementById('paramStatus').style.display = 'none';
  }
});

socket.on('log', (data) => {
  if (data.level === 'error') {
    const status = document.getElementById('paramStatus');
    status.textContent = '\u26a0 ' + data.message;
    status.style.display = '';
    loading = false;
    document.getElementById('refreshBtn').disabled = false;
    document.getElementById('refreshBtn').textContent = '\u21bb Refresh';
  }
});

function getCategory(name) {
  const idx = name.indexOf('_');
  return idx > 0 ? name.substring(0, idx) : name;
}

function groupByCategory(params) {
  const groups = {};
  params.forEach(p => {
    const cat = getCategory(p.name);
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(p);
  });
  const keys = Object.keys(groups).sort();
  return keys.map(k => ({ category: k, params: groups[k] }));
}

function requestParams() {
  allParams = [];
  loading = true;
  document.getElementById('paramWrap').innerHTML =
    '<div style="text-align:center;padding:40px;color:#64748b;">Requesting parameters...</div>';
  document.getElementById('refreshBtn').disabled = true;
  document.getElementById('refreshBtn').textContent = 'Loading...';
  document.getElementById('paramCount').textContent = '0 parameters loaded';
  const status = document.getElementById('paramStatus');
  status.textContent = '\u23f3 Requesting parameter list from FCU...';
  status.style.display = '';
  socket.emit('param_request');
}

function isChanged(p) {
  if (p._initial === undefined) return false;
  return formatValue(p.value, p.type) !== formatValue(p._initial, p.type);
}

function renderParams() {
  const search = (document.getElementById('paramSearch').value || '').toLowerCase();
  const showChanged = document.getElementById('changedOnly').checked;
  const wrap = document.getElementById('paramWrap');
  wrap.innerHTML = '';

  const filtered = allParams.filter(p => {
    if (search && !p.name.toLowerCase().includes(search)) return false;
    if (showChanged && !isChanged(p)) return false;
    return true;
  });

  if (filtered.length === 0) {
    wrap.innerHTML =
      '<div style="text-align:center;padding:40px;color:#64748b;">' +
      (search ? 'No parameters match your search' : 'No parameters loaded') +
      '</div>';
    return;
  }

  const groups = groupByCategory(filtered);
  groups.forEach((g, gi) => {
    const section = document.createElement('div');

    const header = document.createElement('div');
    header.className = 'cat-header';
    header.innerHTML = `
      <span class="arrow">&#9660;</span>
      <span class="cat-name">${g.category}</span>
      <span class="cat-count">${g.params.length} params</span>
    `;
    let open = true;
    header.addEventListener('click', () => {
      open = !open;
      body.classList.toggle('open', open);
      header.querySelector('.arrow').innerHTML = open ? '&#9660;' : '&#9654;';
    });

    const body = document.createElement('div');
    body.className = 'cat-body open';

    const table = document.createElement('table');
    table.className = 'param-table';

    g.params.forEach(p => {
      const tr = document.createElement('tr');
      const desc = (p.description || '').replace(/"/g, '&quot;');
      const label = p.human_name ? `${p.human_name}<br><span class="param-desc">${p.description || ''}</span>` : '';
      tr.innerHTML = `
        <td class="param-idx">${p.index + 1}</td>
        <td class="param-name" ${desc ? `title="${desc}"` : ''}>
          ${p.name}${p.human_name ? `<br><span class="param-desc">${p.human_name}</span>` : ''}
        </td>
        <td class="param-type">${p.type}</td>
        <td class="param-value">
          <input type="text" id="val_${p.index}" value="${formatValue(p.value, p.type)}"
                 data-original="${formatValue(p.value, p.type)}"
                 oninput="markChanged(${p.index})" />
        </td>
        <td>
          <button class="save-btn" id="save_${p.index}" style="display:none"
                  onclick="saveParam(${p.index})">Save</button>
        </td>
      `;
      table.appendChild(tr);
    });

    body.appendChild(table);
    section.appendChild(header);
    section.appendChild(body);
    wrap.appendChild(section);
  });
}

function formatValue(val, type) {
  if (type === 'float' || type === 'double') {
    return Number(val).toFixed(4);
  }
  return String(Number.isInteger(val) ? val : Math.round(val * 10000) / 10000);
}

function markChanged(index) {
  const input = document.getElementById(`val_${index}`);
  const save = document.getElementById(`save_${index}`);
  if (!input || !save) return;
  const changed = input.value !== input.dataset.original;
  input.classList.toggle('changed', changed);
  save.style.display = changed ? '' : 'none';
}

function saveParam(index) {
  const param = allParams.find(p => p.index === index);
  if (!param) return;
  const input = document.getElementById(`val_${index}`);
  const value = parseFloat(input.value);
  if (isNaN(value)) {
    input.classList.add('changed');
    return;
  }
  socket.emit('param_set', { name: param.name, value });
  input.dataset.original = input.value;
  input.classList.remove('changed');
  document.getElementById(`save_${index}`).style.display = 'none';
  if (param.reboot) {
    _pendingReboot.add(param.name);
    renderRebootBanner();
  }
}

function renderRebootBanner() {
  const banner = document.getElementById('rebootBanner');
  if (!banner) return;
  if (_pendingReboot.size === 0) {
    banner.style.display = 'none';
    return;
  }
  banner.style.display = 'flex';
  banner.innerHTML = `
    <span>\u26a0 ${_pendingReboot.size} parameter${_pendingReboot.size > 1 ? 's' : ''} require${_pendingReboot.size === 1 ? 's' : ''} a reboot to take effect.</span>
    <div style="display:flex;gap:8px">
      <button class="refresh-btn" onclick="rebootFCU()" style="background:#ef4444;color:#fff;border:none;padding:6px 16px;border-radius:4px;cursor:pointer">Reboot FCU</button>
      <button onclick="dismissRebootBanner()" style="background:transparent;color:#94a3b8;border:1px solid #475569;padding:6px 16px;border-radius:4px;cursor:pointer">Dismiss</button>
    </div>
  `;
}

function rebootFCU() {
  socket.emit('reboot_fcu');
}

function dismissRebootBanner() {
  _pendingReboot.clear();
  renderRebootBanner();
}

function saveParamFile() {
  const a = document.createElement('a');
  a.href = '/api/params/download';
  a.download = 'params.param';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function loadParamFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  const status = document.getElementById('paramStatus');
  status.textContent = '\u23f3 Uploading parameters...';
  status.style.display = '';
  try {
    const res = await fetch('/api/params/upload', { method: 'POST', body: formData });
    const data = await res.json();
    status.textContent = `\u2705 Loaded ${data.loaded} params` + (data.errors.length ? `, ${data.errors.length} errors` : '');
    status.style.display = '';
    if (data.errors.length) {
      status.textContent += ' (see console)';
      data.errors.forEach(e => console.warn('Param load error:', e));
    }
    requestParams();
  } catch (e) {
    const status = document.getElementById('paramStatus');
    status.textContent = '\u26a0 Upload failed: ' + e.message;
    status.style.display = '';
  }
  event.target.value = '';
}

function filterParams() {
  renderParams();
}
