/**
 * AudioEngine – Core audio capture and playback for desktop
 *
 * Uses naudiodon (PortAudio binding for Node.js) for cross-platform
 * audio I/O.  Falls back to a silence generator when naudiodon is
 * unavailable so the UI still boots.
 *
 * Flow:
 *  Capture: microphone/loopback → raw PCM → Opus encoder → packet queue
 *  Playback: packet queue → Opus decoder → PCM → speaker output
 */

'use strict';

const EventEmitter = require('events');
const OpusScript   = require('opusscript');
const { QUALITY_PRESET } = require('../protocol');

// Try to load naudiodon (native PortAudio binding)
let portAudio;
try {
  portAudio = require('naudiodon');
} catch {
  console.warn('[AudioEngine] naudiodon not available – using silent stub');
  portAudio = null;
}

class AudioEngine extends EventEmitter {
  constructor() {
    super();
    this.inputStream   = null;
    this.outputStream  = null;
    this.encoder       = null;
    this.decoder       = null;
    this.preset        = QUALITY_PRESET.LOW_LATENCY;
    this.inputDeviceId  = -1;  // -1 = default
    this.outputDeviceId = -1;
    this.devices        = [];
    this.captureCallback  = null;  // called with encoded opus frame
    this.playbackQueue    = [];
    this._seqTx           = 0;
    this._initialized     = false;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  async initialize() {
    this._refreshDevices();
    this._buildCodecs();
    this._initialized = true;
    console.log('[AudioEngine] Initialized with preset:', this.preset.label);
  }

  destroy() {
    this.stopCapture();
    this.stopPlayback();
    this._initialized = false;
  }

  // ── Devices ───────────────────────────────────────────────────────────────
  _refreshDevices() {
    if (!portAudio) {
      this.devices = [
        { id: -1, name: 'Default Input',  isInput: true,  isOutput: false },
        { id: -1, name: 'Default Output', isInput: false, isOutput: true  },
      ];
      return;
    }
    try {
      const raw = portAudio.getDevices();
      this.devices = raw.map((d, i) => ({
        id:       i,
        name:     d.name,
        isInput:  d.maxInputChannels  > 0,
        isOutput: d.maxOutputChannels > 0,
        hostAPI:  d.hostAPIName,
        default:  d.isDefaultInput || d.isDefaultOutput,
      }));
    } catch (e) {
      console.error('[AudioEngine] getDevices error:', e.message);
      this.devices = [];
    }
  }

  getDevices() {
    return this.devices;
  }

  setInputDevice(id)  { this.inputDeviceId  = id; this._restartCapture();  }
  setOutputDevice(id) { this.outputDeviceId = id; this._restartPlayback(); }

  // ── Quality ───────────────────────────────────────────────────────────────
  setQuality(presetKey) {
    const p = QUALITY_PRESET[presetKey];
    if (!p) throw new Error(`Unknown preset: ${presetKey}`);
    this.preset = p;
    this._buildCodecs();
    this._restartCapture();
    this._restartPlayback();
    console.log('[AudioEngine] Quality changed to:', p.label);
    return p;
  }

  // ── Codecs ────────────────────────────────────────────────────────────────
  _buildCodecs() {
    const { sampleRate, channels, frameMs } = this.preset;
    const frameSamples = (sampleRate * frameMs) / 1000;

    this.encoder = new OpusScript(sampleRate, channels, OpusScript.Application.AUDIO);
    this.encoder.setBitrate(this.preset.bitrate);

    this.decoder = new OpusScript(sampleRate, channels, OpusScript.Application.AUDIO);
    this._frameSamples = frameSamples;
  }

  // ── Capture (PC → Android) ────────────────────────────────────────────────
  startCapture(onFrameEncoded) {
    if (!this._initialized) throw new Error('Engine not initialized');
    this.captureCallback = onFrameEncoded;
    if (!portAudio) {
      this._startSilenceGenerator();
      return;
    }
    const { sampleRate, channels } = this.preset;
    const framesPerBuffer = this._frameSamples;

    try {
      this.inputStream = portAudio.AudioInput({
        channelCount:    channels,
        sampleFormat:    portAudio.SampleFormat16Bit,
        sampleRate,
        deviceId:        this.inputDeviceId,
        framesPerBuffer,
      });

      this.inputStream.on('data', (chunk) => {
        this._encodeAndDeliver(chunk);
      });

      this.inputStream.on('error', (e) => {
        console.error('[AudioEngine] Input error:', e.message);
        this.emit('error', e);
      });

      this.inputStream.start();
      console.log('[AudioEngine] Capture started');
    } catch (e) {
      console.error('[AudioEngine] startCapture error:', e.message);
      this._startSilenceGenerator();
    }
  }

  stopCapture() {
    if (this._silenceTimer) {
      clearInterval(this._silenceTimer);
      this._silenceTimer = null;
    }
    if (this.inputStream) {
      try { this.inputStream.quit(); } catch {}
      this.inputStream = null;
    }
    this.captureCallback = null;
  }

  _startSilenceGenerator() {
    // Emit silence frames so the stream can still be tested without hardware
    const { sampleRate, channels, frameMs } = this.preset;
    const bytesPerFrame = this._frameSamples * channels * 2;
    const silenceBuf = Buffer.alloc(bytesPerFrame, 0);
    this._silenceTimer = setInterval(() => {
      this._encodeAndDeliver(silenceBuf);
    }, frameMs);
  }

  _encodeAndDeliver(pcmChunk) {
    if (!this.captureCallback) return;
    try {
      const encoded = this.encoder.encode(pcmChunk, this._frameSamples);
      const seq     = this._seqTx++;
      const ts      = Date.now();
      this.captureCallback({ seq, ts, encoded });
    } catch (e) {
      console.error('[AudioEngine] Encode error:', e.message);
    }
  }

  _restartCapture() {
    if (this.captureCallback) {
      const cb = this.captureCallback;
      this.stopCapture();
      this.startCapture(cb);
    }
  }

  // ── Playback (Android → PC) ───────────────────────────────────────────────
  startPlayback() {
    if (!this._initialized) throw new Error('Engine not initialized');
    if (!portAudio) {
      console.warn('[AudioEngine] No naudiodon – playback is no-op');
      return;
    }
    const { sampleRate, channels } = this.preset;

    try {
      this.outputStream = portAudio.AudioOutput({
        channelCount: channels,
        sampleFormat: portAudio.SampleFormat16Bit,
        sampleRate,
        deviceId:     this.outputDeviceId,
        framesPerBuffer: this._frameSamples,
      });

      this.outputStream.on('error', (e) => {
        console.error('[AudioEngine] Output error:', e.message);
      });

      this.outputStream.start();
      this._drainPlaybackQueue();
      console.log('[AudioEngine] Playback started');
    } catch (e) {
      console.error('[AudioEngine] startPlayback error:', e.message);
    }
  }

  stopPlayback() {
    this.playbackQueue = [];
    if (this.outputStream) {
      try { this.outputStream.quit(); } catch {}
      this.outputStream = null;
    }
  }

  /**
   * Feed an Opus-encoded buffer received from Android into the playback chain.
   */
  feedEncodedAudio(opusBuf) {
    if (!this.decoder) return;
    try {
      const pcm = this.decoder.decode(opusBuf);
      if (this.outputStream) {
        this.outputStream.write(Buffer.from(pcm.buffer));
      }
    } catch (e) {
      console.error('[AudioEngine] Decode error:', e.message);
    }
  }

  _drainPlaybackQueue() {
    // Queue drain is handled directly in feedEncodedAudio for low latency
  }

  _restartPlayback() {
    if (this.outputStream) {
      this.stopPlayback();
      this.startPlayback();
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  getStats() {
    return {
      preset:       this.preset.label,
      bitrate:      this.preset.bitrate,
      bufferMs:     this.preset.bufferMs,
      frameMs:      this.preset.frameMs,
      sampleRate:   this.preset.sampleRate,
      channels:     this.preset.channels,
      txSeq:        this._seqTx,
    };
  }
}

module.exports = AudioEngine;
