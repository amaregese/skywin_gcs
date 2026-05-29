const socket = io();
let allParams = [];
let loading = false;

socket.on('connect', () => {
  requestParams();
});

socket.on('param_value', (data) => {
  const existing = allParams.findIndex(p => p.name === data.name);
  if (existing >= 0) {
    allParams[existing] = data;
  } else {
    allParams.push(data);
  }
  allParams.sort((a, b) => a.index - b.index);
  renderParams();
  document.getElementById('paramCount').textContent =
    `${allParams.length} / ${data.count} parameters loaded`;

  if (allParams.length === data.count) {
    loading = false;
    document.getElementById('refreshBtn').disabled = false;
    document.getElementById('refreshBtn').textContent = '\u21bb Refresh';
    const status = document.getElementById('paramStatus');
    status.style.display = 'none';
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

function requestParams() {
  allParams = [];
  loading = true;
  document.getElementById('paramBody').innerHTML =
    '<tr><td colspan="5" style="text-align:center;padding:40px;color:#64748b;">Requesting parameters...</td></tr>';
  document.getElementById('refreshBtn').disabled = true;
  document.getElementById('refreshBtn').textContent = 'Loading...';
  document.getElementById('paramCount').textContent = '0 parameters loaded';
  const status = document.getElementById('paramStatus');
  status.textContent = '\u23f3 Requesting parameter list from FCU...';
  status.style.display = '';
  socket.emit('param_request');
}

function renderParams() {
  const search = (document.getElementById('paramSearch').value || '').toLowerCase();
  const tbody = document.getElementById('paramBody');
  tbody.innerHTML = '';

  const filtered = search
    ? allParams.filter(p => p.name.toLowerCase().includes(search))
    : allParams;

  if (filtered.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5" style="text-align:center;padding:40px;color:#64748b;">' +
      (search ? 'No parameters match your search' : 'No parameters loaded') +
      '</td></tr>';
    return;
  }

  filtered.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color:#475569">${p.index + 1}</td>
      <td class="param-name">${p.name}</td>
      <td style="color:#64748b;font-size:11px">${p.type}</td>
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
    tbody.appendChild(tr);
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
  const param = allParams[index];
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
}

function filterParams() {
  renderParams();
}
