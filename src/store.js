// All app data lives here. The rest of the app only talks to this module.
// Data is cached on the device (localStorage). When the build has Supabase settings and this
// phone has joined a group, the shared part also syncs with the other families' phones.
import * as sync from './sync.js';

const KEY = 'kidpool:v1';
const SYNC_KEY = 'kidpool:sync';
const listeners = new Set();
const remoteListeners = new Set();
const eventListeners = new Set();
const posListeners = new Set();

// Kept on this phone only. Everything else is shared with the group.
const LOCAL_FIELDS = ['me', 'settings', 'feed', 'seenEvents'];

export const uid = () => Math.random().toString(36).slice(2, 10);

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const TRIP_TYPES = {
  'school-drop': 'School drop-off',
  'school-pickup': 'School pickup',
  class: 'Class or activity',
  'one-off': 'One-off'
};

function seed() {
  const families = [
    { id: 'jessica', name: 'Jessica', color: '#F5B700', fg: '#1B2430', car: 'Toyota Sienna', seats: 7, phone: '' },
    { id: 'sam', name: 'Sam', color: '#1E40AF', fg: '#FFFFFF', car: 'Honda CR-V', seats: 5, phone: '' },
    { id: 'megan', name: 'Megan', color: '#C2410C', fg: '#FFFFFF', car: 'Subaru Outback', seats: 5, phone: '' },
    { id: 'chris', name: 'Chris', color: '#0F766E', fg: '#FFFFFF', car: 'Ford Explorer', seats: 7, phone: '' }
  ];
  const kids = [
    { id: 'mia', name: 'Mia', familyId: 'jessica', booster: false, allergies: '', notes: '' },
    { id: 'zoe', name: 'Zoe', familyId: 'jessica', booster: true, allergies: '', notes: '' },
    { id: 'ethan', name: 'Ethan', familyId: 'sam', booster: false, allergies: '', notes: '' },
    { id: 'lucas', name: 'Lucas', familyId: 'megan', booster: true, allergies: 'Peanuts', notes: '' },
    { id: 'ava', name: 'Ava', familyId: 'chris', booster: false, allergies: '', notes: '' }
  ];
  const places = [
    { id: 'school', name: 'Maple Grove School', note: 'Gate B' },
    { id: 'aqua', name: 'Aqua Center', note: 'Swimming' },
    { id: 'music', name: 'Harmony Music', note: 'Piano' }
  ];
  const all = families.map((f) => f.id);
  const trips = [
    { id: 't-drop', type: 'school-drop', name: 'School drop-off', placeId: 'school', kidIds: ['mia', 'zoe', 'ethan', 'lucas', 'ava'], days: [1, 2, 3, 4, 5], time: '07:45', rotation: all, assignments: {} },
    { id: 't-pick', type: 'school-pickup', name: 'School pickup', placeId: 'school', kidIds: ['mia', 'zoe', 'ethan', 'lucas', 'ava'], days: [1, 2, 3, 4, 5], time: '15:15', rotation: ['megan', 'jessica', 'chris', 'sam'], assignments: {} },
    { id: 't-swim', type: 'class', name: 'Swimming', placeId: 'aqua', kidIds: ['mia', 'zoe', 'lucas'], days: [2, 4], time: '16:30', rotation: ['megan', 'chris'], assignments: {} },
    { id: 't-piano', type: 'class', name: 'Piano', placeId: 'music', kidIds: ['zoe'], days: [3], time: '17:00', rotation: ['jessica'], assignments: {} }
  ];
  return {
    me: 'jessica',
    families, kids, places, trips,
    swaps: [],
    feed: [{ id: uid(), title: 'Welcome to Kidpool', body: 'This is demo data. Edit families and kids in Group.', at: Date.now() }],
    settings: { remindTurn: true, remindMin: 30, tripStarted: true, kidUpdates: true, late: true, allChanges: false, swaps: true },
    activeTrip: null,
    doneTrips: {},
    events: []
  };
}

// Identifies this phone. Two parents of the same family share a family id but not a device id.
export const deviceId = (() => {
  try {
    let d = localStorage.getItem('kidpool:device');
    if (!d) { d = uid() + uid(); localStorage.setItem('kidpool:device', d); }
    return d;
  } catch (e) { return uid() + uid(); }
})();

let state = load();
let link = loadLink(); // { groupId, code, version, dirty } when this phone is in a shared group
let livePos = null;   // the driver's latest position for the running trip
let lastPosRow = null; // the last position row from the server (may arrive before the trip does)
let posChain = Promise.resolve(); // keeps position uploads and deletes in order

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { events: [], doneTrips: {}, ...JSON.parse(raw) };
  } catch (e) { /* storage blocked or bad JSON: start fresh */ }
  return seed();
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

