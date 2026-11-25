import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import L from 'leaflet';
import * as S from './store.js';
import * as P from './platform.js';

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICONS = {
  home: '<path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  pin: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2.2.6 3.5 2.6 3.5 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  fwd: '<path d="M9 5l7 7-7 7"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'
};
const icon = (n) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
const todayISO = () => S.isoDate(new Date());

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function avatar(fam, extra = '') {
  if (!fam) return `<span class="avatar chip empty" ${extra}>?</span>`;
  return `<span class="avatar" style="background:${fam.color};color:${fam.fg}" ${extra}>${esc(fam.name[0])}</span>`;
}

function whenHTML(hhmm) {
  const t = S.fmtTime(hhmm);
  return `<div class="when">${t.time}<small>${t.ap}</small></div>`;
}

function kidNames(ids) { return ids.map((id) => S.kid(id)?.name).filter(Boolean).join(', '); }

// ---------- router ----------
const routes = { today: viewToday, schedule: viewSchedule, live: viewLive, alerts: viewAlerts, group: viewGroup, trip: viewTripForm };
let cleanup = null;
let currentRoute = 'today';
let liveKey = '';
let weekOffset = 0;
let mineOnly = false;

function route() {
  const [name, arg] = (location.hash.replace(/^#/, '') || 'today').split('/');
  if (cleanup) { cleanup(); cleanup = null; }
  const fn = routes[name] || viewToday;
  currentRoute = routes[name] ? name : 'today';
  liveKey = '';
  const view = $('#view');
  view.innerHTML = '';
  const res = fn(view, arg);
  if (typeof res === 'function') cleanup = res;
  renderTabs(name === 'trip' ? 'schedule' : name);
  view.scrollTop = 0;
}

function renderTabs(active) {
  const tabs = [['today', 'home', 'Today'], ['schedule', 'cal', 'Schedule'], ['live', 'pin', 'Live'], ['alerts', 'bell', 'Alerts'], ['group', 'users', 'Group']];
  $('#tabs').innerHTML = tabs.map(([id, ic, label]) =>
    `<a class="tab" href="#${id}" ${active === id ? 'aria-current="page"' : ''}><span class="pill">${icon(ic)}</span>${label}</a>`).join('');
}

window.addEventListener('hashchange', route);
S.subscribe(() => {
  if (document.querySelector('dialog[open]') || isFormRoute()) return;
  // The driver's Live screen redraws only when the trip itself changes, so the map and GPS keep running.
  if (currentRoute === 'live' && liveKey && liveKey === tripKey(S.get().activeTrip)) return;
  route();
});
const tripKey = (a) => (a ? `${a.tripId}|${a.date}|${a.driver}` : '');
const isFormRoute = () => location.hash.startsWith('#trip');

// ---------- Today ----------
function viewToday(el) {
  const s = S.get();
  const me = S.family(s.me);
  const date = todayISO();
  const items = S.tripsOn(date);
  const now = new Date();
  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const a = s.activeTrip;
  const swaps = s.swaps.filter((w) => w.status === 'pending' && w.to === s.me);

  let html = `
    <header class="head">
      <div><div class="sub">${esc(dateLabel)}</div><h1>Hi ${esc(me?.name ?? '')}</h1></div>
      <a href="#group" aria-label="Your group">${avatar(me)}</a>
    </header>`;

  if (a) {
    const t = S.trip(a.tripId);
    const driver = S.family(a.driver);
    const picked = Object.keys(a.picked).length;
    html += `
      <a class="live" href="#live">
        <span class="kicker">Live now</span>
        <span class="title">${esc(driver?.name)} is driving: ${esc(t?.name)}</span>
        <span class="row-between small"><span>${picked} of ${t?.kidIds.length ?? 0} kids picked up</span><span class="go">Track</span></span>
      </a>`;
  }

  html += `<section class="section"><div class="row-between"><h2>Today’s trips</h2><a class="small" href="#schedule"><b>Full week</b></a></div>`;
  if (!items.length) {
    html += `<div class="card empty-state"><span class="muted">No trips today.</span><a class="btn dark" href="#trip/new">${icon('plus')}Add a trip</a></div>`;
  }
  for (const { trip, driver } of items) {
    const fam = S.family(driver);
    const mine = driver === s.me;
    const running = a && a.tripId === trip.id && a.date === date;
    const done = (s.doneTrips || {})[`${trip.id}:${date}`];
    const place = S.place(trip.placeId)?.name ?? '';
    let tag = '';
    if (running) tag = '<span class="tag blue">On the way</span>';
    else if (done) tag = '<span class="tag blue">Done</span>';
    else if (mine) tag = '<span class="tag you">You drive</span>';
    else if (!fam) tag = '<button class="tag empty" data-claim="' + trip.id + '">Needs a driver</button>';
    html += `
      <article class="card ${mine && !done ? 'strong' : ''}">
        <div class="trip">${whenHTML(trip.time)}
          <div class="what"><b>${esc(trip.name)}</b><span class="small muted">${esc(fam ? (mine ? 'You' : fam.name) : 'Nobody yet')} · ${esc(kidNames(trip.kidIds))}${place ? ' · ' + esc(place) : ''}</span></div>
          ${tag}
        </div>
        ${mine && !running && !done && !a ? `<button class="btn dark block" style="margin-top:12px" data-start="${trip.id}">Start trip and share location</button>` : ''}
      </article>`;
  }
  html += '</section>';

  for (const w of swaps) {
    const t = S.trip(w.tripId);
    const from = S.family(w.from);
    const d = S.parseISO(w.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const tm = S.fmtTime(t.time);
    html += `
      <section class="card soft" aria-label="Swap request">
        <p style="margin:0 0 10px"><b>${esc(from?.name)}</b> asks if you can cover <b>${esc(t.name)}, ${esc(d)} at ${tm.time} ${tm.ap}</b>.</p>
        <div class="btns"><button class="btn dark" data-swap-yes="${w.id}">Accept swap</button><button class="btn" data-swap-no="${w.id}">Not this time</button></div>
      </section>`;
  }

  el.innerHTML = html;
  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.start) startTrip(b.dataset.start, date);
    if (b.dataset.claim) { S.setDriver(b.dataset.claim, date, s.me); S.tellGroup('allChanges', 'Driver found', `${S.family(s.me)?.name} will drive ${S.trip(b.dataset.claim)?.name} today.`); toast('You’re driving this one.'); P.scheduleTurnReminders(); }
    if (b.dataset.swapYes) answerSwap(b.dataset.swapYes, true);
    if (b.dataset.swapNo) answerSwap(b.dataset.swapNo, false);
  };
}

function answerSwap(id, yes) {
  const s = S.get();
  const w = s.swaps.find((x) => x.id === id);
  if (!w) return;
  S.update((st) => {
    const sw = st.swaps.find((x) => x.id === id);
    sw.status = yes ? 'accepted' : 'declined';
    if (yes) st.trips.find((t) => t.id === w.tripId).assignments[w.date] = w.to;
  });
  const t = S.trip(w.tripId);
  P.notifyNow(yes ? 'Swap accepted' : 'Swap declined', `${t.name} on ${w.date}: ${yes ? 'you’re driving now' : S.family(w.from)?.name + ' still drives'}.`);
  S.tellGroup('swaps', yes ? 'Swap accepted' : 'Swap declined', `${S.family(w.to)?.name} ${yes ? 'will drive' : 'can’t drive'} ${t.name} on ${w.date}.`, w.from);
  P.scheduleTurnReminders();
}

// ---------- trips: start / end ----------
async function startTrip(tripId, date) {
  const s = S.get();
  S.clearLivePos();
  S.update((st) => { st.activeTrip = { tripId, date, driver: s.me, startedAt: Date.now(), picked: {} }; });
  const t = S.trip(tripId);
  if (s.settings.tripStarted) P.notifyNow('Trip started', `${S.family(s.me).name} is on the way: ${t.name}.`);
  S.tellGroup('tripStarted', 'Trip started', `${S.family(s.me).name} is on the way: ${t.name}. Open Live to follow.`);
  location.hash = '#live';
}

function endTrip() {
  const s = S.get();
  const a = s.activeTrip;
  if (!a) return;
  const t = S.trip(a.tripId);
  P.stopWatching();
  S.clearLivePos();
  S.update((st) => {
    st.doneTrips = st.doneTrips || {};
    st.doneTrips[`${a.tripId}:${a.date}`] = Date.now();
    st.activeTrip = null;
  });
  P.notifyNow('Arrived', `${t?.name ?? 'Trip'} finished. Location sharing stopped.`);
  S.tellGroup('kidUpdates', 'Arrived', `${S.family(a.driver)?.name} arrived: ${t?.name ?? 'trip'} is done.`);
  location.hash = '#today';
}

// ---------- Live ----------
function viewLive(el) {
  const s = S.get();
  const a = s.activeTrip;
  if (!a) {
    const mine = S.tripsOn(todayISO()).filter((x) => x.driver === s.me && !(s.doneTrips || {})[`${x.trip.id}:${x.date}`]);
    el.innerHTML = `
      <header class="head"><h1>Live trip</h1></header>
      <div class="card empty-state">
        <p style="margin:0">No trip is running.</p>
        <p class="small muted" style="margin:0">Your location is shared only while you drive a trip, and stops when you tap Arrived.</p>
        ${mine.map(({ trip }) => `<button class="btn dark block" data-start="${trip.id}">Start ${esc(trip.name)} (${S.fmtTime(trip.time).time} ${S.fmtTime(trip.time).ap})</button>`).join('')}
        ${mine.length ? '' : '<a class="btn" href="#schedule">See the schedule</a>'}
      </div>`;
    el.onclick = (e) => { const b = e.target.closest('[data-start]'); if (b) startTrip(b.dataset.start, todayISO()); };
    return;
  }

  const t = S.trip(a.tripId);
  const driver = S.family(a.driver);
  const isDriver = a.driver === s.me;
  liveKey = isDriver ? tripKey(a) : '';
  if (!t) return void (el.innerHTML = '<header class="head"><h1>Live trip</h1></header><p class="muted">This trip was deleted.</p>');
  const place = S.place(t.placeId);
  const tm = S.fmtTime(t.time);
  el.innerHTML = `
    <header class="head">
      <div><div class="sub">Started ${new Date(a.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div><h1>${esc(t.name)}</h1></div>
      ${avatar(driver)}
    </header>
    <div id="map" class="map" role="img" aria-label="Map showing the driver’s location"></div>
    <p class="tiny muted" id="loc-status" style="margin:-8px 0 0">${isDriver ? 'Finding your location…' : `Waiting for ${esc(driver?.name)}’s location…`}</p>
    <section class="card">
      <div class="row-between" style="margin-bottom:6px"><h2>${esc(driver?.name)} · ${esc(driver?.car ?? '')}</h2><span class="small muted">due ${tm.time} ${tm.ap}</span></div>
      <ol class="stops">
        ${t.kidIds.map((id) => {
          const k = S.kid(id); const at = a.picked[id];
          return `<li class="stop">
            <button class="check" role="checkbox" aria-checked="${at ? 'true' : 'false'}" aria-label="${esc(k?.name)} picked up" data-kid="${id}" ${isDriver ? '' : 'disabled'}>${at ? icon('check') : ''}</button>
            <span><b>${esc(k?.name)}</b>${k?.booster ? ' <span class="small muted">· booster</span>' : ''}${k?.allergies ? ` <span class="small muted">· ${esc(k.allergies)} allergy</span>` : ''}</span>
            <span class="small muted">${at ? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'waiting'}</span>
          </li>`;
        }).join('')}
        <li class="stop"><span></span><span><b>${esc(place?.name ?? 'Destination')}</b></span><span class="small muted">${esc(place?.note ?? '')}</span></li>
      </ol>
    </section>
    ${isDriver ? `<div class="btns">
      <button class="btn dark" data-arrived>Arrived</button>
      <button class="btn" data-late>Running late</button>
    </div>` : `${driver?.phone ? `<a class="btn block" href="tel:${esc(driver.phone)}">Call ${esc(driver.name)}</a>` : ''}`}
    <p class="tiny muted" style="margin:0">${S.groupInfo()
      ? (isDriver ? 'The families in your group see your location until you tap Arrived.' : `${esc(driver?.name)}’s location is shared only during this trip.`)
      : 'Your location shows on this phone only. To share it with the other families, set up a shared group under Group.'}</p>`;

  // map
  const map = L.map($('#map', el), { zoomControl: false, attributionControl: true }).setView([39.5, -98.35], 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  const line = L.polyline([], { color: '#1E40AF', weight: 5 }).addTo(map);
  const marker = L.circleMarker([0, 0], { radius: 10, color: '#fff', weight: 3, fillColor: '#1E40AF', fillOpacity: 1 });
  let first = true;
  let alive = true;
  const status = $('#loc-status', el);
  const show = (pos) => {
    if (!alive || !pos) return;
    marker.setLatLng([pos.lat, pos.lng]);
    if (!map.hasLayer(marker)) marker.addTo(map);
    if (pos.path) line.setLatLngs(pos.path.map((p) => [p.lat, p.lng]));
    if (first) { map.setView([pos.lat, pos.lng], 15); first = false; } else map.panTo([pos.lat, pos.lng], { animate: false });
    status.textContent = `Live · updated ${new Date(pos.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}${pos.acc ? ` · ±${Math.round(pos.acc)} m` : ''}`;
  };
  show(S.getLivePos());

  let stopPos = () => {};
  if (isDriver) {
    P.startWatching((pos) => { if (!alive) return; S.setLivePos(pos); show(S.getLivePos()); },
      (err) => { status.textContent = err.message || 'Couldn’t get your location.'; });
  } else {
    stopPos = S.onLivePos(show);
    if (!S.groupInfo()) status.textContent = `${driver?.name} is driving. Their location shows on their phone only until you set up a shared group.`;
  }
  setTimeout(() => { if (alive) map.invalidateSize(); }, 50);

  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.kid && isDriver) {
      const id = b.dataset.kid;
      const was = !!S.get().activeTrip.picked[id];
      S.update((st) => { if (was) delete st.activeTrip.picked[id]; else st.activeTrip.picked[id] = Date.now(); });
      if (!was && S.get().settings.kidUpdates) P.notifyNow(`${S.kid(id).name} was picked up`, `${driver.name} picked up ${S.kid(id).name}.`);
      if (!was) S.tellGroup('kidUpdates', `${S.kid(id).name} was picked up`, `${driver.name} picked up ${S.kid(id).name} for ${t.name}.`);
      paintKid(b, S.get().activeTrip?.picked[id]);
    }
    if (b.hasAttribute('data-arrived') && isDriver) endTrip();
    if (b.hasAttribute('data-late') && isDriver) {
      P.notifyNow('Running late', `${driver.name} is running about 10 minutes late for ${t.name}.`);
      S.tellGroup('late', 'Running late', `${driver.name} is running about 10 minutes late for ${t.name}.`);
      toast(S.groupInfo() ? 'Group told you’re running late.' : 'Noted. Set up a shared group so the other families get this.');
    }
  };
  return () => { alive = false; stopPos(); if (isDriver) P.stopWatching(); map.off(); map.remove(); };
}

