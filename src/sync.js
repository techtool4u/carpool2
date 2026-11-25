// Talks to Supabase. Only store.js uses this module.
// The project URL and public (anon / publishable) key come from the build:
// VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Without them the app runs on this device only.

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY_ = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(URL_ && KEY_);

let clientPromise = null;

// Loads supabase-js only when sharing is configured, and signs in anonymously.
export function client() {
  if (!configured) return Promise.reject(new Error('Sharing is not set up in this build.'));
  if (!clientPromise) {
    clientPromise = (async () => {
      const { createClient } = await import('@supabase/supabase-js');
      const c = createClient(URL_, KEY_, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'kidpool:auth' } });
      const { data } = await c.auth.getSession();
      if (!data.session) {
        const { error } = await c.auth.signInAnonymously();
        if (error) throw new Error(error.message.includes('Anonymous') ? 'Anonymous sign-ins are off in the Supabase project.' : error.message);
      }
      return c;
    })().catch((e) => { clientPromise = null; throw e; });
  }
  return clientPromise;
}

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export async function createGroup(shared) {
  const c = await client();
  const rows = check(await c.rpc('create_group', { p_data: shared }));
  return rows[0];
}

export async function joinGroup(code) {
  const c = await client();
  const rows = check(await c.rpc('join_group', { p_code: code }));
  return rows[0];
}

export async function fetchGroup(id) {
  const c = await client();
  return check(await c.from('groups').select('id, code, data, version').eq('id', id).single());
}

// Returns the new version, or -1 if someone else saved first.
export async function saveGroup(id, baseVersion, shared) {
  const c = await client();
  return check(await c.rpc('save_group', { p_id: id, p_base: baseVersion, p_data: shared }));
}

export async function leaveGroup(id) {
  const c = await client();
  const { data } = await c.auth.getUser();
  if (data.user) await c.from('group_members').delete().eq('group_id', id).eq('user_id', data.user.id);
}

export async function fetchPosition(id) {
  const c = await client();
  return check(await c.from('live_positions').select('*').eq('group_id', id).maybeSingle());
}

export async function putPosition(id, row) {
  const c = await client();
  check(await c.from('live_positions').upsert({ group_id: id, ...row }));
}

export async function clearPosition(id) {
  const c = await client();
  check(await c.from('live_positions').delete().eq('group_id', id));
}

// Calls onGroup(row) when the group's data changes and onPosition(row | null) when the driver moves.
// Returns a function that stops listening.
export async function listen(id, { onGroup, onPosition, onStatus }) {
  const c = await client();
  const ch = c.channel(`group:${id}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'groups', filter: `id=eq.${id}` }, (p) => onGroup(p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'live_positions', filter: `group_id=eq.${id}` }, (p) => onPosition(p.eventType === 'DELETE' ? null : p.new))
    .subscribe((status) => onStatus?.(status));
  return () => c.removeChannel(ch);
}
