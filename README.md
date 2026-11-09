# PAWSE

A tiny desktop cat companion driven by real breathing and pulse readings from the
[Presage SmartSpectra SDK](https://smartspectra.presagetech.com/). Built for the SmartSpectra SDK Challenge.

**For general wellness and informational purposes only.** PAWSE is not a medical device. It does not
diagnose, treat or monitor any condition, and it makes no stress or emotion inferences.

> Status: Phase 2.5 (stabilization). The final hand-drawn artwork is not done; the cat is a placeholder.
> See [What is tested vs. unverified](#what-is-tested-vs-unverified) before relying on any claim here.

## Prerequisites

- macOS on Apple Silicon, Windows x64, or Linux x64/arm64 (glibc 2.35+): the platforms the SDK supports.
  Development so far happened on macOS arm64 only.
- Node.js 20+ (developed on Node 24) and npm 11
- A webcam
- A SmartSpectra API key from <https://physiology.presagetech.com/>

## Install

```bash
npm ci        # or npm install
```

npm 11 blocks dependency install scripts until approved. `koffi` and `protobufjs` (required by the SDK) are
approved in `package.json` (`allowScripts`). If `node_modules/electron/dist` is missing afterwards, run:

```bash
node node_modules/electron/install.js
```

## Configure

```bash
cp .env.example .env
# edit .env and set SMARTSPECTRA_API_KEY=<your key>
```

`.env` is git-ignored. The key is read only by the Electron **main** process; it is never sent to the renderer,
never exposed over IPC and never logged (SDK error text is redacted before display).

## Run

```bash
npm run dev      # development with hot reload
npm run build    # production build into out/
npm run start    # run the production build
```

| Script | Purpose |
| --- | --- |
| `npm run typecheck` | strict TypeScript, main/preload/shared and renderer projects |
| `npm run lint` | ESLint |
| `npm test` | Vitest (node + jsdom) |

### macOS camera permission (read this before the first run)

The SDK captures from the camera in the Electron **main** process, so macOS asks for camera access on behalf of
the app that launched it.

- Run `npm run dev` from the macOS **Terminal** app (or another app that has its own camera prompt).
  When Electron is spawned as a child of some other app (an IDE or a desktop assistant), macOS may attribute the
  request to that app and never show a prompt; PAWSE then reports `CameraPermission` after 45 s.
- Accept the prompt. It may name "Terminal" or "Electron".
- If you declined earlier: System Settings → Privacy & Security → Camera, enable the app, and restart PAWSE.
- Packaged builds need their own `NSCameraUsageDescription`, hardened-runtime entitlements and the native
  library shipped as an extra resource (see the SDK's Electron quickstart). Packaging is **not done** yet.

Windows and Linux need no extra permission setup.

## Architecture

```
src/
  shared/    domain model (signal.ts, diagnostics.ts), typed IPC contract (ipc.ts), animation/ engine
  main/      Electron main: SDK service, normalization, diagnostics, config, IPC handlers
  preload/   contextBridge exposing window.pawse (5 typed methods; no ipcRenderer)
  renderer/  React UI (no SDK, no key, no camera)
```

**Main-process SDK with native camera.** `@smartspectra/node-sdk` runs in the main process using
`useCamera(CameraSelection.default)`. The official Electron *renderer* integration needs the API key in the
renderer bundle (the official sample hardcodes it in `renderer.js`), so it was not used. Trade-off: no in-app
camera preview.

Window security: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, all renderer permission
requests denied, navigation blocked, strict CSP in production builds. `start` over IPC requires `{ consent: true }`.

SDK usage (verified against `@smartspectra/node-sdk` 3.4.0):

- Metrics requested: `breathingMetrics` + `cardioMetrics`. Events: `processingStatus`, `validationStatus`, `metrics`, `error`.
- `metrics` buffers are decoded with `decodeMetrics` from `@smartspectra/node-sdk/messages`; readings come from
  `breathing.rate[]` (breaths/min) and `cardio.pulseRate[]` (BPM), latest valid sample. `confidence` (0–100) and
  `stable` are the SDK's own fields; PAWSE computes no confidence.
- A new SDK instance is created per session. Stop, a fatal SDK error or quitting runs `stopAsync()` then `destroy()`.
  Stopping while a start is still waiting for the camera prompt, or during a recovery backoff, cancels it.

### Error resilience

| Situation | Behaviour |
| --- | --- |
| Retryable SDK `error` event | Session keeps running; a notice is shown and cleared when readings resume |
| SDK enters its error state | Up to 3 pipeline recoveries (`stopAsync` → `reset` → `start`, backoff 0.75 s × attempt); budget restored after 30 s of healthy data; then fails with `RecoveryFailed` |
| Non-retryable SDK `error` | Session fails, SDK destroyed, error shown |
| Undecodable metrics packet | Ignored; 5 in a row fail the session (`DecodeError`) |

These paths are covered by unit tests with a fake SDK. **They have not been triggered by the real SDK** (see below).

## Animation (Phase 2)

Pure, DOM-free modules in `src/shared/animation/`, driven in the renderer by `useCatAnimation`.

- Breathing cycle = `60 / breathsPerMinute` s; pulse period = `60 / bpm`. Implausible rates are discarded, never animated.
- Phase accumulation plus first-order smoothing (τ = 2.5 s for rates, 0.6 s for amplitudes), so irregular SDK updates glide.
- States: `idle · searching · settling · connected · stale · error`, derived only from real session state.
- **Hysteresis** (`catStateTracker.ts`): idle/searching/error apply immediately. Among live states, `settling → connected`
  needs 1.5 s, `connected → settling` 4 s, `→ stale` 2 s, `stale → live` 1 s of the new raw state persisting.
- Blinking and ear twitches are ambient (seeded RNG), independent of the signals.
- **Live vs decorative.** The UI shows two chips: Breathing / Heartbeat, each *live reading*, *last reading (paused)*,
  *decorative, not a measurement*, or *off*. With no usable breathing rate the cat breathes at a fixed 12/min that is
  **not** a measurement. The animation follows the *rate*; it is not synchronised to individual breaths or beats.
- `prefers-reduced-motion` scales motion to 40 %.

## Development diagnostics

In a development build (`npm run dev`, not packaged), press **⌘/Ctrl+Shift+D** to toggle a diagnostics panel.
It shows, for the current session: metrics packet counts and gaps, per-signal reading gaps (receive time and the SDK's
own sample timestamps), time to first reading, `stable` flips, stale transitions, validation codes and SDK errors seen,
recoveries, hysteresis state changes, and the animation mapping (period = 60 / current rate).

**Copy report** produces JSON with counts and timings only: no pulse/breathing values, confidence values, frames or
keys (enforced by a test). In packaged builds the main process returns `null` and the panel cannot open.

## Privacy and data handling

What PAWSE itself does:

- Nothing starts without explicit consent (checkbox + Start Session); the camera is released on Stop.
- PAWSE stores no frames and no measurements; values live in memory while a session runs. Electron keeps its usual
  Chromium profile (caches/cookies) under the app's user-data folder; that is not measurement data.
- `enableTelemetry: false`: per the SmartSpectra docs, telemetry is an optional once-per-session aggregate summary
  (SDK/runtime info, performance and quality counters) that excludes raw frames, metric values and identifiers.
- LLM Insights are not used.

What the SDK does that PAWSE does **not** control, as far as we could establish:

- **The SDK talks to Presage services during a session.** In a development run, PAWSE's main process held an
  established TLS connection to `76.223.65.59:443`, which is what `cont-api.physiology.presagetech.com` resolves to
  (checked with `lsof` and DNS). Strings in the SDK's native library also reference AWS Cognito
  (`cognito-idp.us-east-1.amazonaws.com`) and other `*.physiology.presagetech.com` hosts.
- **"Falling back to remote delivery".** The log line `Unable to resolve configured model path. Falling back to
  remote delivery if available.` comes from the SDK's physiology inference step. The npm package ships face and pose
  models but no physiology model, and the library contains messages about "device key provisioning" and
  "remote EMD model delivery", including `device_id is required for remote model download`. Our reading: on first
  use the SDK may download its physiology model from Presage after provisioning a device key tied to a device
  identifier. The official docs only mention remote model delivery as a build option (`SMARTSPECTRA_DISABLE_REMOTE_MODEL_DELIVERY`
  for the C++ SDK) and do not describe it further. The SDK also created an (empty) `~/Library/Caches/SmartSpectraSDK` folder.
- **Therefore it is inaccurate to say the network is used only to validate the API key.** Authentication, device
  provisioning and model delivery all appear to use the network.
- **Whether camera frames or derived signals leave the device is not something we verified.** Traffic is TLS (the docs
  describe a TLS-pinned channel), so its contents cannot be inspected without defeating the protection. What the
  documentation says: metrics are computed on-device; raw video and facial imagery are never transmitted (stated in the
  LLM Insights page); metric values are sent only for LLM Insights, which PAWSE does not use. We have no evidence
  contradicting this and none confirming it for the core metrics path. If this matters for your use, ask Presage
  (support@presagetech.com) to confirm exactly what is exchanged during authentication, device provisioning and
  model delivery.

To see which hosts a running dev session talks to (hosts only, not contents):

```bash
lsof -nP -i -a -c Electron | grep ESTABLISHED
```

## What is tested vs. unverified

| Area | Status | Evidence |
| --- | --- | --- |
| Domain normalization, config parsing, diagnostics math | Tested | unit tests |
| SDK service lifecycle, cleanup, cancellation, recovery, malformed-packet handling | Tested **with a fake SDK** | unit tests |
| IPC handlers (consent gate, channel set) and preload surface | Tested | unit tests |
| Animation engine, state mapping, hysteresis, loop cleanup | Tested | unit tests |
| UI flows (consent, start/stop, blocked/error/notice states, live vs decorative chips, diagnostics toggle, unmount cleanup) | Tested | jsdom tests with a stubbed `window.pawse` |
| Native SDK loads on macOS arm64; camera is listed | Verified once | script on the dev machine |
| Live breathing/pulse readings appear in the app | **Reported working by the project owner; not yet captured with diagnostics** | no recorded run |
| Real metrics cadence, `stable` behaviour, stale frequency | **Unverified** | run a session with the diagnostics panel |
| Cat breathing/heartbeat visibly tracking live rate | **Unverified on a real device** | see manual steps below |
| Recovery from real SDK errors | **Unverified** (never triggered with the real SDK) | |
| What data leaves the device | **Not verified** (see Privacy) | |
| Windows / Linux, packaged builds | **Not tested** | |

Also: the animation was visually checked in a browser with a stubbed `window.pawse` (not the SDK); that proves the
rendering, not the integration.

### Manual verification with a real camera

1. `npm run dev` from Terminal.app; consent; **Start Session**; accept the camera prompt.
2. Sit 0.5–1 m away, face the camera, even light, stay still.
3. Press ⌘/Ctrl+Shift+D. Let it run ≥ 3 minutes.
4. Watch the chips: both should read *live reading* once readings are stable. Compare the cat's cycle to the
   "breath cycle" line in the panel (= 60 / current rate), and your pulse readout with the heartbeat period.
5. Cover the camera for ~20 s: expect *Signal paused*, then recovery when you uncover it.
6. Click **Copy report** and share the JSON; click **Stop Session** and check the camera light goes off.
