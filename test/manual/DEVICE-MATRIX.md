# Device Matrix

- Endurance + Safari: browser `/`, permission tap, no reference playback, offline warm reload.
- Endurance + Chrome: browser `/`, permission tap, service-worker update, wake-lock rejection stays silent.
- iPhone Safari tab on current iOS: `/`, first-run mic flow, background/foreground recovery, browser path remains primary escape hatch.
- iPhone installed PWA on `iOS 18.1+`: Add to Home Screen manually from Safari, launch into `/app/`, verify live-sample watchdog, microphone retry state, and no browser-escape glyph.
- Android Chrome tab: `/`, live pitch flow, hidden preset picker, no reference playback.
- Android installed PWA: `/app/`, offline warm reload, wake-lock behavior, service-worker update.
- Optional regression lane: iPhone `iOS 17.6.x`, confirm stalled standalone capture stays in the microphone retry state.
