# Kidpool

A carpool app for a few families who share school drop-offs, pickups and after-school classes.
One codebase runs as a **web app** (GitHub Pages) and as an **Android app** (APK built by GitHub Actions with Capacitor).

## What it does (v1)

- **Today**: your trips for the day, whose turn it is, a "Start trip" button, and swap requests to answer.
- **Schedule**: a week grid of who drives each trip. Tap a slot to change the driver, claim an empty slot, or ask someone to swap with you. A fair-share count shows how many trips each family drove this month.
- **Add a trip or class**: school drop-off, pickup, classes, or one-off trips; pick kids, days, time, and the order drivers take turns.
- **Live trip**: shares the driver’s location on a map only while a trip is running, a checklist of kids as they’re picked up, and Arrived / Running late buttons.
- **Alerts**: reminders before your turn to drive, trip started, kid picked up, running late, swap requests; each can be switched off.
- **Group**: families, cars and phone numbers, kid cards (booster seat, allergies, notes for drivers), saved places.

The app starts with demo data (Jessica, Sam, Megan and Chris). Change it under **Group**, or tap *Reset to demo data*.

## Important: data stays on each device in v1

v1 saves everything in the phone’s or browser’s local storage. That makes it easy to try, but **the four phones don’t see each other’s changes or location yet.** To share the schedule and live location between families, add a backend:

1. Create a Firebase (Firestore + Auth) or Supabase project.
2. Replace `load()` / `save()` in `src/store.js` with reads and writes to that backend, and subscribe to changes so `update()` listeners fire when another parent edits something.
3. While a trip runs, write `activeTrip.lastPos` to the backend; the other phones show it on their Live screen.
4. Use push notifications (Firebase Cloud Messaging) so alerts reach the other parents, not just this phone.

Everything else in the app only talks to `src/store.js`, so this is the one file that changes.

## Run it locally

```bash
npm install
npm run dev          # web app at http://localhost:5173
npm run build:web    # production build in dist/
```

Android Studio (optional): `npm run android`.

## Builds

| Workflow | What it makes | Where to find it |
| --- | --- | --- |
| `.github/workflows/android-apk.yml` | `Kidpool-1.0.<run>.apk` (and an `.aab` for Google Play when signing secrets are set), then installs it on an emulator as a smoke test | Actions tab › Android APK › the run › Artifacts |
| `.github/workflows/deploy-web.yml` | The web app on GitHub Pages | `https://techtool4u.github.io/carpool2/` |

**Turn on Pages once:** repository Settings › Pages › Source: **GitHub Actions**.

**Optional APK signing** (so each new APK installs over the last one): add repository secrets
`ANDROID_KEYSTORE_BASE64` (the keystore file, base64-encoded), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
Without them, each build is signed with a throwaway debug key, so uninstall the old APK before installing a new one.

## Project layout

```
index.html               app shell
src/main.js              screens and navigation
src/store.js             data, seed data, who-drives rotation logic
src/platform.js          location and notifications (native plugins on Android, web APIs in the browser)
src/styles.css           styles
android/                 Capacitor Android project (permissions in AndroidManifest.xml)
scripts/android-smoke-test.sh   emulator check used by the APK workflow
```

## Ideas for later

Sick-day "no ride needed" toggle, calendar sync, school holiday calendar that pauses trips, group chat, backup driver, traffic and weather warnings, gas cost splitting, trip history, approved-pickup adults per kid, iOS build.
