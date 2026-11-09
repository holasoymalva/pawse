# PAWSE

A tiny desktop cat companion driven by real breathing and pulse readings from the
[Presage SmartSpectra SDK](https://smartspectra.presagetech.com/). Built for the SmartSpectra SDK Challenge.

> **Phase 1:** real SDK integration + minimal UI.
> **Phase 2 (this repo state):** deterministic animation engine driving a placeholder cat.
> The final hand-drawn artwork is still to come.

**For general wellness and informational purposes only.** PAWSE is not a medical device. It does not
diagnose, treat or monitor any condition, and it makes no stress or emotion inferences.

## Prerequisites

- macOS on Apple Silicon, Windows x64, or Linux x64/arm64 (glibc 2.35+) — the platforms the SDK supports.
  Phase 1 was developed and run on macOS arm64.
- Node.js 20+ (developed on Node 24) and npm
- A webcam
- A SmartSpectra API key from <https://physiology.presagetech.com/>

## Install

```bash
npm install
```

npm 11 blocks dependency install scripts until approved. `koffi` and `protobufjs` (required by the SDK)
are already approved in `package.json` (`allowScripts`). If Electron's binary is missing afterwards
(`node_modules/electron/dist` does not exist), run:

```bash
node node_modules/electron/install.js
```

## Configure

```bash
cp .env.example .env
# edit .env and set SMARTSPECTRA_API_KEY=<your key>
```

`.env` is git-ignored. The key is read only by the Electron **main** process; it is never sent to the
renderer, never exposed over IPC and never logged (SDK error messages are redacted before display).

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
| `npm test` | Vitest unit tests |

## Architecture

```
src/
  shared/    domain model (signal.ts) + typed IPC contract (ipc.ts)
  main/      Electron main: SDK service, normalization, config, IPC handlers
  preload/   contextBridge exposing window.pawse (4 typed methods; no ipcRenderer)
  renderer/  React UI (no SDK, no key, no camera)
```

**Main-process SDK with native camera.** `@smartspectra/node-sdk` runs in the main process using
`useCamera(CameraSelection.default)`. The official Electron *renderer* integration needs the API key in
the renderer bundle (the official sample hardcodes it in `renderer.js`), so it was not used. Trade-off:
no in-app camera preview (not needed in Phase 1), and the OS camera permission is requested by the main process.

Window security: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, renderer permission
requests denied, navigation blocked, strict CSP in production builds.

SDK usage (verified against `@smartspectra/node-sdk` 3.4.0):

- Metrics requested: `breathingMetrics` + `cardioMetrics`.
- Events: `processingStatus`, `validationStatus`, `metrics`, `error`.
- `metrics` buffers are decoded with `decodeMetrics` from `@smartspectra/node-sdk/messages`; readings come
  from `breathing.rate[]` (breaths/min) and `cardio.pulseRate[]` (BPM), latest valid sample.
  `confidence` (0–100) and `stable` are the SDK's own fields; PAWSE does not compute confidence.
- A new SDK instance is created per session; Stop (or any SDK error, or quitting) runs `stopAsync()` then `destroy()`.
- App policy (not SDK values): readings outside 30–220 BPM / 4–60 br/min are discarded as invalid, and a
  reading with no update for 10 s is shown as stale. Unstable readings (`stable: false`) are shown dimmed as "Settling…".

## Animation engine (Phase 2)

Pure, DOM-free modules in `src/shared/animation/`, driven from the renderer by `useCatAnimation`
(requestAnimationFrame → CSS variables on the SVG; no React re-render per frame).

- `signalMapping.ts`: breathing cycle = `60 / breathsPerMinute` seconds; pulse period = `60 / bpm`.
  Rates outside the plausible ranges are discarded, never animated.
- `catState.ts`: `idle · searching · settling · connected · stale · error`, derived only from real session
  state (`settling` = fresh readings but none `stable` per the SDK; `stale` = no update for 10 s).
- `engine.ts`: phase accumulation (`phase += dt × frequency`) plus first-order smoothing of the rate
  (τ = 2.5 s) and of per-state amplitudes (τ = 0.6 s), so irregular SDK updates glide instead of jumping.
  Same seed + inputs + steps = identical frames. Frame steps are capped at 0.1 s.
- Blinking and ear twitches are ambient: scheduled by a seeded RNG, independent of the signals.
- `loop.ts`: scheduler-injected loop; `dispose()` cancels the pending frame and disables the engine.
- `prefers-reduced-motion` scales motion down to 40 %.

**What the animation does and does not claim.** It follows the measured *rate*. It is not synchronised to
individual breaths or heartbeats (the SDK reports a rate estimate, not onsets). When no breathing rate is
available (resting, searching, error) the cat uses a fixed decorative 12/min cycle, which is not a
measurement and is reported as `breathSource: 'ambient'` by the engine.

## Privacy and data handling

- Nothing starts without explicit consent (checkbox + Start Session). The camera is released on Stop.
- Video frames are processed on-device by the SDK. PAWSE stores no frames and no measurements; values live
  only in memory while a session runs.
- The SDK contacts Presage's servers to authenticate the API key and validate the subscription.
- **Telemetry:** PAWSE sets `enableTelemetry: false`. Per the SmartSpectra docs, telemetry is an optional
  once-per-session aggregate summary (SDK/runtime info, performance and quality counters; it excludes raw
  frames and metric values). With it disabled the SDK starts no telemetry session. This does not remove
  the key-validation network traffic above.
- LLM Insights are not used.

## Manual verification of a real measurement

1. Complete Install and Configure above, then `npm run dev`.
2. Tick the consent box and click **Start Session**. Allow camera access if macOS asks
   (in development the prompt names "Electron").
3. Sit ~0.5–1 m from the camera, face toward it, evenly lit, and stay still.
4. Within roughly 10–30 s, the Breathing and Pulse values should appear and update. Hints such as "Too dark"
   come from the SDK's validation stream.
5. Click **Stop Session**: the camera indicator light should turn off.

Without a key the app shows an "API key missing" state; on an unsupported platform it shows an
"unsupported platform" state.
