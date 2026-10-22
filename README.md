# AudioRelay 🎙️

> **Low-latency bidirectional audio bridge between PC (Windows/Linux/macOS) and Android**

[![Build Android APK](https://github.com/YOUR_USERNAME/audio-relay/actions/workflows/build.yml/badge.svg)](https://github.com/YOUR_USERNAME/audio-relay/actions/workflows/build.yml)

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🚀 **Low Latency** | Opus codec with configurable 10–500ms buffer |
| 🔄 **Bidirectional** | PC→Android, Android→PC, or Full Duplex |
| 📡 **WiFi / LAN** | UDP auto-discovery broadcast + WebSocket audio |
| 🔌 **USB Cable** | ADB reverse port-forwarding for zero-WiFi |
| 🔷 **Bluetooth** | RFCOMM tunnel for no-network scenarios |
| 🎛️ **5 Quality Presets** | Ultra Low Latency → Studio (10ms–500ms buffer) |
| 🎨 **Premium UI** | Dark glassmorphism Electron desktop app |
| 📱 **Android App** | Capacitor-based, built via GitHub Actions |

## 📦 Architecture

```
audio-relay/
├── desktop/              ← Electron app (PC server)
│   ├── src/
│   │   ├── main.js           Electron main process
│   │   ├── preload.js        Context bridge
│   │   ├── audio/
│   │   │   └── engine.js     PortAudio + Opus capture/playback
│   │   └── network/
│   │       ├── control-server.js    WebSocket control plane
│   │       ├── audio-ws-server.js   Binary audio WebSocket
│   │       ├── discovery.js         UDP broadcast beacon
│   │       ├── adb-bridge.js        USB ADB forwarding
│   │       └── bluetooth-bridge.js  RFCOMM tunnel
│   └── renderer/         ← Electron renderer (HTML/CSS/JS UI)
│
├── mobile/               ← Android app (Ionic/Capacitor)
│   ├── src/
│   │   ├── app.js            Main app controller
│   │   ├── audio-engine.js   Web Audio API capture/playback
│   │   └── network-client.js WebSocket client
│   ├── index.html
│   ├── style.css
│   └── capacitor.config.json
│
├── shared/
│   ├── protocol.js           Node.js protocol constants
│   └── protocol-browser.js   ESM browser version
│
└── .github/workflows/
    └── build.yml         GitHub Actions CI/CD
```

## 🚀 Quick Start

### PC Desktop App

```bash
cd desktop
npm install
npm start          # Run in development mode
npm run build:win  # Build Windows installer
npm run build:mac  # Build macOS DMG
npm run build:linux # Build Linux AppImage
```

### Android APK (via GitHub Actions)

1. Push code to GitHub
2. GitHub Actions builds APK automatically
3. Download from **Actions → Artifacts** (debug) or **Releases** (signed release)

> Or build locally:
> ```bash
> cd mobile
> npm install
> npm run build
> npx cap sync android
> cd android && ./gradlew assembleDebug
> ```

## 🌐 Ports Used

| Port | Protocol | Purpose |
|------|----------|---------|
| 7370 | UDP broadcast | Auto-discovery beacon |
| 7371 | HTTP + WebSocket | Audio stream + /info endpoint |
| 7372 | WebSocket | Control channel (commands) |

> Open these ports in your PC firewall for WiFi mode.

## 🎛️ Quality Presets

| Preset | Buffer | Bitrate | Sample Rate | Use Case |
|--------|--------|---------|-------------|----------|
| Ultra Low Latency | 20ms | 64 kbps | 16 kHz mono | Live monitoring |
| **Low Latency** *(default)* | 60ms | 96 kbps | 48 kHz stereo | Gaming, calls |
| Balanced | 120ms | 128 kbps | 48 kHz stereo | General use |
| High Quality | 250ms | 256 kbps | 48 kHz stereo | Music playback |
| Studio | 500ms | 320 kbps | 48 kHz stereo | Recording |

## 🔌 Connection Modes

### WiFi / LAN (Recommended)
- PC broadcasts UDP beacon every 2 seconds
- Android auto-discovers or enter PC IP manually
- No extra setup needed (just be on same network)

### USB Cable (ADB)
1. Enable **USB Debugging** on Android:  
   Settings → Developer Options → USB Debugging ✓
2. Install [Android Platform Tools](https://developer.android.com/tools/releases/platform-tools) on PC
3. Connect USB cable
4. Click **Enable ADB Bridge** in PC app
5. In Android app, select **USB** mode (IP will auto-set to `127.0.0.1`)

### Bluetooth
1. Pair Android with PC via OS Bluetooth settings
2. Click **Scan** in PC app's Connections tab
3. Select your Android device
4. In Android app, select **Bluetooth** mode

> ⚠️ Bluetooth has higher latency (~100–300ms extra). Use **Balanced** or higher preset.

## 🏗️ GitHub Actions – APK Build

Set these **Repository Secrets** for signed release builds:

| Secret | Description |
|--------|-------------|
| `KEYSTORE_BASE64` | Base64-encoded `.keystore` file |
| `KEYSTORE_PASS` | Keystore password |
| `KEY_ALIAS` | Key alias |
| `KEY_PASS` | Key password |

Generate a keystore:
```bash
keytool -genkeypair -v -keystore release.keystore \
  -alias audiorelay -keyalg RSA -keysize 2048 -validity 10000
base64 release.keystore | pbcopy  # macOS; use clip on Windows
```

## 📋 Requirements

### PC
- Node.js 18+
- Electron 33+
- Windows 10 / Ubuntu 20.04+ / macOS 12+
- For USB: [Android Platform Tools](https://developer.android.com/tools/releases/platform-tools)

### Android
- Android 8.0 (API 26) or later
- Microphone permission (for Android→PC streaming)
- USB Debugging (for USB mode)

## 🛠️ Development Notes

- Audio frames use a 12-byte binary header (seq, timestamp, length, flags)
- Opus codec is used for all quality presets — only parameters change
- The UDP audio path is used for WiFi/USB; a WebSocket wrapper is used for Bluetooth
- The desktop renders in a frameless Electron window with a custom titlebar

## 📝 License

MIT — see [LICENSE](LICENSE)
