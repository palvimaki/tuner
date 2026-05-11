# BUILD REPORT

- Shipped a Vite + TypeScript static PWA with dual entry paths: `/` for browser use and `/app/` for installed scope.
- Implemented microphone bootstrap, standalone detection, live-sample watchdog, glass-veil gesture gate, and frosted browser-escape glyph.
- Added self-contained `public/worklets/tuner-processor.js` with inlined MPM pitch detection, dual 2048/4096 analysis windows, onset gating knobs, harmonic profile scoring, and same-note octave penalties.
- Implemented the string-selection state machine: onset latch by log distance, 70-cent post-latch switching guard, four-frame hysteresis, 6 dB same-note octave gate, 1.5 s in-tune lock, and all-strings completion state.
- Built the textless UI: portrait Canvas2D fretboard, six vertical strings, amplitude-driven vibration, active/locked lighting, hidden preset picker, fallback glyph, and shimmer line on completion.
- Added seven guitar tuning presets: Standard, Drop D, Half-step down, Full-step down, DADGAD, Open G, and Open D.
- Added reference pluck playback with `AudioBufferSourceNode.detune` support for alternate tunings.
- Added PWA plumbing: manifest, root-scope service worker registration, skipWaiting, clients.claim, lazy audio caching, version metadata, and wake-lock `.catch()` handling.
- Added extensibility surfaces: `Instrument`, `AnalysisProfile`, `IIP` interfaces, registry wiring, and a bass stub.
- Added deploy/privacy assets: nginx njs IP/UA masking helpers with safe try/catch sentinels, privacy log snippet, deploy script, and Lighthouse script.
- Added Vitest coverage for pitch detection, low-E regression, slack-string latch, same-note octave switching, note math, harmonic scoring, string switching, and session lock/completion.

## Fallbacks / deviations

- UIowa MIS guitar URLs were verified reachable, but those recordings were not shipped.
- Reason: the build brief required shipped third-party samples to be PD/CC0/CC-BY, and the UIowa site language did not provide that explicit grant.
- Shipped fallback: a repo-generated Karplus-Strong pluck pack in `public/audio/guitar/*.m4a`, plus runtime synthesis fallback inside `SamplePlayer`.
- The sample files are AAC/M4A to match the authoritative PLAN-v2 file layout, even though the build brief prose mentioned mp3.

## Verification

- `npm run build` passes and emits `dist/`.
- `npm test` passes: 8 files, 12 tests.
- Current shell bundle output from Vite build:
  - JS `15.47 kB` (`6.02 kB` gzip)
  - CSS `4.03 kB` (`1.33 kB` gzip)
- Static shipped assets are within the stated budget:
  - icons `12K`
  - reference audio `116K`

## Known limitations

- No live device verification was possible from CLI, so the iPhone standalone gate and Safari escape path still need hardware confirmation.
- `scripts/lighthouse.sh` is present, but Lighthouse itself was not run in this session.
