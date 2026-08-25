# iPhone browser microphone activation

## Goal

Give a user clear recovery steps when microphone start fails.

## Acceptance

- A successful user request starts the tuner and hides the activation screen.
- A denied permission request shows a clear settings recovery message.
- The user can activate the retry control after a failure.
- An unsupported media request shows a clear browser support message.
- A busy microphone request shows a clear retry message.
- Pointer and keyboard activation start the microphone request.
- One physical pointer tap does not start two microphone requests.
- The app sends no audio, telemetry, or network request for this recovery flow.

## Limits

- The app cannot reopen an iPhone browser permission prompt.
- The app tells the user to change browser settings before retry.
- The implementation uses media API errors. It does not inspect browser names.
