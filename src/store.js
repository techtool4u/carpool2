// All app data lives here. v1 keeps it on this device (localStorage).
// To share between the 4 phones later, swap load()/save() for a backend
// (Firebase, Supabase) — the rest of the app only talks to this module.

const KEY = 'kidpool:v1';
const listeners = new Set();

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
    activeTrip: null
  };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* storage blocked or bad JSON: start fresh */ }
  return seed();
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

export const get = () => state;
export function update(fn) {
  fn(state);
  save();
  listeners.forEach((l) => l(state));
}
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export function resetDemo() { state = seed(); save(); listeners.forEach((l) => l(state)); }

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
