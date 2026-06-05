// Horizontal Telemetry Waterfall — dot-matrix bar graph
// Each metric is a row of dots: full color (left) → fading → empty dots (right)

var _wfCanvas = null;
var _wfCtx = null;
var _lastWaterfallData = {};

var WF_METRICS = [
  { key: 'alt',        label: 'ALT', max: 100,  color: '#0ea5e9', fmt: function(v) { return (v || 0).toFixed(1) + 'm'; } },
  { key: 'ground_speed', label: 'SPD', max: 30,   color: '#22c55e', fmt: function(v) { return (v || 0).toFixed(1) + 'm/s'; } },
  { key: 'battery_remaining', label: 'BAT', max: 100,  color: '#eab308', fmt: function(v) { return (_lastWaterfallData.battery_voltage || 0).toFixed(1) + 'V'; } },
  { key: 'satellites', label: 'SAT', max: 20,   color: '#a78bfa', fmt: function(v) { return (v || 0) + ''; } },
  { key: 'hdop',       label: 'HDOP', max: 3,    color: '#f97316', fmt: function(v) { return (v || 0).toFixed(1); } },
];

function initWaterfall(canvasId) {
  _wfCanvas = document.getElementById(canvasId);
  if (!_wfCanvas) return;
  _wfCtx = _wfCanvas.getContext('2d');
  resizeWaterfall();
  window.addEventListener('resize', resizeWaterfall);
  drawWaterfall(_lastWaterfallData || {});
}

function resizeWaterfall() {
  if (!_wfCanvas) return;
  var parent = _wfCanvas.parentElement;
  var rect = parent.getBoundingClientRect();
  _wfCanvas.width = rect.width;
  _wfCanvas.height = rect.height;
  drawWaterfall(_lastWaterfallData || {});
}

function updateWaterfall(data) {
  _lastWaterfallData = data;
  if (_wfCtx) drawWaterfall(data);
}

function drawWaterfall(data) {
  var ctx = _wfCtx;
  var w = _wfCanvas.width;
  var h = _wfCanvas.height;
  if (w < 10 || h < 10) return;

  ctx.clearRect(0, 0, w, h);

  var connected = data.connected;
  var metrics = connected ? WF_METRICS : [];

  if (metrics.length === 0) {
    ctx.fillStyle = '#334155';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('-- no telemetry --', w / 2, h / 2);
    return;
  }

  var rowH = h / metrics.length;
  var pad = Math.max(1, Math.min(rowH * 0.18, 4));
  var dotY = function(row) { return row * rowH + rowH / 2; };
  var labelW = 64;

  var dotR = Math.max(1.5, Math.min((rowH - pad * 2) * 0.35, 4));
  var dotGap = dotR * 2 + 2.5;
  var maxDots = Math.floor((w - labelW - 8) / dotGap);
  if (maxDots < 3) maxDots = 3;

  // For HDOP, invert (lower is better)
  WF_METRICS[4].norm = function(raw) {
    var inv = 1 - Math.min((raw || 3) / 3, 1);
    return Math.max(inv, 0);
  };

  metrics.forEach(function(metric, i) {
    var raw = data[metric.key] || 0;
    var norm = metric.norm ? metric.norm(raw) : Math.min(raw / metric.max, 1);
    var filled = Math.round(norm * maxDots);
    var y = dotY(i);

    // Draw dots
    for (var d = 0; d < maxDots; d++) {
      var x = 6 + d * dotGap;
      var alpha;
      var radius;
      var color;

      if (d < filled) {
        // Filled dot: full color, full radius
        alpha = 1;
        radius = dotR;
        var t = d / maxDots;
        // Gradient: first dot brightest, gradually less saturated
        var r2 = parseInt(metric.color.slice(1,3), 16);
        var g2 = parseInt(metric.color.slice(3,5), 16);
        var b2 = parseInt(metric.color.slice(5,7), 16);
        var fade = 1 - t * 0.5;
        color = 'rgba(' + r2 + ',' + g2 + ',' + b2 + ',' + fade + ')';
      } else {
        // Empty dot: dim gray, smaller
        var dist = d - filled;
        alpha = Math.max(0, 1 - dist / (maxDots - filled));
        radius = dotR * (0.3 + 0.7 * alpha);
        color = 'rgba(71,85,105,' + (alpha * 0.6) + ')';
      }

      ctx.beginPath();
      ctx.arc(x, y, Math.max(radius, 1), 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    // Label + value on the right
    var lx = w - 4;
    ctx.fillStyle = connected ? '#94a3b8' : '#475569';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(metric.label + ' ' + metric.fmt(raw), lx, y);
  });
}
