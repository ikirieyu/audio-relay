/**
 * AudioRelay Mobile – Audio Engine
 *
 * Uses the Web Audio API + AudioWorklet for low-latency capture and playback.
 * Opus encoding/decoding is done via opusscript running in a Web Worker.
 *
 * Capture chain:
 *   getUserMedia → AudioWorklet (PCM chunks) → Opus encode → WebSocket send
 *
 * Playback chain:
 *   WebSocket receive → Opus decode → AudioWorklet → speaker output
 */

const SAMPLE_RATE = 48000;
const CHANNELS    = 2;
const FRAME_MS    = 20;
const FRAME_SAMPS = (SAMPLE_RATE * FRAME_MS) / 1000; // 960 samples

export class MobileAudioEngine {
  constructor() {
    this.ctx         = null;
    this.captureNode = null;
    this.mediaStream = null;
    this.playbackQueue = [];
    this.sampleRate  = SAMPLE_RATE;
    this.channels    = CHANNELS;
    this.frameMs     = FRAME_MS;
    this._pcmBuf     = [];
    this._pcmBufLen  = 0;
    this.onFrame     = null; // callback(Float32Array pcm) → caller encodes & sends
    this._gainNode   = null;
    this._outGain    = null;
    this._playing    = false;
    this._nextPlayTime = 0;
  }

  // ── Initialize ─────────────────────────────────────────────────────────────
  async init(preset) {
    this._applyPreset(preset);
    this.ctx = new AudioContext({
      sampleRate:  this.sampleRate,
      latencyHint: this.frameMs <= 20 ? 'interactive' : 'balanced',
    });

    // Register the capture processor worklet inline
    const captureBlob = new Blob([CAPTURE_PROCESSOR_CODE], { type: 'application/javascript' });
    const captureURL  = URL.createObjectURL(captureBlob);
    await this.ctx.audioWorklet.addModule(captureURL);
    URL.revokeObjectURL(captureURL);

    console.log('[MobileAudio] AudioContext ready, SR:', this.ctx.sampleRate);
  }

  _applyPreset(preset) {
    if (!preset) return;
    this.sampleRate = preset.sampleRate ?? SAMPLE_RATE;
    this.channels   = preset.channels   ?? CHANNELS;
    this.frameMs    = preset.frameMs    ?? FRAME_MS;
  }

  // ── Capture (Android → PC) ─────────────────────────────────────────────────
  async startCapture(onFrame) {
    this.onFrame = onFrame;
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate:         this.sampleRate,
          channelCount:       this.channels,
          echoCancellation:   false,
          noiseSuppression:   false,
          autoGainControl:    false,
          latency:            0.01,
        },
        video: false,
      });
    } catch (e) {
      console.error('[MobileAudio] getUserMedia failed:', e);
      throw e;
    }

    const source = this.ctx.createMediaStreamSource(this.mediaStream);
    this.captureNode = new AudioWorkletNode(this.ctx, 'capture-processor', {
      processorOptions: { frameSamples: FRAME_SAMPS },
      numberOfOutputs: 0,
    });

    this.captureNode.port.onmessage = (e) => {
      if (e.data.pcm && this.onFrame) {
        this.onFrame(e.data.pcm);
      }
    };

    source.connect(this.captureNode);
    console.log('[MobileAudio] Capture started');
  }

  stopCapture() {
    if (this.captureNode) {
      try { this.captureNode.disconnect(); } catch {}
      this.captureNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    this.onFrame = null;
    console.log('[MobileAudio] Capture stopped');
  }

  // ── Playback (PC → Android) ────────────────────────────────────────────────
  startPlayback() {
    this._playing = true;
    this._nextPlayTime = this.ctx.currentTime + 0.05;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    console.log('[MobileAudio] Playback started');
  }

  stopPlayback() {
    this._playing    = false;
    this.playbackQueue = [];
    console.log('[MobileAudio] Playback stopped');
  }

  /**
   * Feed a decoded PCM buffer (Float32 interleaved) into the playback chain.
   * pcmFloat32: Float32Array (interleaved channels)
   */
  feedPCM(pcmFloat32) {
    if (!this._playing || !this.ctx) return;

    const numCh   = this.channels;
    const numSamp = pcmFloat32.length / numCh;
    const buf     = this.ctx.createBuffer(numCh, numSamp, this.sampleRate);

    for (let ch = 0; ch < numCh; ch++) {
      const channelData = buf.getChannelData(ch);
      for (let i = 0; i < numSamp; i++) {
        channelData[i] = pcmFloat32[i * numCh + ch];
      }
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);

    const now      = this.ctx.currentTime;
    const playAt   = Math.max(this._nextPlayTime, now + 0.005);
    src.start(playAt);
    this._nextPlayTime = playAt + numSamp / this.sampleRate;
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  destroy() {
    this.stopCapture();
    this.stopPlayback();
    this.ctx?.close();
    this.ctx = null;
  }
}

// ─── Inline AudioWorklet Processor ───────────────────────────────────────────
const CAPTURE_PROCESSOR_CODE = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._frameSamples = options.processorOptions?.frameSamples ?? 960;
    this._buf = [];
    this._bufLen = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const ch0 = input[0];
    const ch1 = input[1] ?? ch0;
    const n   = ch0.length;

    // Interleave into Int16
    for (let i = 0; i < n; i++) {
      const l = Math.max(-1, Math.min(1, ch0[i]));
      const r = Math.max(-1, Math.min(1, ch1[i]));
      this._buf.push(
        Math.round(l * 32767),
        Math.round(r * 32767)
      );
    }
    this._bufLen += n;

    if (this._bufLen >= this._frameSamples) {
      const frame = new Int16Array(this._frameSamples * 2);
      for (let i = 0; i < this._frameSamples * 2; i++) {
        frame[i] = this._buf[i] ?? 0;
      }
      this._buf.splice(0, this._frameSamples * 2);
      this._bufLen -= this._frameSamples;
      this.port.postMessage({ pcm: frame }, [frame.buffer]);
    }

    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;
