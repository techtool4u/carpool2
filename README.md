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

## Sharing between the families' phones (Supabase)

With a free [Supabase](https://supabase.com) project, all phones in a group share one schedule:

- One parent taps **Group › Create shared group** and sends the invite code. The others tap **Join with a code** and choose who they are.
- **Two parents, one family:** in Group, tap **Add a parent to my family** and send that code (like `ABC234-7QK2`). The second phone joins straight into your family: same turns, reminders and activity, and the family list doesn't grow. The family card shows "2 phones".
- **Each family looks after its own details:** in a shared group you can add and edit only your own family's kids and details; other families' cards are read-only. (This is checked in the app; enforcing it on the server needs parent logins, a possible next step.)
- Families, kids, places, trips, swaps and the running trip sync live. "I am", alert settings and the activity list stay on each phone.
- While a trip runs, the driver's location shows on the other parents' **Live** screen (sent at most every 5 seconds, and only until *Arrived*).
- Trip started, kid picked up, running late, arrived, swap requests and schedule changes reach the other phones as notifications **while Kidpool is open or recently used**. Alerts to a phone where the app is closed need push notifications (Firebase Cloud Messaging), the next step.
- Two parents editing at the same moment don't overwrite each other: the second save reloads the group and re-applies its change. Changes made offline sync when the phone is back online.

Without Supabase settings the app works as before, with data on each phone only.

### Set it up (once, about 10 minutes)

1. Create a free project at supabase.com.
2. **SQL Editor › New query**: paste all of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. **Authentication › Sign In / Providers**: turn on **Allow anonymous sign-ins**. (Parents don't need accounts; the invite code is what lets a phone into a group, so share it only with the families.)
4. **Project Settings › API** (or **Data API** / **API Keys**): copy the **Project URL** and the **anon public** key (or the **publishable** key). Both are meant to be public; the database rules in `schema.sql` protect the data.
5. In this GitHub repository: **Settings › Secrets and variables › Actions › Variables** › add `SUPABASE_URL` and `SUPABASE_ANON_KEY` with those values.
6. Run the workflows again (push a change or **Actions › Run workflow**). The new APK and web app have sharing turned on.

Free projects pause after about a week with no use (for example over summer break); unpause it in the Supabase dashboard.

For local development, copy `.env.example` to `.env` and fill in the same two values.

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
src/store.js             data, seed data, who-drives rotation logic, group sync
src/sync.js              Supabase calls (only store.js uses it)
supabase/schema.sql      database tables, rules and functions to run in Supabase
src/platform.js          location and notifications (native plugins on Android, web APIs in the browser)
src/styles.css           styles
android/                 Capacitor Android project (permissions in AndroidManifest.xml)
scripts/android-smoke-test.sh   emulator check used by the APK workflow
```

## Ideas for later

Push notifications when the app is closed (FCM), sick-day "no ride needed" toggle, calendar sync, school holiday calendar that pauses trips, group chat, backup driver, traffic and weather warnings, gas cost splitting, trip history, approved-pickup adults per kid, iOS build.
