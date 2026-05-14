# Security policy

tuner.fi is positioned as a privacy-first tool: microphone audio is processed on-device and never sent anywhere. If you find a vulnerability — particularly anything that would undermine that claim — please report it.

## Reporting a vulnerability

Email **palvimaki@gmail.com** with:

- A description of the issue
- Steps to reproduce, or a proof-of-concept
- Your assessment of the impact

Please do **not** open a public GitHub issue for security-sensitive reports.

## What to expect

- Acknowledgement within 7 days.
- A fix or mitigation plan within 30 days for confirmed issues, faster for anything actively exploitable.
- Credit in the release notes if you'd like it.

## Scope

In scope:

- Anything that causes microphone audio, recordings, or derived data to leave the user's device.
- Anything that breaks the offline / on-device processing claim.
- Cross-site scripting, supply-chain issues, or PWA install / service-worker misconfigurations on tuner.fi.

Out of scope:

- Vulnerabilities in dependencies that don't affect tuner.fi as deployed.
- Issues requiring physical access to an unlocked device.
- Browser bugs unless tuner.fi exposes the user to them in a way other sites would not.

## Supported versions

Only the latest deployed version of tuner.fi receives fixes. The PWA auto-updates.
