# iPhone browser microphone activation

## Goal

Give a user clear recovery steps when microphone start fails.

## Root cause

The iOS Simulator WebKit browser showed the native permission flow on the first user request.
The user denied that request.
The app caught the resulting media-start failure.
The app restored the unchanged microphone veil.
The app showed no failure or recovery state.
A second tap looked inert because the browser could not reopen permission by itself.
This result does not prove behavior in real iPhone Chrome.

## Acceptance

- A successful user request starts the tuner and hides the activation screen.
- A denied permission request shows a clear settings recovery message.
- The user can activate the retry control after a failure.
- An unsupported media request shows a clear browser support message.
- A busy microphone request shows a clear retry message.
- A user request immediately shows microphone-start progress.
- A user request that stays pending for 20 seconds stops the audio engine.
- A timed-out user request shows a clear retry message.
- A completed engine start without a running audio context shows a clear retry message.
- Pointer and keyboard activation start the microphone request.
- One physical pointer tap does not start two microphone requests.
- The microphone state label does not overlap the microphone icon.
- The activation, progress, and recovery states stay fully visible at 430 by 932 CSS pixels.
- After permission or browser-toolbar changes, the top buttons and string labels stay visible in the active tuner state.
- The microphone control and the two persistent top controls have touch targets of at least 44 by 44 CSS pixels.
- No microphone audio, derived pitch data, or telemetry leaves the device.
- Only existing same-origin static asset, version, and service-worker requests are allowed.

## Limits

- The app cannot reopen an iPhone browser permission prompt.
- The app tells the user to change browser settings before retry.
- The implementation uses media API errors. It does not inspect browser names.
