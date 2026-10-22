/**
 * AudioRelay Mobile – Network Client
 *
 * Manages:
 *   - WebSocket control connection to the PC server
 *   - UDP-like audio packets via a secondary WebSocket (since browsers
 *     can't do raw UDP; we use a thin WebSocket wrapper that mimics UDP)
 *   - Auto-discovery via UDP broadcast listener (polled via HTTP scan)
 *   - Reconnect logic with exponential backoff
 */

import {
  PROTOCOL_VERSION, MSG, PORTS, QUALITY_PRESET,
  encodeAudioHeader, decodeAudioHeader, AUDIO_HEADER_SIZE
} from '../../shared/protocol-browser.js';

const RECONNECT_BASE_MS  = 1000;
const RECONNECT_MAX_MS   = 30000;
const PING_INTERVAL_MS   = 3000;

export class NetworkClient extends EventTarget {
  constructor() {
    super();
    this.ws             = null;     // control WebSocket
    this.audioWs        = null;     // audio WebSocket (binary)
    this.serverUrl      = null;
    this.serverAudioUrl = null;
    this.connected      = false;
    this._reconnectMs   = RECONNECT_BASE_MS;
    this._reconnectTimer= null;
    this._pingTimer     = null;
    this._seq           = 0;
    this._onAudioFrame  = null;     // callback for received audio
    this.deviceName     = `Android (${navigator.userAgent.match(/Android ([0-9.]+)/)?.[1] ?? 'unknown'})`;
  }

  // ── Discovery ──────────────────────────────────────────────────────────────
  /**
   * Scan LAN for AudioRelay servers by probing common IPs.
   * In a real app this would listen to UDP broadcasts via a native plugin;
   * here we use a fast HTTP scan fallback.
   */
  async discover(timeout = 5000) {
    const results = [];
    // The server also exposes a simple HTTP health check on /info
    const base = this._getGatewayBase();
    if (!base) return results;

    const promises = [];
    for (let i = 1; i <= 254; i++) {
      const ip = `${base}.${i}`;
      promises.push(this._probe(ip, timeout / 10).then((ok) => {
        if (ok) results.push({ ip, port: PORTS.CONTROL });
      }).catch(() => {}));
    }
    await Promise.allSettled(promises);
    return results;
  }

  async _probe(ip, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(`http://${ip}:${PORTS.CONTROL}/info`, { signal: ctrl.signal });
      clearTimeout(timer);
      return r.ok;
    } catch {
      clearTimeout(timer);
      return false;
    }
  }

  _getGatewayBase() {
    // Can't reliably get gateway in browser; return null to skip
    return null;
  }

  // ── Connect ────────────────────────────────────────────────────────────────
  async connect(ip, port = PORTS.CONTROL) {
    const wsUrl      = `ws://${ip}:${port}`;
    const audioWsUrl = `ws://${ip}:${PORTS.AUDIO}/audio`;
    this.serverUrl      = wsUrl;
    this.serverAudioUrl = audioWsUrl;
    this._openControl(wsUrl);
  }

  _openControl(url) {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }

    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      console.log('[Network] Control connected');
      this.connected = true;
      this._reconnectMs = RECONNECT_BASE_MS;
      this._startPing();
      this._dispatch('connected', {});
    };

    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this._onControlMessage(msg);
    };

    this.ws.onerror = (e) => {
      console.error('[Network] Control error');
    };

    this.ws.onclose = () => {
      console.warn('[Network] Control disconnected – retrying in', this._reconnectMs, 'ms');
      this.connected = false;
      this._stopPing();
      this._dispatch('disconnected', {});
      this._scheduleReconnect();
    };
  }

  _openAudioChannel() {
    if (!this.serverAudioUrl) return;
    if (this.audioWs) {
      try { this.audioWs.close(); } catch {}
    }
    this.audioWs = new WebSocket(this.serverAudioUrl);
    this.audioWs.binaryType = 'arraybuffer';

    this.audioWs.onmessage = (e) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      const buf = new Uint8Array(e.data);
      if (buf.length < AUDIO_HEADER_SIZE) return;
      const payload = buf.slice(AUDIO_HEADER_SIZE);
      if (this._onAudioFrame) this._onAudioFrame(payload);
    };

    this.audioWs.onerror = () => console.error('[Network] Audio WS error');
    this.audioWs.onclose = () => console.warn('[Network] Audio WS closed');
  }

  disconnect() {
    clearTimeout(this._reconnectTimer);
    this._stopPing();
    this.ws?.close();
    this.audioWs?.close();
    this.ws      = null;
    this.audioWs = null;
    this.connected = false;
  }

  // ── Control Messages ───────────────────────────────────────────────────────
  _onControlMessage(msg) {
    switch (msg.type) {
      case MSG.HELLO:
        // Reply with HELLO_ACK
        this._sendControl({
          type:    MSG.HELLO_ACK,
          device:  this.deviceName,
          version: PROTOCOL_VERSION,
        });
        this._openAudioChannel();
        this._dispatch('server-info', { device: msg.device, audioPort: msg.audioPort });
        break;

      case MSG.STREAM_STARTED:
        this._dispatch('stream-started', { direction: msg.direction });
        break;

      case MSG.STREAM_STOPPED:
        this._dispatch('stream-stopped', {});
        break;

      case MSG.QUALITY_CHANGED:
        this._dispatch('quality-changed', { preset: msg.preset, info: msg.info });
        break;

      case MSG.STATS_RESPONSE:
        this._dispatch('stats', msg.stats);
        break;

      case MSG.DEVICE_INFO:
        this._dispatch('device-info', msg);
        break;

      case MSG.PONG:
        this._dispatch('pong', { latency: Date.now() - msg.ts });
        break;

      default:
        break;
    }
  }

  // ── Stream Control ─────────────────────────────────────────────────────────
  startStream(direction = 'bidirectional') {
    this._sendControl({ type: MSG.START_STREAM, direction });
  }

  stopStream() {
    this._sendControl({ type: MSG.STOP_STREAM });
  }

  setQuality(preset) {
    this._sendControl({ type: MSG.SET_QUALITY, preset });
  }

  requestStats() {
    this._sendControl({ type: MSG.STATS_REQUEST });
  }

  // ── Audio Send (Opus encoded) ──────────────────────────────────────────────
  sendAudioFrame(opusBytes) {
    if (!this.audioWs || this.audioWs.readyState !== WebSocket.OPEN) return;
    const header  = encodeAudioHeader(this._seq++, Date.now(), opusBytes.length);
    const packet  = new Uint8Array(header.length + opusBytes.length);
    packet.set(header, 0);
    packet.set(opusBytes, header.length);
    this.audioWs.send(packet.buffer);
  }

  // ── Audio Receive ──────────────────────────────────────────────────────────
  setAudioFrameCallback(cb) {
    this._onAudioFrame = cb;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  _sendControl(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  _startPing() {
    this._pingTimer = setInterval(() => {
      this._sendControl({ type: MSG.PING, ts: Date.now() });
    }, PING_INTERVAL_MS);
  }

  _stopPing() {
    clearInterval(this._pingTimer);
  }

  _scheduleReconnect() {
    if (!this.serverUrl) return;
    this._reconnectTimer = setTimeout(() => {
      this._openControl(this.serverUrl);
    }, this._reconnectMs);
    this._reconnectMs = Math.min(this._reconnectMs * 2, RECONNECT_MAX_MS);
  }

  _dispatch(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}
