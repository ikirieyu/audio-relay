/**
 * AudioRelay Mobile – Main App Controller
 *
 * Wires together:
 *  - MobileAudioEngine (Web Audio capture/playback)
 *  - NetworkClient (WebSocket control + audio)
 *  - Opus encoder/decoder (opusscript)
 *  - UI rendering
 */

import { MobileAudioEngine } from './audio-engine.js';
import { NetworkClient }     from './network-client.js';
import { QUALITY_PRESET }    from '../../shared/protocol-browser.js';

// Try to load OpusScript
let OpusScript;
try {
  OpusScript = (await import('opusscript')).default;
} catch {
  console.warn('[App] opusscript not available – running in pass-through mode');
}

// ─── App State ────────────────────────────────────────────────────────────────
const state = {
  phase:      'idle',   // idle | connecting | connected | streaming
  preset:     'LOW_LATENCY',
  direction:  'bidirectional',
  serverIP:   '',
  latency:    0,
  encoder:    null,
  decoder:    null,
};

const audio   = new MobileAudioEngine();
const network = new NetworkClient();

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderApp();
});

// ─── Render ───────────────────────────────────────────────────────────────────
function renderApp() {
  document.body.innerHTML = getAppHTML();
  attachEvents();
  loadSavedIP();
}

function getAppHTML() {
  return `
  <div class="app">
    <!-- Header -->
    <header class="app-header">
      <div class="logo">
        <div class="logo-mark">🎙️</div>
        <div>
          <div class="logo-title">AudioRelay</div>
          <div class="logo-sub">PC ↔ Android Bridge</div>
        </div>
      </div>
      <div class="header-badge" id="header-badge">Disconnected</div>
    </header>

    <!-- Connection Card -->
    <div class="card" id="card-connect">
      <div class="card-title">Connect to PC</div>

      <div class="input-group">
        <label>PC IP Address</label>
        <div class="input-row">
          <input type="text" id="ip-input" placeholder="192.168.1.x"
                 inputmode="numeric" autocomplete="off" />
          <button class="btn-icon" id="btn-scan" title="Auto-scan">🔍</button>
        </div>
      </div>

      <button class="btn btn-primary" id="btn-connect" style="width:100%;margin-top:12px">
        Connect
      </button>

      <div id="scan-results" class="scan-results"></div>
    </div>

    <!-- Stream Card -->
    <div class="card" id="card-stream" style="display:none">
      <div class="card-title">
        <span id="server-name">PC</span>
        <span class="conn-dot active" id="conn-dot"></span>
      </div>

      <!-- Direction -->
      <div class="direction-row">
        <button class="dir-btn active" data-dir="pc_to_android">🖥️→📱</button>
        <button class="dir-btn" data-dir="bidirectional">🖥️⇄📱</button>
        <button class="dir-btn" data-dir="android_to_pc">📱→🖥️</button>
      </div>

      <!-- Stream Toggle -->
      <button class="btn btn-stream" id="btn-stream">
        <span id="stream-icon">▶</span>
        <span id="stream-text">Start Stream</span>
      </button>

      <!-- Visualizer -->
      <div class="visualizer">
        <canvas id="viz-canvas" width="320" height="60"></canvas>
      </div>

      <!-- Latency & Info -->
      <div class="info-row">
        <div class="info-chip">
          <span class="chip-label">Latency</span>
          <span class="chip-val" id="info-latency">– ms</span>
        </div>
        <div class="info-chip">
          <span class="chip-label">Quality</span>
          <span class="chip-val" id="info-preset">Low</span>
        </div>
        <div class="info-chip">
          <span class="chip-label">Bitrate</span>
          <span class="chip-val" id="info-bitrate">– k</span>
        </div>
      </div>

      <button class="btn btn-secondary" id="btn-disconnect">Disconnect</button>
    </div>

    <!-- Quality Card -->
    <div class="card">
      <div class="card-title">Quality Preset</div>
      <div class="quality-list" id="quality-list">
        ${Object.entries(QUALITY_PRESET).map(([k, v]) => `
          <div class="quality-row ${k === 'LOW_LATENCY' ? 'active' : ''}" data-preset="${k}">
            <div class="quality-info">
              <div class="quality-name">${v.label}</div>
              <div class="quality-spec">${v.sampleRate / 1000}kHz · ${v.bitrate / 1000}kbps · ${v.bufferMs}ms</div>
            </div>
            <div class="quality-bar"><div style="width:${Math.round(v.bufferMs / 5)}%"></div></div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Connection Type -->
    <div class="card">
      <div class="card-title">Connection Mode</div>
      <div class="mode-row">
        <button class="mode-btn active" data-mode="wifi" id="mode-wifi">
          <span class="mode-icon">📶</span>
          <span>WiFi / LAN</span>
        </button>
        <button class="mode-btn" data-mode="usb" id="mode-usb">
          <span class="mode-icon">🔌</span>
          <span>USB</span>
        </button>
        <button class="mode-btn" data-mode="bt" id="mode-bt">
          <span class="mode-icon">🔷</span>
          <span>Bluetooth</span>
        </button>
      </div>
      <p class="mode-hint" id="mode-hint">
        Auto-discover PC on local WiFi network
      </p>
    </div>

    <!-- Status Log -->
    <div class="card">
      <div class="card-title">Log</div>
      <div class="log-box" id="log-box"></div>
    </div>
  </div>`;
}

// ─── Events ───────────────────────────────────────────────────────────────────
function attachEvents() {
  // Connect / Disconnect
  document.getElementById('btn-connect').onclick    = handleConnect;
  document.getElementById('btn-disconnect').onclick = handleDisconnect;
  document.getElementById('btn-stream').onclick     = handleStreamToggle;
  document.getElementById('btn-scan').onclick       = handleScan;

  // Direction buttons
  document.querySelectorAll('.dir-btn').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.dir-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      state.direction = b.dataset.dir;
    });
  });

  // Quality
  document.querySelectorAll('.quality-row').forEach((row) => {
    row.addEventListener('click', () => {
      document.querySelectorAll('.quality-row').forEach((r) => r.classList.remove('active'));
      row.classList.add('active');
      state.preset = row.dataset.preset;
      network.setQuality(state.preset);
      updatePresetInfo();
      log(`Quality → ${QUALITY_PRESET[state.preset].label}`);
    });
  });

  // Mode
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      applyModeHint(b.dataset.mode);
    });
  });

  // Network events
  network.addEventListener('connected',     () => onConnected());
  network.addEventListener('disconnected',  () => onDisconnected());
  network.addEventListener('server-info',   (e) => onServerInfo(e.detail));
  network.addEventListener('stream-started',(e) => onStreamStarted(e.detail));
  network.addEventListener('stream-stopped',()  => onStreamStopped());
  network.addEventListener('quality-changed',(e)=> onQualityChanged(e.detail));
  network.addEventListener('stats',         (e) => onStats(e.detail));
  network.addEventListener('pong',          (e) => {
    state.latency = e.detail.latency;
    const el = document.getElementById('info-latency');
    if (el) el.textContent = `${e.detail.latency} ms`;
  });
}

// ─── Connect ──────────────────────────────────────────────────────────────────
async function handleConnect() {
  const ip = document.getElementById('ip-input').value.trim();
  if (!ip) {
    alert('Please enter PC IP address');
    return;
  }
  state.serverIP = ip;
  localStorage.setItem('lastIP', ip);
  log(`Connecting to ${ip}…`);
  setPhase('connecting');

  try {
    await network.connect(ip);
  } catch (e) {
    log(`Connection failed: ${e.message}`);
    setPhase('idle');
  }
}

function handleDisconnect() {
  network.disconnect();
}

// ─── Stream ───────────────────────────────────────────────────────────────────
async function handleStreamToggle() {
  if (state.phase === 'streaming') {
    network.stopStream();
  } else {
    // Build codecs
    await buildCodecs();
    network.startStream(state.direction);
  }
}

async function buildCodecs() {
  if (!OpusScript) return;
  const p = QUALITY_PRESET[state.preset];
  state.encoder = new OpusScript(p.sampleRate, p.channels, OpusScript.Application.AUDIO);
  state.encoder.setBitrate(p.bitrate);
  state.decoder = new OpusScript(p.sampleRate, p.channels, OpusScript.Application.AUDIO);

  // Hook audio engine to network
  await audio.init(p);

  if (state.direction !== 'pc_to_android') {
    await audio.startCapture((pcmInt16) => {
      if (!state.encoder) return;
      try {
        const frameSamples = (p.sampleRate * p.frameMs) / 1000;
        const encoded = state.encoder.encode(pcmInt16, frameSamples);
        network.sendAudioFrame(encoded);
      } catch {}
    });
  }

  if (state.direction !== 'android_to_pc') {
    audio.startPlayback();
    network.setAudioFrameCallback((opusBuf) => {
      if (!state.decoder) return;
      try {
        const pcm = state.decoder.decode(opusBuf);
        // Convert Int16 → Float32
        const f32 = new Float32Array(pcm.length);
        for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768;
        audio.feedPCM(f32);
      } catch {}
    });
  }
}

// ─── Network Callbacks ────────────────────────────────────────────────────────
function onConnected() {
  log('Connected to PC');
  setPhase('connected');
  document.getElementById('card-connect').style.display = 'none';
  document.getElementById('card-stream').style.display  = 'block';
  updateBadge('Connected', 'connected');
}

function onDisconnected() {
  log('Disconnected');
  setPhase('idle');
  stopAudio();
  document.getElementById('card-connect').style.display = 'block';
  document.getElementById('card-stream').style.display  = 'none';
  updateBadge('Disconnected', '');
}

function onServerInfo(info) {
  const el = document.getElementById('server-name');
  if (el) el.textContent = info.device || 'PC';
  log(`Server: ${info.device}`);
}

function onStreamStarted(info) {
  log(`Streaming started (${info.direction})`);
  setPhase('streaming');
  const btn  = document.getElementById('btn-stream');
  const icon = document.getElementById('stream-icon');
  const text = document.getElementById('stream-text');
  if (btn) btn.classList.add('active');
  if (icon) icon.textContent = '⏹';
  if (text) text.textContent = 'Stop Stream';
  startViz();
}

function onStreamStopped() {
  log('Stream stopped');
  setPhase('connected');
  const btn  = document.getElementById('btn-stream');
  const icon = document.getElementById('stream-icon');
  const text = document.getElementById('stream-text');
  if (btn) btn.classList.remove('active');
  if (icon) icon.textContent = '▶';
  if (text) text.textContent = 'Start Stream';
  stopAudio();
  stopViz();
}

function onQualityChanged(info) {
  state.preset = info.preset;
  log(`Quality → ${QUALITY_PRESET[info.preset]?.label}`);
  updatePresetInfo();
  document.querySelectorAll('.quality-row').forEach((r) => {
    r.classList.toggle('active', r.dataset.preset === info.preset);
  });
}

function onStats(s) {
  updatePresetInfo();
}

// ─── Scan ─────────────────────────────────────────────────────────────────────
async function handleScan() {
  const btn = document.getElementById('btn-scan');
  btn.textContent = '⏳';
  btn.disabled    = true;
  log('Scanning network…');
  const results = await network.discover(5000);
  btn.textContent = '🔍';
  btn.disabled    = false;

  const container = document.getElementById('scan-results');
  if (results.length === 0) {
    container.innerHTML = '<p class="scan-none">No servers found. Enter IP manually.</p>';
  } else {
    container.innerHTML = results.map((r) =>
      `<button class="scan-item" data-ip="${r.ip}">${r.ip}:${r.port}</button>`
    ).join('');
    container.querySelectorAll('.scan-item').forEach((b) => {
      b.onclick = () => {
        document.getElementById('ip-input').value = b.dataset.ip;
        container.innerHTML = '';
      };
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setPhase(p) { state.phase = p; }

function stopAudio() {
  audio.stopCapture();
  audio.stopPlayback();
  state.encoder = null;
  state.decoder = null;
  network.setAudioFrameCallback(null);
}

function updateBadge(text, cls) {
  const b = document.getElementById('header-badge');
  if (!b) return;
  b.textContent = text;
  b.className   = `header-badge ${cls}`;
}

function updatePresetInfo() {
  const p  = QUALITY_PRESET[state.preset];
  const el = document.getElementById('info-preset');
  const br = document.getElementById('info-bitrate');
  if (el) el.textContent = p?.label?.split(' ')[0] ?? '–';
  if (br) br.textContent = `${Math.round((p?.bitrate ?? 0) / 1000)}k`;
}

function applyModeHint(mode) {
  const hints = {
    wifi: 'Auto-discover PC on local WiFi network',
    usb:  'Connect via USB cable with USB Debugging enabled',
    bt:   'Connect via Bluetooth RFCOMM (higher latency)',
  };
  const modeIPs = { wifi: '', usb: '127.0.0.1', bt: '127.0.0.1' };
  const hint = document.getElementById('mode-hint');
  if (hint) hint.textContent = hints[mode] ?? '';
  if (modeIPs[mode]) {
    document.getElementById('ip-input').value = modeIPs[mode];
  }
}

function loadSavedIP() {
  const saved = localStorage.getItem('lastIP');
  if (saved) {
    const el = document.getElementById('ip-input');
    if (el) el.value = saved;
  }
}

function log(msg) {
  const box = document.getElementById('log-box');
  if (!box) return;
  const line = document.createElement('div');
  line.className = 'log-line';
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
  // Keep last 50 lines
  while (box.children.length > 50) box.removeChild(box.firstChild);
}

// ─── Visualizer ───────────────────────────────────────────────────────────────
let _vizFrame = null, _vizPhase = 0;

function startViz() {
  const canvas = document.getElementById('viz-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, '#00e5ff'); g.addColorStop(1, '#7c3aed');
    ctx.strokeStyle = g;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    for (let x = 0; x < W; x++) {
      const t = x / W * Math.PI * 6 + _vizPhase;
      const a = 12 + Math.sin(x / W * Math.PI * 2 + _vizPhase * 0.4) * 8;
      const y = H / 2 + Math.sin(t) * a;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    _vizPhase += 0.08;
    _vizFrame  = requestAnimationFrame(draw);
  }
  draw();
}

function stopViz() {
  if (_vizFrame) cancelAnimationFrame(_vizFrame);
  _vizFrame = null;
}

export { state, audio, network };
