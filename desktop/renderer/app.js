/**
 * AudioRelay Desktop – Renderer Logic
 *
 * Handles:
 *  - Tab navigation
 *  - IPC calls to main process via window.audioRelay
 *  - Stream start/stop
 *  - Quality preset selection
 *  - ADB & Bluetooth UI
 *  - Waveform canvas animation
 *  - Latency graph canvas
 *  - Live stats updates
 */

'use strict';

const api = window.audioRelay;

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  streaming:     false,
  clients:       new Map(),
  currentPreset: 'LOW_LATENCY',
  adbEnabled:    false,
  btDevices:     [],
  stats:         null,
  latencyHistory: [],
};

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTitlebar();
  initNav();
  initQuality();
  initStreamControls();
  initDeviceSelects();
  initConnections();
  initSliders();
  initCanvases();
  subscribeEvents();
  await loadServerInfo();
  await loadAudioDevices();
  startWaveformAnimation();
  startLatencyAnimation();
});

// ─── Titlebar ─────────────────────────────────────────────────────────────────
function initTitlebar() {
  $('btn-minimize').onclick = () => api.minimize();
  $('btn-maximize').onclick = () => api.maximize();
  $('btn-close').onclick    = () => api.close();
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function initNav() {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(`tab-${tab}`).classList.add('active');
    });
  });
}

// ─── Server Info ──────────────────────────────────────────────────────────────
async function loadServerInfo() {
  try {
    const info = await api.getServerInfo();
    $('server-ip').textContent   = info.ip   || '–';
    $('server-port').textContent = info.port  || '7372';
    $('server-name').textContent = info.name  || '–';
  } catch (e) {
    console.error('getServerInfo:', e);
  }
}

// ─── Audio Devices ────────────────────────────────────────────────────────────
async function loadAudioDevices() {
  try {
    const devices = await api.getAudioDevices();
    const inSel   = $('input-device-select');
    const outSel  = $('output-device-select');

    inSel.innerHTML  = '<option value="-1">Default Input</option>';
    outSel.innerHTML = '<option value="-1">Default Output</option>';

    for (const d of devices) {
      if (d.isInput) {
        const o = new Option(d.name, d.id);
        inSel.appendChild(o);
      }
      if (d.isOutput) {
        const o = new Option(d.name, d.id);
        outSel.appendChild(o);
      }
    }

    inSel.onchange  = () => api.setInputDevice(Number(inSel.value));
    outSel.onchange = () => api.setOutputDevice(Number(outSel.value));
  } catch (e) {
    console.error('loadAudioDevices:', e);
  }
}

// ─── Stream Controls ──────────────────────────────────────────────────────────
function initStreamControls() {
  const btn  = $('btn-stream-toggle');
  const text = $('stream-btn-text');

  btn.addEventListener('click', async () => {
    if (state.streaming) {
      await api.stopStream();
      state.streaming = false;
      btn.classList.remove('streaming');
      text.textContent = 'Start Streaming';
      $('stream-badge').textContent = 'Idle';
      $('stream-badge').className   = 'badge';
      showToast('Stream stopped', 'info');
    } else {
      const direction = document.querySelector('input[name="direction"]:checked')?.value || 'bidirectional';
      await api.startStream({ direction });
      state.streaming = true;
      btn.classList.add('streaming');
      text.textContent = 'Stop Streaming';
      $('stream-badge').textContent = '● Streaming';
      $('stream-badge').className   = 'badge badge-streaming';
      showToast('Streaming started', 'success');
    }
  });

  // Direction card click syncs checkbox
  document.querySelectorAll('.direction-card').forEach((card) => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.direction-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });
}

// ─── Quality Presets ──────────────────────────────────────────────────────────
function initQuality() {
  document.querySelectorAll('.quality-card').forEach((card) => {
    card.addEventListener('click', async () => {
      const preset = card.dataset.preset;
      document.querySelectorAll('.quality-card').forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      state.currentPreset = preset;
      try {
        await api.setQuality(preset);
        showToast(`Quality: ${card.querySelector('h3').textContent}`, 'info');
      } catch (e) {
        showToast('Failed to set quality', 'error');
      }
    });
  });
}

// ─── Sliders ──────────────────────────────────────────────────────────────────
function initSliders() {
  const volOut = $('vol-out');
  const volIn  = $('vol-in');
  const buf    = $('custom-buffer');

  volOut.oninput = () => $('vol-out-val').textContent = `${volOut.value}%`;
  volIn.oninput  = () => $('vol-in-val').textContent  = `${volIn.value}%`;
  buf.oninput    = () => $('custom-buffer-val').textContent = `${buf.value} ms`;
}

