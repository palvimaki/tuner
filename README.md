# tuner.fi

A privacy-first guitar tuner that runs entirely in your browser.

**Try it:** [tuner.fi](https://tuner.fi)

## Why open source

tuner.fi claims to do all audio processing on-device — your microphone input never leaves your browser. The only way to make that claim credibly verifiable is to publish the code. Read it, audit it, host your own copy.

What you can verify by reading this repo:

- All pitch detection runs in an [AudioWorklet](public/worklets/tuner-processor.js) and the DSP modules under [src/audio/dsp/](src/audio/dsp/).
- The only network calls are a static `/version.json` fetch for update checks ([src/pwa/version.ts](src/pwa/version.ts)) and the service worker caching static assets ([public/sw.js](public/sw.js)).
- No analytics, no telemetry, no third-party runtime dependencies. `package.json` has zero runtime deps.

## Features

- YIN-based pitch detection with MPM fallback, runs in an AudioWorklet off the main thread
- Standard guitar tuning plus alternate tunings ([src/domain/tuning.ts](src/domain/tuning.ts))
- Multiple instrument profiles ([src/domain/instruments/](src/domain/instruments/))
- Installable PWA, works offline after first load
- No sound-producing reference samples are shipped in this build; `/audio/guitar/*.m4a` is intentionally absent

## Local development

Requires Node 22+.

```sh
npm install
npm run dev        # vite dev server
npm test           # vitest
npm run build      # type-check + production build
```

## Architecture

- [src/audio/](src/audio/) — engine, frame protocol, note math
- [src/audio/dsp/](src/audio/dsp/) — YIN, MPM, Goertzel, onset detection, harmonic profiling, smoothing
- [src/domain/](src/domain/) — instrument and tuning definitions
- [src/ui/](src/ui/) — renderer, controls, scene, theme
- [src/app/](src/app/) — bootstrap, state, session
- [src/pwa/](src/pwa/) — service-worker integration, version checks
- [public/worklets/tuner-processor.js](public/worklets/tuner-processor.js) — the AudioWorklet that does pitch detection

## Contributing

Contributions are welcome. For non-trivial changes, please open an issue first so we can discuss the approach before you spend time on a PR.

## Security

To report a security or privacy issue, see [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE). Third-party attributions are in [ATTRIBUTION.md](ATTRIBUTION.md) and [LICENSES/](LICENSES/).