function loadLink() {
  try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || null; } catch (e) { return null; }
}
function saveLink() {
  try { if (link) localStorage.setItem(SYNC_KEY, JSON.stringify(link)); else localStorage.removeItem(SYNC_KEY); } catch (e) { /* ignore */ }
}

function sharedPart(s) {
  const out = {};
  for (const [k, v] of Object.entries(s)) if (!LOCAL_FIELDS.includes(k)) out[k] = v;
  return JSON.parse(JSON.stringify(out));
}
function applyShared(data) {
  const local = Object.fromEntries(LOCAL_FIELDS.map((k) => [k, state[k]]));
  state = { events: [], doneTrips: {}, ...JSON.parse(JSON.stringify(data)), ...local };
  if (!state.families.some((f) => f.id === state.me)) state.me = state.families[0]?.id ?? null;
}
const emit = () => listeners.forEach((l) => l(state));

export const get = () => state;
export function update(fn) {
  const before = link ? JSON.stringify(sharedPart(state)) : '';
  fn(state);
  save();
  emit();
  if (link && JSON.stringify(sharedPart(state)) !== before) queuePush(fn);
}
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export function resetDemo() { state = seed(); save(); emit(); }

// ---------- sharing with the group ----------
export const sharingAvailable = sync.configured;
export const groupInfo = () => (link ? { code: link.code, pending: link.dirty || pending.length > 0 } : null);
export let syncStatus = 'off'; // off | connecting | live | offline
const setStatus = (v) => { if (syncStatus !== v) { syncStatus = v; remoteListeners.forEach((l) => l({ status: true })); } };

// Called after another phone changed the shared data, or when the connection status changes.
export const onRemoteChange = (fn) => (remoteListeners.add(fn), () => remoteListeners.delete(fn));
// Called with group events (trip started, kid picked up...) sent by other phones.
export const onGroupEvent = (fn) => (eventListeners.add(fn), () => eventListeners.delete(fn));
// Called when the driver's live position changes.
export const onLivePos = (fn) => (posListeners.add(fn), () => posListeners.delete(fn));
export const getLivePos = () => livePos;

// Tells the other phones in the group that something happened. kind matches a settings key
// (tripStarted, kidUpdates, late, allChanges, swaps); `to` limits it to one family.
export function tellGroup(kind, title, body, to = null) {
  if (!link) return;
  const ev = { id: uid(), kind, title, body, by: state.me, dev: deviceId, to, at: Date.now() };
  state.seenEvents = [ev.id, ...(state.seenEvents || [])].slice(0, 100);
  update((s) => { s.events = [ev, ...(s.events || [])].slice(0, 30); });
}

function deliverNewEvents() {
  const seen = new Set(state.seenEvents || []);
  const fresh = (state.events || []).filter((e) => !seen.has(e.id)).reverse();
  if (!fresh.length) return;
  state.seenEvents = [...fresh.map((e) => e.id), ...(state.seenEvents || [])].slice(0, 100);
  for (const e of fresh) {
    if ((e.dev ? e.dev === deviceId : e.by === state.me) || (e.to && e.to !== state.me)) continue; // sent by this phone, or for another family
    if (Date.now() - e.at > 6 * 3600000) continue; // too old to alert about
    if (state.settings[e.kind] === false) continue;
    eventListeners.forEach((l) => l(e));
  }
}

let pending = [];   // changes made on this phone that the server doesn't have yet
let pushing = false;
let pushTimer = null;
let stopListening = null;

function queuePush(fn) {
  pending.push(fn);
  link.dirty = true; saveLink();
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 250);
}

async function push() {
  if (!link || pushing) return;
  if (!pending.length && !link.dirty) return;
  pushing = true;
  try {
    for (let tries = 0; tries < 5 && link && (pending.length || link.dirty); tries++) {
      const sent = pending.length;
      const v = await sync.saveGroup(link.groupId, link.version, sharedPart(state));
      if (v >= 0) {
        pending.splice(0, sent);
        link.version = v;
        link.dirty = pending.length > 0;
        saveLink();
        continue;
      }
      // Someone else saved first: take their version and replay this phone's changes on top.
      const row = await sync.fetchGroup(link.groupId);
      applyShared(row.data);
      link.version = row.version;
      for (const f of pending) { try { f(state); } catch (e) { /* that change no longer applies */ } }
      if (!pending.length) link.dirty = false;
      saveLink(); save();
      deliverNewEvents();
      emit();
      remoteListeners.forEach((l) => l({ data: true }));
    }
    setStatus('live');
    remoteListeners.forEach((l) => l({ status: true })); // "Saving…" → "Synced"
  } catch (e) {
    setStatus('offline');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 15000);
  } finally {
    pushing = false;
  }
}

