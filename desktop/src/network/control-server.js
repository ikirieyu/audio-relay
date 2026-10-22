/**
 * ControlServer – WebSocket server running on the desktop PC
 *
 * Each connected mobile client gets its own session.
 * The server:
 *   1. Exchanges HELLO / HELLO_ACK handshake
 *   2. Routes START_STREAM / STOP_STREAM commands to the AudioEngine
 *   3. Forwards captured audio frames to connected clients
 *   4. Receives audio frames from clients and feeds them to AudioEngine
 *   5. Sends periodic STATS_RESPONSE updates
 */

'use strict';

const EventEmitter = require('events');
const { WebSocketServer, WebSocket } = require('ws');
const http  = require('http');
const net   = require('net');
const dgram = require('dgram');
const os    = require('os');

const {
  MSG, PORTS, QUALITY_PRESET,
  AUDIO_HEADER_SIZE, encodeAudioHeader, decodeAudioHeader,
  PROTOCOL_VERSION,
} = require('../protocol');
const AudioWebSocketServer = require('./audio-ws-server');

class ControlServer extends EventEmitter {
  constructor(controlPort, audioEngine) {
    super();
    this.controlPort   = controlPort;
    this.audioEngine   = audioEngine;
    this.httpServer    = null;
    this.wss           = null;
    this.audioWsServer = null;
    this.udpSocket     = null;  // UDP socket for low-latency audio path
    this.sessions      = new Map(); // clientId → session
    this._statsTimer   = null;
    this._streaming    = false;
    this._currentPreset = 'LOW_LATENCY';
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  async start() {
    // 1. HTTP server + WebSocket control plane on PORTS.CONTROL (7372)
    this.httpServer = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.url === '/info') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          app:      'audio-relay',
          version:  PROTOCOL_VERSION,
          device:   `${os.hostname()} (PC)`,
          port:     this.controlPort,
          audioPort: PORTS.AUDIO,
          preset:   this._currentPreset,
        }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on('connection', (ws, req) => this._onClientConnect(ws, req));
    this.wss.on('error', (e) => console.error('[ControlServer] WSS error:', e.message));

    await new Promise((res) => this.httpServer.listen(this.controlPort, res));

    // 2. Binary Audio WebSocket Server on PORTS.AUDIO (7371)
    this.audioWsServer = new AudioWebSocketServer(this.audioEngine);
    await this.audioWsServer.start();

    // 3. UDP audio plane (low latency)
    this.udpSocket = dgram.createSocket('udp4');
    this.udpSocket.on('message', (msg, rinfo) => this._onUdpPacket(msg, rinfo));
    this.udpSocket.on('error',   (e)           => console.error('[ControlServer] UDP error:', e.message));
    await new Promise((res) => this.udpSocket.bind(PORTS.AUDIO, res));

    // Stats timer
    this._statsTimer = setInterval(() => this._broadcastStats(), 1000);