// ─── Connections ──────────────────────────────────────────────────────────────
function initConnections() {
  // ADB
  const adbBtn = $('btn-adb-toggle');
  adbBtn.addEventListener('click', async () => {
    if (state.adbEnabled) {
      await api.adbDisable();
      state.adbEnabled = false;
      adbBtn.textContent = 'Enable ADB Bridge';
    } else {
      await api.adbEnable();
      state.adbEnabled = true;
      adbBtn.textContent = 'Disable ADB Bridge';
    }
  });

  // Bluetooth
  $('btn-bt-scan').addEventListener('click', async () => {
    $('btn-bt-scan').textContent = 'Scanning…';
    $('btn-bt-scan').disabled = true;
    $('bt-devices-list').innerHTML = '';
    try {
      await api.btScan();
    } catch {
      showToast('Bluetooth scan failed', 'error');
    } finally {
      setTimeout(() => {
        $('btn-bt-scan').textContent = 'Scan Devices';
        $('btn-bt-scan').disabled = false;
      }, 15500);
    }
  });

  $('btn-bt-disconnect').addEventListener('click', async () => {
    await api.btDisconnect();
    $('btn-bt-disconnect').style.display = 'none';
    $('bt-status-badge').textContent = 'Idle';
    $('bt-status-badge').className = 'badge';
  });

  $('link-adb').addEventListener('click', (e) => {
    e.preventDefault();
    // Open in default browser
    require?.('electron')?.shell?.openExternal(
      'https://developer.android.com/tools/releases/platform-tools'
    );
  });
}

function initDeviceSelects() {
  // Already set up in loadAudioDevices after fetching
}

// ─── Event Subscriptions ──────────────────────────────────────────────────────
function subscribeEvents() {
  api.on('client-connected', (info) => {
    state.clients.set(info.id, info);
    updateClientsList();
    $('client-count').textContent = state.clients.size;
    showToast(`📱 ${info.device} connected`, 'success');
  });

  api.on('client-disconnected', (info) => {
    state.clients.delete(info.id);
    updateClientsList();
    $('client-count').textContent = state.clients.size;
    showToast(`📱 ${info.device} disconnected`, 'info');
  });

  api.on('stream-started', (info) => {
    state.streaming = true;
  });

  api.on('stream-stopped', () => {
    state.streaming = false;
  });

  api.on('stats', (s) => {
    state.stats = s;
    updateStats(s);
  });

  api.on('adb-status', (s) => {
    $('adb-status-msg').textContent = s.message || '';
    const badge = $('adb-status-badge');
    if (s.connected) {
      badge.textContent = 'Connected';
      badge.className = 'badge badge-active';
    } else if (s.enabled) {
      badge.textContent = 'Waiting…';
      badge.className = 'badge';
    } else {
      badge.textContent = 'Disabled';
      badge.className = 'badge';
    }
  });

  api.on('bt-status', (s) => {
    $('bt-status-msg').textContent = s.message || s.error || '';
    const badge = $('bt-status-badge');
    if (s.connected) {
      badge.textContent = 'Connected';
      badge.className = 'badge badge-active';
      $('btn-bt-disconnect').style.display = 'inline-flex';
    } else if (s.scanning) {
      badge.textContent = 'Scanning…';
      badge.className = 'badge';
    } else {
      badge.textContent = s.error ? 'Error' : 'Idle';
      badge.className = s.error ? 'badge badge-error' : 'badge';
    }
  });

  api.on('bt-device-found', (device) => {
    if (!state.btDevices.find((d) => d.address === device.address)) {
      state.btDevices.push(device);
      addBtDeviceToList(device);
    }
  });
}