function takeRemote(row) {
  if (!link || row.version <= link.version) return;
  if (pending.length || pushing) { push(); return; } // our save will notice and merge
  applyShared(row.data);
  link.version = row.version; link.dirty = false;
  saveLink(); save();
  takePosition(lastPosRow);
  deliverNewEvents();
  emit();
  remoteListeners.forEach((l) => l({ data: true }));
}

function takePosition(row) {
  lastPosRow = row;
  const a = state.activeTrip;
  if (isDrivingPhone(a)) return; // the driver's own phone has fresher GPS
  livePos = row && a && row.trip_key === `${a.tripId}:${a.date}`
    ? { lat: row.lat, lng: row.lng, acc: row.acc, at: new Date(row.at).getTime(), path: row.path || [] }
    : null;
  posListeners.forEach((l) => l(livePos));
}

// Fetches the latest group data (after start-up, coming back to the app, or reconnecting).
async function refresh() {
  if (!link) return;
  try {
    const row = await sync.fetchGroup(link.groupId);
    if (pending.length) {
      await push(); // merges with the server's version if needed
    } else if (link.dirty && row.version === link.version) {
      await push(); // changes saved on this phone before it was closed
    } else if (row.version !== link.version || link.dirty) {
      // The group moved on while this phone was closed: its version wins.
      link.dirty = false;
      link.version = row.version - 1;
      takeRemote(row);
    }
    takePosition(await sync.fetchPosition(link.groupId));
    setStatus('live');
  } catch (e) {
    setStatus('offline');
  }
}