function paintKid(btn, at) {
  btn.setAttribute('aria-checked', at ? 'true' : 'false');
  btn.innerHTML = at ? icon('check') : '';
  const when = btn.closest('.stop')?.lastElementChild;
  if (when) when.textContent = at ? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'waiting';
}

// ---------- Schedule ----------
function viewSchedule(el) {
  const s = S.get();
  const start = S.addDays(S.weekStart(new Date()), weekOffset * 7);
  const days = [0, 1, 2, 3, 4].map((i) => S.addDays(start, i));
  const end = days[4];
  const label = `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  const today = todayISO();
  const trips = [...s.trips].sort((a, b) => a.time.localeCompare(b.time))
    .filter((t) => !mineOnly || days.some((d) => t.days.includes(d.getDay()) && S.driverFor(t, S.isoDate(d)) === s.me));

  let grid = `<div class="dh"></div>${days.map((d) => `<div class="dh ${S.isoDate(d) === today ? 'today' : ''}">${d.toLocaleDateString(undefined, { weekday: 'short' })}<br>${d.getDate()}</div>`).join('')}`;
  for (const t of trips) {
    const tm = S.fmtTime(t.time);
    grid += `<button class="rl" data-edit="${t.id}" aria-label="Edit ${esc(t.name)}">${esc(t.name)}<span>${tm.time} ${tm.ap.toLowerCase()}</span></button>`;
    for (const d of days) {
      const iso = S.isoDate(d);
      if (!t.days.includes(d.getDay())) { grid += '<div class="cell"><span class="chip none"></span></div>'; continue; }
      const drv = S.driverFor(t, iso);
      const f = S.family(drv);
      const dim = mineOnly && drv !== s.me ? 'opacity:.25;' : '';
      grid += f
        ? `<div class="cell"><button class="chip" style="background:${f.color};color:${f.fg};${dim}" data-slot="${t.id}|${iso}" aria-label="${esc(t.name)} ${esc(iso)}: ${esc(f.name)} drives">${esc(f.name[0])}</button></div>`
        : `<div class="cell"><button class="chip empty" data-slot="${t.id}|${iso}" aria-label="${esc(t.name)} ${esc(iso)}: nobody yet">+</button></div>`;
    }
  }

  const counts = S.fairShare(start);
  const max = Math.max(1, ...Object.values(counts));
  const monthName = start.toLocaleDateString(undefined, { month: 'long' });

  el.innerHTML = `
    <header class="head">
      <div><div class="sub">${esc(label)}</div><h1>${weekOffset === 0 ? 'This week' : weekOffset === 1 ? 'Next week' : weekOffset === -1 ? 'Last week' : 'Week view'}</h1></div>
      <div class="btns" style="flex:0">
        <button class="btn round ghost" data-week="-1" aria-label="Previous week">${icon('back')}</button>
        <button class="btn round ghost" data-week="1" aria-label="Next week">${icon('fwd')}</button>
        <a class="btn round dark" href="#trip/new" aria-label="Add a trip or class">${icon('plus')}</a>
      </div>
    </header>
    <div class="segment" role="group" aria-label="View">
      <button aria-pressed="${!mineOnly}" data-mine="0">Everyone</button>
      <button aria-pressed="${mineOnly}" data-mine="1">Mine only</button>
    </div>
    <section class="card grid-wrap" aria-label="Week grid">
      ${trips.length ? `<div class="week">${grid}</div>` : '<p class="muted" style="margin:0">Nothing to show for this week.</p>'}
      <div class="legend">${s.families.map((f) => `<span><i style="background:${f.color}"></i>${esc(f.name)}</span>`).join('')}</div>
    </section>
    <p class="tiny muted" style="margin:-8px 0 0">Tap a slot to change the driver or ask for a swap. Tap a trip name to edit it.</p>
    <section class="card section" aria-label="Fair share">
      <div class="row-between"><h2>Fair share · ${esc(monthName)}</h2><span class="tiny muted">trips driven</span></div>
      ${s.families.map((f) => `<div class="bar"><span>${esc(f.name)}</span><span class="track"><span class="fill" style="display:block;width:${(counts[f.id] / max) * 100}%;background:${f.color}"></span></span><b style="text-align:right">${counts[f.id]}</b></div>`).join('')}
    </section>`;

  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.week) { weekOffset += Number(b.dataset.week); route(); }
    if (b.dataset.mine) { mineOnly = b.dataset.mine === '1'; route(); }
    if (b.dataset.edit) location.hash = `#trip/${b.dataset.edit}`;
    if (b.dataset.slot) { const [tid, iso] = b.dataset.slot.split('|'); slotSheet(tid, iso); }
  };
}