// ─── Clients List ─────────────────────────────────────────────────────────────
function updateClientsList() {
  const list = $('clients-list');
  if (state.clients.size === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📱</div>
        <p>No Android devices connected yet</p>
        <small>Open AudioRelay on your Android device</small>
      </div>`;
    return;
  }
  list.innerHTML = '';
  for (const [, client] of state.clients) {
    const el = document.createElement('div');
    el.className = 'client-item';
    el.innerHTML = `
      <div class="client-avatar">📱</div>
      <div class="client-info">
        <div class="client-name">${escHtml(client.device)}</div>
        <div class="client-meta">${escHtml(client.ip)}</div>
      </div>
      <div class="client-connected-dot"></div>`;
    list.appendChild(el);
  }
}

// ─── Bluetooth Devices ────────────────────────────────────────────────────────
function addBtDeviceToList(device) {
  const list = $('bt-devices-list');
  const el   = document.createElement('div');
  el.className = 'bt-device-item';
  el.innerHTML = `
    <div>
      <div class="bt-device-name">${escHtml(device.name)}</div>
      <div class="bt-device-addr">${escHtml(device.address)}</div>
    </div>
    <button class="btn btn-secondary" style="font-size:11px;padding:5px 10px">Connect</button>`;
  el.querySelector('button').addEventListener('click', async () => {
    try {
      await api.btConnect(device.address);
    } catch (e) {
      showToast(`Bluetooth connect failed: ${e.message}`, 'error');
    }
  });
  list.appendChild(el);
}

// ─── Stats ────────────────────────────────────────────────────────────────────
let _prevTx = 0, _prevRx = 0;
function updateStats(s) {
  const txPs = s.txPackets - _prevTx;
  const rxPs = s.rxPackets - _prevRx;
  _prevTx = s.txPackets;
  _prevRx = s.rxPackets;

  $('stat-tx').textContent      = txPs >= 0 ? txPs : '–';
  $('stat-rx').textContent      = rxPs >= 0 ? rxPs : '–';
  $('stat-tx-kb').textContent   = `${s.txKB} KB`;
  $('stat-rx-kb').textContent   = `${s.rxKB} KB`;
  $('stat-bitrate').textContent = `${Math.round(s.bitrate / 1000)}k`;
  $('stat-buffer').textContent  = `${s.bufferMs} ms`;
  $('stat-sr').textContent      = `${s.sampleRate / 1000}kHz`;
  $('stat-clients').textContent = s.clients ?? '0';

  // Latency history
  const bufMs = s.bufferMs + (s.frameMs ?? 20);
  state.latencyHistory.push(bufMs);
  if (state.latencyHistory.length > 80) state.latencyHistory.shift();
  $('latency-current').textContent = `${bufMs} ms`;
}

// ─── Waveform Canvas ──────────────────────────────────────────────────────────
let wavePhase = 0;
function startWaveformAnimation() {
  const canvas = $('waveform-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (state.streaming) {
      // Animated waveform when streaming
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0,   'rgba(0,229,255,0.8)');
      grad.addColorStop(0.5, 'rgba(124,58,237,0.8)');
      grad.addColorStop(1,   'rgba(0,229,255,0.8)');
      ctx.strokeStyle = grad;
      ctx.lineWidth   = 2;
      ctx.beginPath();
      for (let x = 0; x < W; x++) {
        const t   = x / W * Math.PI * 8 + wavePhase;
        const amp = 20 + Math.sin(x / W * Math.PI * 3 + wavePhase * 0.5) * 15;
        const y   = H / 2 + Math.sin(t) * amp;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Level bars simulation
      const lvl = 30 + Math.abs(Math.sin(wavePhase * 0.3)) * 60;
      $('level-out').style.width = `${lvl}%`;
      $('level-out-db').textContent = `${(-60 + lvl * 0.6).toFixed(0)} dB`;

      const lvlIn = 20 + Math.abs(Math.sin(wavePhase * 0.4 + 1)) * 50;
      $('level-in').style.width = `${lvlIn}%`;
      $('level-in-db').textContent = `${(-60 + lvlIn * 0.6).toFixed(0)} dB`;

      wavePhase += 0.08;
    } else {
      // Flat line when idle
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();

      $('level-out').style.width = '0%';
      $('level-out-db').textContent = '–∞';
      $('level-in').style.width = '0%';
      $('level-in-db').textContent = '–∞';
    }

    requestAnimationFrame(draw);
  }
  draw();
}

// ─── Latency Graph Canvas ─────────────────────────────────────────────────────
function startLatencyAnimation() {
  const canvas = $('latency-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const hist = state.latencyHistory;
    if (hist.length < 2) {
      // Grid only
      drawGrid(ctx, W, H);
      requestAnimationFrame(draw);
      return;
    }

    drawGrid(ctx, W, H);

    const max = Math.max(...hist, 100);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(0,229,255,0.3)');
    grad.addColorStop(1, 'rgba(0,229,255,0)');

    // Fill
    ctx.beginPath();
    ctx.moveTo(0, H);
    hist.forEach((v, i) => {
      const x = (i / (hist.length - 1)) * W;
      const y = H - (v / max) * (H - 10) - 5;
      ctx.lineTo(x, y);
    });
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,229,255,0.9)';
    ctx.lineWidth   = 2;
    hist.forEach((v, i) => {
      const x = (i / (hist.length - 1)) * W;
      const y = H - (v / max) * (H - 10) - 5;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    requestAnimationFrame(draw);
  }
  draw();
}

function drawGrid(ctx, W, H) {
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth   = 1;
  for (let i = 0; i <= 4; i++) {
    const y = (i / 4) * H;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  for (let i = 0; i <= 8; i++) {
    const x = (i / 8) * W;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
}

// ─── Canvas Sizing ────────────────────────────────────────────────────────────
function initCanvases() {
  const resizeCanvases = () => {
    ['waveform-canvas', 'latency-canvas'].forEach((id) => {
      const el = $(id);
      if (el) {
        el.width  = el.offsetWidth  || 800;
        el.height = el.offsetHeight || (id === 'waveform-canvas' ? 80 : 120);
      }
    });
  };
  resizeCanvases();
  window.addEventListener('resize', resizeCanvases);
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const container = $('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  el.innerHTML = `<span>${icon}</span><span>${escHtml(msg)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 320);
  }, 3000);
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