async function connect() {
  if (!link) return;
  setStatus('connecting');
  if (stopListening) { stopListening(); stopListening = null; }
  try {
    stopListening = await sync.listen(link.groupId, {
      onGroup: takeRemote,
      onPosition: takePosition,
      onStatus: (st) => { if (st === 'SUBSCRIBED') refresh(); else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') setStatus('offline'); }
    });
  } catch (e) {
    setStatus('offline');
  }
}

export async function createSharedGroup() {
  const res = await sync.createGroup(sharedPart(state));
  link = { groupId: res.id, code: res.code, version: res.version, dirty: false };
  state.seenEvents = (state.events || []).map((e) => e.id);
  saveLink(); save();
  await connect();
  registerPhone();
  return res.code;
}

// ---------- families with more than one phone ----------
// A family can have several phones (two parents). They share the family's turns, alerts and
// activity; the group's family list doesn't change. Each phone is listed under state.phones.
export function registerPhone() {
  if (!link) return;
  const cur = state.phones?.[deviceId];
  if (cur && cur.familyId === state.me) return;
  update((s) => { s.phones = { ...(s.phones || {}), [deviceId]: { familyId: s.me, at: Date.now() } }; });
}
export const phonesFor = (familyId) => Object.values(state.phones || {}).filter((p) => p.familyId === familyId).length;

// Invite code for another parent of this family, e.g. ABC234-7QK2. Joining with it puts the
// new phone straight into this family, with no "who are you" question.
export function familyInviteCode() {
  if (!link) return null;
  let fam = state.families.find((f) => f.id === state.me);
  if (!fam) return null;
  if (!fam.joinCode) {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const jc = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
    update((s) => { const f = s.families.find((x) => x.id === s.me); if (f && !f.joinCode) f.joinCode = jc; });
    fam = state.families.find((f) => f.id === state.me);
  }
  return `${link.code}-${fam.joinCode}`;
}

// Puts an activity item on the other phones of this family only, without a pop-up notification.
export function tellFamily(title, body) { tellGroup('family', title, body, state.me); }

// Replaces this phone's shared data with the group's.
// Returns { familyId } when the code was a family invite (ABC234-7QK2), so no need to ask who they are.
export async function joinSharedGroup(code) {
  const clean = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const groupCode = clean.slice(0, 6);
  const famCode = clean.slice(6);
  const res = await sync.joinGroup(groupCode);
  const fam = famCode ? (res.data.families || []).find((f) => f.joinCode === famCode) : null;
  if (famCode && !fam) throw new Error('That family code doesn’t work anymore. Ask for a new invite.');
  link = { groupId: res.id, code: res.code, version: res.version, dirty: false };
  pending = [];
  applyShared(res.data);
  if (fam) state.me = fam.id;
  state.seenEvents = (state.events || []).map((e) => e.id);
  saveLink(); save();
  await connect();
  if (fam) registerPhone(); else emit(); // otherwise registered once they pick their family
  return { familyId: fam?.id ?? null };
}

// Stops syncing. This phone keeps its copy of the data.
export async function leaveSharedGroup() {
  if (state.phones?.[deviceId]) {
    update((s) => { delete s.phones[deviceId]; });
    try { await push(); } catch (e) { /* offline: the entry stays, harmless */ }
  }
  const old = link;
  link = null; pending = []; livePos = null;
  saveLink();
  if (stopListening) { stopListening(); stopListening = null; }
  setStatus('off');
  try { await sync.leaveGroup(old.groupId); } catch (e) { /* offline: membership stays, harmless */ }
  emit();
}

// The driver's phone calls this with each GPS fix while a trip runs.
let lastPosPush = 0;
let posTimer = null;
export function setLivePos(pos) {
  const a = state.activeTrip;
  if (!a) return;
  const path = [...(livePos?.path || []), { lat: pos.lat, lng: pos.lng }].slice(-300);
  livePos = { ...pos, path };
  if (!link) return;
  const send = () => {
    lastPosPush = Date.now();
    const cur = state.activeTrip;
    if (!cur || !livePos) return;
    const row = {
      trip_key: `${cur.tripId}:${cur.date}`, lat: livePos.lat, lng: livePos.lng, acc: livePos.acc,
      at: new Date(livePos.at || Date.now()).toISOString(), path: livePos.path
    };
    const id = link.groupId;
    posChain = posChain.then(() => sync.putPosition(id, row)).catch(() => { /* next fix will try again */ });
  };
  clearTimeout(posTimer);
  const wait = 5000 - (Date.now() - lastPosPush);
  if (wait <= 0) send(); else posTimer = setTimeout(send, wait); // at most one upload every 5 s
}

// True on the phone that started the running trip (not on other phones of the same family).
export const isDrivingPhone = (a = state.activeTrip) => Boolean(a && a.driver === state.me && (!a.device || a.device === deviceId));

export function clearLivePos() {
  clearTimeout(posTimer);
  livePos = null;
  lastPosPush = 0;
  if (link) { const id = link.groupId; posChain = posChain.then(() => sync.clearPosition(id)).catch(() => {}); }
}

if (sync.configured) {
  if (link) connect();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  window.addEventListener('online', () => { refresh(); push(); });
}

export function addFeed(title, body) {
  update((s) => {
    s.feed.unshift({ id: uid(), title, body, at: Date.now() });
    s.feed = s.feed.slice(0, 50);
  });
}

// ---------- dates ----------
export const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export function weekStart(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); }
export function fmtTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  return { time: `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`, ap };
}
export function tripDateTime(trip, dateISO) {
  const d = parseISO(dateISO);
  const [h, m] = trip.time.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

// ---------- who drives ----------
// Each trip has a rotation (list of family ids). The Nth time the trip happens,
// the Nth family in the rotation drives. A tap on a slot can override that for one date
// (assignments[date] = familyId, or null for "nobody yet").
function occurrenceIndex(trip, date) {
  const epoch = new Date(2026, 0, 5); // a Monday
  const days = Math.round((date - epoch) / 86400000);
  const fullWeeks = Math.floor(days / 7);
  const within = trip.days.filter((wd) => ((wd + 6) % 7) < ((date.getDay() + 6) % 7)).length;
  return fullWeeks * trip.days.length + within;
}

export function driverFor(trip, dateISO) {
  if (Object.prototype.hasOwnProperty.call(trip.assignments, dateISO)) return trip.assignments[dateISO];
  if (!trip.rotation.length) return null;
  const n = occurrenceIndex(trip, parseISO(dateISO));
  return trip.rotation[((n % trip.rotation.length) + trip.rotation.length) % trip.rotation.length];
}

export const runsOn = (trip, dateISO) => trip.days.includes(parseISO(dateISO).getDay());

export function tripsOn(dateISO) {
  return state.trips
    .filter((t) => runsOn(t, dateISO))
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((t) => ({ trip: t, date: dateISO, driver: driverFor(t, dateISO) }));
}

export function setDriver(tripId, dateISO, familyId) {
  update((s) => {
    const t = s.trips.find((x) => x.id === tripId);
    t.assignments[dateISO] = familyId;
  });
}

export function fairShare(monthDate = new Date()) {
  const counts = Object.fromEntries(state.families.map((f) => [f.id, 0]));
  const y = monthDate.getFullYear(); const m = monthDate.getMonth();
  for (let d = new Date(y, m, 1); d.getMonth() === m; d = addDays(d, 1)) {
    for (const { driver } of tripsOn(isoDate(d))) if (driver && counts[driver] !== undefined) counts[driver]++;
  }
  return counts;
}

export const family = (id) => state.families.find((f) => f.id === id);
export const kid = (id) => state.kids.find((k) => k.id === id);
export const place = (id) => state.places.find((p) => p.id === id);
export const trip = (id) => state.trips.find((t) => t.id === id);
