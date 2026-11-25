-- Kidpool: database setup for Supabase.
-- Run this once in your Supabase project: Dashboard › SQL Editor › New query › paste › Run.
-- Also turn on: Authentication › Sign In / Providers › "Allow anonymous sign-ins".
--
-- Model: one row per carpool group holds the shared data (families, kids, places, trips,
-- swaps, the running trip) as JSON with a version number. Each phone signs in anonymously
-- and becomes a member by typing the group's invite code. The driver's live position goes
-- to a separate small table so GPS updates don't rewrite the whole group.

create extension if not exists pgcrypto;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  data jsonb not null,
  version integer not null default 1,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.live_positions (
  group_id uuid primary key references public.groups (id) on delete cascade,
  trip_key text not null,
  lat double precision not null,
  lng double precision not null,
  acc real,
  at timestamptz not null default now(),
  path jsonb not null default '[]'::jsonb,
  updated_by uuid not null default auth.uid()
);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.live_positions enable row level security;

-- Is the signed-in user a member of this group?
create or replace function public.is_member(g uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.group_members m where m.group_id = g and m.user_id = auth.uid());
$$;

-- Members can read their groups. Writes go through the functions below.
drop policy if exists "members read groups" on public.groups;
create policy "members read groups" on public.groups
  for select to authenticated using (public.is_member(id));

drop policy if exists "read own memberships" on public.group_members;
create policy "read own memberships" on public.group_members
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "leave a group" on public.group_members;
create policy "leave a group" on public.group_members
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "members read positions" on public.live_positions;
create policy "members read positions" on public.live_positions
  for select to authenticated using (public.is_member(group_id));

drop policy if exists "members add positions" on public.live_positions;
create policy "members add positions" on public.live_positions
  for insert to authenticated with check (public.is_member(group_id));

drop policy if exists "members update positions" on public.live_positions;
create policy "members update positions" on public.live_positions
  for update to authenticated using (public.is_member(group_id)) with check (public.is_member(group_id));

drop policy if exists "members clear positions" on public.live_positions;
create policy "members clear positions" on public.live_positions
  for delete to authenticated using (public.is_member(group_id));

-- Create a group from this phone's data. Returns its id, invite code and version.
create or replace function public.create_group(p_data jsonb)
returns table (id uuid, code text, version integer)
language plpgsql security definer set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O or 1/I
  new_code text;
  new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  loop
    new_code := '';
    for i in 1..6 loop
      new_code := new_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.groups g where g.code = new_code);
  end loop;
  insert into public.groups (code, data) values (new_code, p_data) returning groups.id into new_id;
  insert into public.group_members (group_id) values (new_id);
  return query select new_id, new_code, 1;
end;
$$;

-- Join a group with its invite code. Returns the group's id, code, data and version.
create or replace function public.join_group(p_code text)
returns table (id uuid, code text, data jsonb, version integer)
language plpgsql security definer set search_path = ''
as $$
declare
  g public.groups;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into g from public.groups where groups.code = upper(trim(p_code));
  if not found then raise exception 'No group with that code'; end if;
  insert into public.group_members (group_id) values (g.id) on conflict do nothing;
  return query select g.id, g.code, g.data, g.version;
end;
$$;

-- Save the group's data if nobody else saved since p_base.
-- Returns the new version, or -1 when someone else saved first (the app then reloads and retries).
create or replace function public.save_group(p_id uuid, p_base integer, p_data jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  new_version integer;
begin
  if not public.is_member(p_id) then raise exception 'Not a member of this group'; end if;
  update public.groups
     set data = p_data, version = groups.version + 1, updated_at = now()
   where groups.id = p_id and groups.version = p_base
  returning groups.version into new_version;
  return coalesce(new_version, -1);
end;
$$;

revoke all on function public.is_member(uuid) from public, anon;
revoke all on function public.create_group(jsonb) from public, anon;
revoke all on function public.join_group(text) from public, anon;
revoke all on function public.save_group(uuid, integer, jsonb) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.create_group(jsonb) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.save_group(uuid, integer, jsonb) to authenticated;

-- Send row changes to the phones in real time.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'groups') then
    alter publication supabase_realtime add table public.groups;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'live_positions') then
    alter publication supabase_realtime add table public.live_positions;
  end if;
end $$;