function slotSheet(tripId, iso) {
  const s = S.get();
  const t = S.trip(tripId);
  const current = S.driverFor(t, iso);
  const d = S.parseISO(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const mine = current === s.me;
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `
    <h2>${esc(t.name)}</h2>
    <p class="small muted" style="margin:0">${esc(d)} at ${S.fmtTime(t.time).time} ${S.fmtTime(t.time).ap}</p>
    <p class="legend-label" style="margin:16px 0 0">${mine ? 'Ask someone to swap with you' : 'Who drives?'}</p>
    <div class="sheet-list">
      ${s.families.filter((f) => !(mine && f.id === s.me)).map((f) => `<button data-fam="${f.id}" aria-pressed="${f.id === current}">${avatar(f)}${esc(f.name)}${f.id === s.me ? ' (me)' : ''}</button>`).join('')}
      ${mine ? '' : `<button data-fam="" aria-pressed="${!current}"><span class="avatar chip empty">?</span>Nobody yet</button>`}
    </div>
    <button class="btn block" data-close>Cancel</button>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  const close = () => { dlg.close(); dlg.remove(); route(); };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.onclick = (e) => {
    if (e.target === dlg) return close();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-close')) return close();
    if (b.dataset.fam !== undefined) {
      const fam = b.dataset.fam || null;
      if (mine) {
        S.update((st) => st.swaps.push({ id: S.uid(), tripId, date: iso, from: st.me, to: fam, status: 'pending' }));
        toast(`Swap request sent to ${S.family(fam).name}.`);
        S.addFeed('Swap requested', `You asked ${S.family(fam).name} to cover ${t.name} on ${d}.`);
        S.tellGroup('swaps', 'Swap request', `${S.family(S.get().me)?.name} asks if you can drive ${t.name} on ${d}. Open Today to answer.`, fam);
      } else {
        S.setDriver(tripId, iso, fam);
        if (S.get().settings.allChanges) P.notifyNow('Schedule changed', `${t.name} on ${d}: ${fam ? S.family(fam).name : 'nobody yet'}.`);
        S.tellGroup('allChanges', 'Schedule changed', `${t.name} on ${d}: ${fam ? S.family(fam).name + ' drives' : 'needs a driver'} (changed by ${S.family(S.get().me)?.name}).`);
        toast('Schedule updated.');
      }
      P.scheduleTurnReminders();
      close();
    }
  };
}

// ---------- Add / edit trip ----------
function viewTripForm(el, id) {
  const s = S.get();
  const existing = id && id !== 'new' ? S.trip(id) : null;
  const draft = existing ? JSON.parse(JSON.stringify(existing)) : { id: S.uid(), type: 'class', name: '', placeId: s.places[0]?.id ?? '', kidIds: [], days: [], time: '16:00', rotation: s.families.map((f) => f.id), assignments: {} };
  const order = [1, 2, 3, 4, 5, 6, 0];

  const paint = () => {
    el.innerHTML = `
      <header class="head">
        <div class="btns" style="flex:0;align-items:center;gap:4px">
          <a class="btn round ghost" href="#schedule" aria-label="Close">${icon('close')}</a>
          <h1 style="font-size:22px">${existing ? 'Edit trip' : 'New recurring trip'}</h1>
        </div>
      </header>
      <form id="tf" class="section" style="gap:16px" novalidate>
        <div class="chips" role="group" aria-label="Trip type">
          ${Object.entries(S.TRIP_TYPES).map(([k, v]) => `<button type="button" class="toggle-chip dark" data-type="${k}" aria-pressed="${draft.type === k}">${v}</button>`).join('')}
        </div>
        <div class="field"><label for="f-name">Name</label><input id="f-name" class="input" value="${esc(draft.name)}" placeholder="For example, Swimming" required></div>
        <div class="field"><label for="f-place">Place</label>
          <select id="f-place" class="input">${s.places.map((p) => `<option value="${p.id}" ${p.id === draft.placeId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}<option value="__new">Add a new place…</option></select>
        </div>
        <fieldset><legend>Kids</legend><div class="chips">
          ${s.kids.map((k) => `<button type="button" class="toggle-chip" data-kid="${k.id}" aria-pressed="${draft.kidIds.includes(k.id)}">${esc(k.name)}</button>`).join('')}
        </div></fieldset>
        <fieldset><legend>${draft.type === 'one-off' ? 'Day' : 'Repeats on'}</legend><div class="days">
          ${order.map((d) => `<button type="button" data-day="${d}" aria-pressed="${draft.days.includes(d)}" aria-label="${S.DAY_NAMES[d]}">${S.DAY_NAMES[d][0]}</button>`).join('')}
        </div></fieldset>
        <div class="field"><label for="f-time">Time</label><input id="f-time" type="time" class="input" value="${esc(draft.time)}"></div>
        <fieldset><legend>Drivers take turns in this order</legend><div class="chips">
          ${s.families.map((f) => `<button type="button" class="toggle-chip" data-rot="${f.id}" aria-pressed="${draft.rotation.includes(f.id)}">${esc(f.name)}</button>`).join('')}
        </div><p class="tiny muted" style="margin:8px 0 0">Leave all off to fill each slot by hand.</p></fieldset>
        <p id="f-err" class="small" style="color:#B42318;margin:0" role="alert"></p>
        <button class="btn accent block" type="submit">${existing ? 'Save changes' : 'Save and notify group'}</button>
        ${existing ? '<button class="btn block" type="button" data-delete>Delete this trip</button>' : ''}
      </form>`;
  };
  paint();

  const sync = () => { draft.name = $('#f-name', el).value; draft.time = $('#f-time', el).value; const p = $('#f-place', el).value; if (p !== '__new') draft.placeId = p; };
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  el.onclick = (e) => {
    const b = e.target.closest('button[type="button"]');
    if (!b) return;
    sync();
    if (b.dataset.type) draft.type = b.dataset.type;
    if (b.dataset.kid) draft.kidIds = toggle(draft.kidIds, b.dataset.kid);
    if (b.dataset.day) { const d = Number(b.dataset.day); draft.days = draft.type === 'one-off' ? [d] : toggle(draft.days, d); }
    if (b.dataset.rot) draft.rotation = toggle(draft.rotation, b.dataset.rot);
    if (b.hasAttribute('data-delete')) {
      if (confirm(`Delete ${existing.name}? This removes it for everyone in the group.`)) {
        S.update((st) => { st.trips = st.trips.filter((t) => t.id !== existing.id); });
        S.tellGroup('allChanges', 'Trip removed', `${S.family(S.get().me)?.name} removed ${existing.name}.`);
        toast('Trip deleted.'); location.hash = '#schedule';
      }
      return;
    }
    paint();
  };
  el.onchange = (e) => {
    if (e.target.id === 'f-place' && e.target.value === '__new') {
      const name = prompt('Name of the new place');
      if (name && name.trim()) {
        const pid = S.uid();
        S.get().places.push({ id: pid, name: name.trim(), note: '' });
        sync(); draft.placeId = pid; paint();
      } else e.target.value = draft.placeId;
    }
  };
  el.onsubmit = (e) => {
    e.preventDefault();
    sync();
    const err = $('#f-err', el);
    if (!draft.name.trim()) return (err.textContent = 'Give the trip a name.');
    if (!draft.kidIds.length) return (err.textContent = 'Pick at least one kid.');
    if (!draft.days.length) return (err.textContent = 'Pick at least one day.');
    draft.name = draft.name.trim();
    S.update((st) => {
      const i = st.trips.findIndex((t) => t.id === draft.id);
      if (i >= 0) st.trips[i] = draft; else st.trips.push(draft);
    });
    S.tellGroup('allChanges', existing ? 'Trip updated' : 'New trip added', `${S.family(S.get().me)?.name} ${existing ? 'changed' : 'added'} ${draft.name}.`);
    P.notifyNow(existing ? 'Trip updated' : 'New trip added', `${draft.name}, ${draft.days.map((d) => S.DAY_NAMES[d].slice(0, 3)).join(', ')} at ${S.fmtTime(draft.time).time} ${S.fmtTime(draft.time).ap}.`);
    P.scheduleTurnReminders();
    location.hash = '#schedule';
  };
}

// ---------- Alerts ----------
function viewAlerts(el) {
  const s = S.get();
  const opts = [
    ['remindTurn', 'It’s my turn to drive'],
    ['tripStarted', 'The driver starts a trip'],
    ['kidUpdates', 'My kid is picked up or dropped off'],
    ['late', 'A trip is running late'],
    ['allChanges', 'Every schedule change in the group'],
    ['swaps', 'Someone asks me to swap a trip']
  ];
  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'now'; if (m < 60) return `${m} min`; if (m < 1440) return `${Math.round(m / 60)} h`;
    return new Date(t).toLocaleDateString(undefined, { weekday: 'short' });
  };
  el.innerHTML = `
    <header class="head"><h1>Alerts</h1><button class="btn" data-perm>Allow notifications</button></header>
    <section class="section" aria-label="Recent">
      <h2>Recent</h2>
      ${s.feed.slice(0, 8).map((f) => `<article class="card feed-item"><span class="d"></span><div><b>${esc(f.title)}</b><div class="small muted">${esc(f.body)}</div></div><span class="tiny muted">${ago(f.at)}</span></article>`).join('') || '<p class="muted">Nothing yet.</p>'}
    </section>
    <section aria-label="Notify me when">
      <h2 style="margin-bottom:8px">Notify me when</h2>
      <div class="list">
        ${opts.map(([k, label]) => `<div class="li"><span id="lbl-${k}">${label}</span><button class="switch" role="switch" aria-checked="${!!s.settings[k]}" aria-labelledby="lbl-${k}" data-set="${k}"></button></div>`).join('')}
        <div class="li"><label for="remind-min">Remind me before my turn</label>
          <select id="remind-min" class="input" style="width:auto;min-height:40px">${[10, 15, 30, 45, 60].map((m) => `<option value="${m}" ${s.settings.remindMin === m ? 'selected' : ''}>${m} min</option>`).join('')}</select>
        </div>
      </div>
    </section>
    <button class="btn block" data-test>Send a test notification</button>`;
  el.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.set) { S.update((st) => { st.settings[b.dataset.set] = !st.settings[b.dataset.set]; }); P.scheduleTurnReminders(); }
    if (b.hasAttribute('data-perm')) toast((await P.askNotificationPermission()) ? 'Notifications are on.' : 'Notifications are blocked. Turn them on in settings.');
    if (b.hasAttribute('data-test')) { await P.askNotificationPermission(); P.notifyNow('Test from Kidpool', 'Notifications are working.'); }
  };
  el.onchange = (e) => { if (e.target.id === 'remind-min') { S.update((st) => { st.settings.remindMin = Number(e.target.value); }); P.scheduleTurnReminders(); } };
}

