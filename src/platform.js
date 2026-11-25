// Location and notifications. On Android (Capacitor) we use the native plugins;
// in a browser we fall back to the standard web APIs.
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { LocalNotifications } from '@capacitor/local-notifications';
import * as store from './store.js';

export const isNative = Capacitor.isNativePlatform();

// ---------- location ----------
let watchId = null;

export async function startWatching(onPos, onError) {
  stopWatching();
  const opts = { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 };
  if (isNative) {
    try {
      const perm = await Geolocation.requestPermissions({ permissions: ['location'] });
      if (perm.location === 'denied') throw new Error('Location permission was denied. Turn it on in Android Settings › Apps › Kidpool.');
      watchId = await Geolocation.watchPosition(opts, (pos, err) => {
        if (err) return onError(err);
        if (pos) onPos({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, at: pos.timestamp });
      });
    } catch (e) { onError(e); }
    return;
  }
  if (!('geolocation' in navigator)) return onError(new Error('This browser can’t share location.'));
  watchId = navigator.geolocation.watchPosition(
    (p) => onPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: p.timestamp }),
    (e) => onError(new Error(e.code === 1 ? 'Location permission was denied. Allow it in your browser’s site settings.' : 'Couldn’t get your location. Check that location is on.')),
    opts
  );
}

export function stopWatching() {
  if (watchId === null) return;
  if (isNative) Geolocation.clearWatch({ id: watchId });
  else navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

// ---------- notifications ----------
export async function askNotificationPermission() {
  if (isNative) {
    const r = await LocalNotifications.requestPermissions();
    return r.display === 'granted';
  }
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}

export async function notifyNow(title, body) {
  store.addFeed(title, body);
  try {
    if (isNative) {
      await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Math.random() * 2e9), title, body }] });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: './icon.svg' });
    }
  } catch (e) { /* notifications are best effort */ }
}

// Schedules "your turn to drive" reminders for the next 7 days.
let webTimers = [];
export async function scheduleTurnReminders() {
  const s = store.get();
  const items = [];
  if (s.settings.remindTurn) {
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const dateISO = store.isoDate(store.addDays(now, i));
      for (const { trip, driver } of store.tripsOn(dateISO)) {
        if (driver !== s.me) continue;
        const at = new Date(store.tripDateTime(trip, dateISO).getTime() - s.settings.remindMin * 60000);
        if (at <= now) continue;
        const t = store.fmtTime(trip.time);
        const where = store.place(trip.placeId)?.name ?? '';
        items.push({ at, title: `Your turn: ${trip.name}`, body: `${t.time} ${t.ap} at ${where}. ${trip.kidIds.length} kids.` });
      }
    }
  }
  try {
    if (isNative) {
      const pending = await LocalNotifications.getPending();
      const ours = pending.notifications.filter((n) => n.extra?.kind === 'turn');
      if (ours.length) await LocalNotifications.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
      if (items.length) {
        await LocalNotifications.schedule({
          notifications: items.map((it, i) => ({ id: 1000 + i, title: it.title, body: it.body, schedule: { at: it.at, allowWhileIdle: true }, extra: { kind: 'turn' } }))
        });
      }
    } else {
      webTimers.forEach(clearTimeout);
      webTimers = items
        .filter((it) => it.at - Date.now() < 2 ** 31 - 1)
        .map((it) => setTimeout(() => notifyNow(it.title, it.body), it.at - Date.now()));
    }
  } catch (e) { /* ignore */ }
}