    console.log(`[ControlServer] Control on :${this.controlPort} (HTTP+WS), Audio on :${PORTS.AUDIO} (UDP+WS)`);
  }

  async stop() {
    clearInterval(this._statsTimer);
    await this.stopStream();
    for (const [, session] of this.sessions) {
      try { session.ws.close(); } catch {}
    }
    this.sessions.clear();
    await this.audioWsServer?.stop();
    await new Promise((res) => this.wss?.close(res));
    await new Promise((res) => this.httpServer?.close(res));
    await new Promise((res) => this.udpSocket?.close(res));
    console.log('[ControlServer] Stopped');
  }

  // ── Client Connect ────────────────────────────────────────────────────────
  _onClientConnect(ws, req) {
    const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    const session  = {
      id:        clientId,
      ws,
      ip:        req.socket.remoteAddress,
      deviceName: 'Unknown',
      connected: true,
      rxPackets:  0,
      txPackets:  0,
      rxBytes:    0,
      txBytes:    0,
      connectedAt: Date.now(),
    };
    this.sessions.set(clientId, session);
    console.log('[ControlServer] Client connected:', clientId);

    ws.on('message', (data) => this._onWsMessage(session, data));
    ws.on('close',   ()     => this._onClientClose(session));
    ws.on('error',   (e)    => console.error('[ControlServer] WS client error:', e.message));

    // Send HELLO immediately
    this._send(session, {
      type:     MSG.HELLO,
      version:  PROTOCOL_VERSION,
      device:   `${require('os').hostname()} (PC)`,
      audioPort: PORTS.AUDIO,
    });
  }

  _onClientClose(session) {
    session.connected = false;
    this.sessions.delete(session.id);
    console.log('[ControlServer] Client disconnected:', session.id);
    this.emit('client-disconnected', { id: session.id, device: session.deviceName });

    if (this.sessions.size === 0) {
      this.stopStream();
    }
  }

  // ── Message Handling ──────────────────────────────────────────────────────
  _onWsMessage(session, rawData) {
    let msg;
    try { msg = JSON.parse(rawData.toString()); } catch { return; }

    switch (msg.type) {
      case MSG.HELLO_ACK:
        session.deviceName = msg.device || 'Android';
        this.emit('client-connected', {
          id:     session.id,
          device: session.deviceName,
          ip:     session.ip,
        });
        this._send(session, { type: MSG.DEVICE_INFO, preset: this._currentPreset });
        break;

      case MSG.START_STREAM:
        this.startStream({ direction: msg.direction });
        break;

      case MSG.STOP_STREAM:
        this.stopStream();
        break;

      case MSG.SET_QUALITY:
        this.setQuality(msg.preset);
        break;

      case MSG.STATS_REQUEST:
        this._send(session, { type: MSG.STATS_RESPONSE, stats: this._collectStats(session) });
        break;

      case MSG.PING:
        this._send(session, { type: MSG.PONG, ts: msg.ts });
        break;

      default:
        break;
    }
  }

  // ── UDP Audio Packets (Android → PC) ──────────────────────────────────────
  _onUdpPacket(buf, rinfo) {
    if (buf.length < AUDIO_HEADER_SIZE) return;
    const header  = decodeAudioHeader(buf);
    const payload = buf.slice(AUDIO_HEADER_SIZE, AUDIO_HEADER_SIZE + header.payloadLen);
    this.audioEngine.feedEncodedAudio(payload);

    // Update rx stats for matching session
    for (const [, session] of this.sessions) {
      if (session.ip === rinfo.address) {
        session.rxPackets++;
        session.rxBytes += buf.length;
      }
    }
  }

  // ── Stream Control ────────────────────────────────────────────────────────
  async startStream(opts = {}) {
    if (this._streaming) return;
    this._streaming = true;

    const direction = opts.direction || 'bidirectional';
    console.log('[ControlServer] Starting stream, direction:', direction);

    if (direction !== 'android_to_pc') {
      // Start capturing and forwarding to all clients via UDP
      this.audioEngine.startCapture((frame) => {
        this._sendAudioFrame(frame);
      });
    }

    if (direction !== 'pc_to_android') {
      // Start playback (receive from Android via UDP above)
      this.audioEngine.startPlayback();
    }

    this._broadcast({ type: MSG.STREAM_STARTED, direction });
    this.emit('stream-started', { direction });
  }

  async stopStream() {
    if (!this._streaming) return;
    this._streaming = false;
    this.audioEngine.stopCapture();
    this.audioEngine.stopPlayback();
    this._broadcast({ type: MSG.STREAM_STOPPED });
    this.emit('stream-stopped', {});
    console.log('[ControlServer] Stream stopped');
  }

  setQuality(presetKey) {
    try {
      const preset = this.audioEngine.setQuality(presetKey);
      this._currentPreset = presetKey;
      this._broadcast({ type: MSG.QUALITY_CHANGED, preset: presetKey, info: preset });
      this.emit('quality-changed', { preset: presetKey });
      return preset;
    } catch (e) {
      console.error('[ControlServer] setQuality error:', e.message);
    }
  }

  // ── Audio Frame Dispatch ──────────────────────────────────────────────────
  _sendAudioFrame(frame) {
    const { seq, ts, encoded } = frame;
    const header = encodeAudioHeader(seq, ts, encoded.length);
    const packet = Buffer.concat([header, Buffer.from(encoded)]);

    for (const [, session] of this.sessions) {
      if (!session.connected || !session.ip) continue;
      try {
        this.udpSocket.send(packet, PORTS.AUDIO, session.ip);
        session.txPackets++;
        session.txBytes += packet.length;
      } catch (e) {
        console.error('[ControlServer] UDP send error:', e.message);
      }
    }

    // Also dispatch to WebSocket audio clients (mobile web/PWA)
    if (this.audioWsServer) {
      this.audioWsServer.broadcast(frame);
    }
  }

  // ── WebSocket Helpers ─────────────────────────────────────────────────────
  _send(session, obj) {
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify(obj));
    }
  }

  _broadcast(obj) {
    const raw = JSON.stringify(obj);
    for (const [, session] of this.sessions) {
      try {
        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(raw);
        }
      } catch {}
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  _collectStats(session) {
    const uptime = Math.round((Date.now() - session.connectedAt) / 1000);
    return {
      ...this.audioEngine.getStats(),
      clients:    this.sessions.size,
      rxPackets:  session.rxPackets,
      txPackets:  session.txPackets,
      rxKB:       Math.round(session.rxBytes / 1024),
      txKB:       Math.round(session.txBytes / 1024),
      uptimeSec:  uptime,
      streaming:  this._streaming,
    };
  }

  _broadcastStats() {
    if (this.sessions.size === 0) return;
    for (const [, session] of this.sessions) {
      this._send(session, { type: MSG.STATS_RESPONSE, stats: this._collectStats(session) });
    }
    this.emit('stats', this._collectStats([...this.sessions.values()][0]));
  }
}

module.exports = ControlServer;