// ---------- Group ----------
function viewGroup(el) {
  const s = S.get();
  el.innerHTML = `
    <header class="head">
      <div><div class="sub">${s.families.length} families, ${s.kids.length} kids</div><h1>Our carpool</h1></div>
    </header>
    <div class="field"><label for="me">I am</label>
      <select id="me" class="input">${s.families.map((f) => `<option value="${f.id}" ${f.id === s.me ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
    </div>
    <section class="section" aria-label="Families">
      <h2>Families</h2>
      ${s.families.map((f) => `
        <article class="card trip">
          ${avatar(f)}
          <div class="what"><b>${esc(f.name)}${f.id === s.me ? ' (you)' : ''}</b>
            <span class="small muted">Kids: ${esc(s.kids.filter((k) => k.familyId === f.id).map((k) => k.name).join(', ') || 'none')}</span>
            <span class="tiny muted">${esc(f.car)} · ${f.seats} seats</span></div>
          ${f.phone ? `<a class="btn round ghost" href="tel:${esc(f.phone)}" aria-label="Call ${esc(f.name)}">${icon('phone')}</a>` : ''}
          <button class="btn round ghost" data-fam="${f.id}" aria-label="Edit ${esc(f.name)}">${icon('fwd')}</button>
        </article>`).join('')}
    </section>
    <section class="section" aria-label="Kids">
      <div class="row-between"><h2>Kid cards</h2><button class="btn" data-kid="new">Add kid</button></div>
      <div class="list">${s.kids.map((k) => `<button class="li" data-kid="${k.id}"><span><b>${esc(k.name)}</b> <span class="small muted">${esc(S.family(k.familyId)?.name ?? '')}</span></span><span class="small muted">${[k.booster ? 'booster' : '', k.allergies ? k.allergies + ' allergy' : ''].filter(Boolean).join(' · ') || ''}</span></button>`).join('')}</div>
    </section>
    <section class="section" aria-label="Places">
      <h2>Places</h2>
      <div class="list">${s.places.map((p) => `<div class="li"><span>${esc(p.name)}</span><span class="small muted">${esc(p.note)}</span></div>`).join('')}</div>
    </section>
    ${shareSectionHTML()}
    ${S.groupInfo() ? '' : '<button class="btn block" data-reset>Reset to demo data</button>'}`;

  el.onchange = (e) => { if (e.target.id === 'me') { S.update((st) => { st.me = e.target.value; }); P.scheduleTurnReminders(); } };
  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.fam) familySheet(b.dataset.fam);
    if (b.dataset.kid) kidSheet(b.dataset.kid);
    if (b.hasAttribute('data-create')) createGroup(b);
    if (b.hasAttribute('data-join')) joinGroup();
    if (b.hasAttribute('data-invite')) shareInvite();
    if (b.hasAttribute('data-leave')) leaveGroup();
    if (b.hasAttribute('data-reset') && confirm('Reset everything to the demo data? Your changes on this device will be lost.')) { S.resetDemo(); toast('Demo data restored.'); }
  };
}

// ---------- sharing between phones ----------
function shareSectionHTML() {
  const g = S.groupInfo();
  if (!S.sharingAvailable) {
    return `<section class="card section" aria-label="Sharing"><h2>Share with the other families</h2>
      <p class="small muted" style="margin:0">This build keeps everything on this phone. Sharing needs the Supabase settings described in the README.</p></section>`;
  }
  if (!g) {
    return `<section class="card section" aria-label="Sharing"><h2>Share with the other families</h2>
      <p class="small muted" style="margin:0">Right now this schedule is only on this phone. Make it a shared group so every family sees the same schedule, live location and alerts.</p>
      <div class="btns"><button class="btn dark" data-create>Create shared group</button><button class="btn" data-join>Join with a code</button></div>
      <p class="tiny muted" style="margin:0">One parent creates the group from their schedule; the others join with its code.</p></section>`;
  }
  const label = { live: 'Synced', connecting: 'Connecting…', offline: 'Offline: changes will sync when you’re back online', off: '' }[S.syncStatus];
  return `<section class="card section" aria-label="Sharing"><div class="row-between"><h2>Shared group</h2><span class="tiny muted">${esc(g.pending && S.syncStatus === 'live' ? 'Saving…' : label)}</span></div>
    <p style="margin:0">Invite code <b class="invite-code">${esc(g.code)}</b></p>
    <p class="small muted" style="margin:0">Other parents install Kidpool, tap Group › Join with a code, and choose who they are.</p>
    <div class="btns"><button class="btn dark" data-invite>Send invite</button><button class="btn" data-leave>Leave group</button></div></section>`;
}

async function createGroup(btn) {
  if (!confirm('Share this schedule (families, kids, places and trips) with the other families? You’ll get an invite code to send them.')) return;
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    await S.createSharedGroup();
    toast('Shared group created. Send the invite to the other families.');
    route();
    shareInvite();
  } catch (e) {
    toast(`Couldn’t create the group: ${e.message}`);
    route();
  }
}

async function joinGroup() {
  const code = prompt('Type the invite code another parent sent you');
  if (!code || !code.trim()) return;
  if (!confirm('Joining replaces the schedule on this phone with the group’s schedule. Continue?')) return;
  toast('Joining…');
  try {
    await S.joinSharedGroup(code);
    P.scheduleTurnReminders();
    whoAmISheet();
  } catch (e) {
    toast(e.message.includes('No group') ? 'No group has that code. Check it and try again.' : `Couldn’t join: ${e.message}`);
  }
}

function whoAmISheet() {
  const s = S.get();
  formSheet('You joined the group. Who are you?', `
    <div class="field"><label for="wa-me">I am</label><select id="wa-me" name="me" class="input">${s.families.map((f) => `<option value="${f.id}" ${f.id === s.me ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
    <p class="small muted" style="margin:0">Your family isn’t listed? Pick any name, then edit it under Families.</p>`,
  (fd) => { S.update((st) => { st.me = fd.get('me'); }); P.scheduleTurnReminders(); });
}

async function shareInvite() {
  const g = S.groupInfo();
  if (!g) return;
  const web = 'https://techtool4u.github.io/carpool2/';
  const text = `Join our carpool on Kidpool. Install the app (or open ${web}), go to Group › Join with a code, and type ${g.code}.`;
  try {
    if (navigator.share) { await navigator.share({ title: 'Join our Kidpool carpool', text }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast('Invite copied. Paste it into your group chat.'); } catch (e) { prompt('Copy this invite and send it to the other families', text); }
}

async function leaveGroup() {
  if (!confirm('Stop sharing with this group? This phone keeps its copy of the schedule but won’t get changes anymore.')) return;
  await S.leaveSharedGroup();
  toast('You left the group.');
  route();
}

function formSheet(title, fieldsHTML, onSave) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<form method="dialog" class="section" style="gap:12px"><h2>${esc(title)}</h2>${fieldsHTML}
    <div class="btns"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn dark" value="save">Save</button></div></form>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'save') onSave(new FormData(dlg.querySelector('form')));
    dlg.remove();
    route();
  });
}

function familySheet(id) {
  const f = S.family(id);
  formSheet(`Edit ${f.name}`, `
    <div class="field"><label for="fs-name">Name</label><input id="fs-name" name="name" class="input" value="${esc(f.name)}" required></div>
    <div class="field"><label for="fs-phone">Phone</label><input id="fs-phone" name="phone" type="tel" class="input" value="${esc(f.phone)}"></div>
    <div class="two"><div class="field"><label for="fs-car">Car</label><input id="fs-car" name="car" class="input" value="${esc(f.car)}"></div>
    <div class="field"><label for="fs-seats">Seats</label><input id="fs-seats" name="seats" type="number" min="2" max="9" class="input" value="${f.seats}"></div></div>`,
  (fd) => S.update((st) => { const x = st.families.find((y) => y.id === id); x.name = fd.get('name').trim() || x.name; x.phone = fd.get('phone').trim(); x.car = fd.get('car').trim(); x.seats = Number(fd.get('seats')) || x.seats; }));
}

function kidSheet(id) {
  const s = S.get();
  const k = id === 'new' ? { id: S.uid(), name: '', familyId: s.me, booster: false, allergies: '', notes: '' } : S.kid(id);
  formSheet(id === 'new' ? 'Add a kid' : `Edit ${k.name}`, `
    <div class="field"><label for="ks-name">Name</label><input id="ks-name" name="name" class="input" value="${esc(k.name)}" required></div>
    <div class="field"><label for="ks-fam">Family</label><select id="ks-fam" name="familyId" class="input">${s.families.map((f) => `<option value="${f.id}" ${f.id === k.familyId ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
    <label class="li" style="min-height:44px"><span>Needs a booster seat</span><input type="checkbox" name="booster" ${k.booster ? 'checked' : ''} style="width:22px;height:22px"></label>
    <div class="field"><label for="ks-all">Allergies</label><input id="ks-all" name="allergies" class="input" value="${esc(k.allergies)}"></div>
    <div class="field"><label for="ks-notes">Notes for drivers</label><textarea id="ks-notes" name="notes" class="input" rows="2">${esc(k.notes)}</textarea></div>`,
  (fd) => S.update((st) => {
    const name = fd.get('name').trim();
    if (!name) return;
    const data = { id: k.id, name, familyId: fd.get('familyId'), booster: fd.get('booster') === 'on', allergies: fd.get('allergies').trim(), notes: fd.get('notes').trim() };
    const i = st.kids.findIndex((x) => x.id === k.id);
    if (i >= 0) st.kids[i] = data; else st.kids.push(data);
  }));
}

// ---------- boot ----------
// Alerts sent by other phones in the group.
S.onGroupEvent((e) => P.notifyNow(e.title, e.body));
// Another phone changed the shared data, or the connection status changed.
// (The screen itself redraws through S.subscribe above.)
S.onRemoteChange((info) => {
  if (info.data) P.scheduleTurnReminders();
  if (info.status && currentRoute === 'group' && !document.querySelector('dialog[open]')) route();
});
route();
P.scheduleTurnReminders();
