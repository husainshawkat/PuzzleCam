-- ════════════════════════════════════════════════════════════
-- Puzzle Cam — Supabase schema
-- Paste and run this entire file in:
-- Supabase Dashboard → SQL Editor → New query → Run
-- ════════════════════════════════════════════════════════════

-- 1) Table that records each capture ---------------------------
create table if not exists public.captures (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  image_url text not null,
  created_at timestamptz not null default now()
);

alter table public.captures enable row level security;

-- Anyone (even without a session) can register a new capture
-- from the camera app.
drop policy if exists "anon can insert captures" on public.captures;
create policy "anon can insert captures"
on public.captures for insert
to anon
with check (true);

-- Only authenticated accounts (the admin panel) can read.
drop policy if exists "authenticated can read captures" on public.captures;
create policy "authenticated can read captures"
on public.captures for select
to authenticated
using (true);

-- Only authenticated accounts can delete.
drop policy if exists "authenticated can delete captures" on public.captures;
create policy "authenticated can delete captures"
on public.captures for delete
to authenticated
using (true);


-- 2) Storage bucket for the images ------------------------
insert into storage.buckets (id, name, public)
values ('puzzle-photos', 'puzzle-photos', true)
on conflict (id) do nothing;

-- Public read access to the images (needed to display them
-- both in the local strip and in the admin panel via public URL).
drop policy if exists "public read puzzle-photos" on storage.objects;
create policy "public read puzzle-photos"
on storage.objects for select
to public
using (bucket_id = 'puzzle-photos');

-- The camera app (without a session) can upload files.
drop policy if exists "anon can upload puzzle-photos" on storage.objects;
create policy "anon can upload puzzle-photos"
on storage.objects for insert
to anon
with check (bucket_id = 'puzzle-photos');

-- Only the authenticated admin can delete files from the bucket.
drop policy if exists "authenticated can delete puzzle-photos" on storage.objects;
create policy "authenticated can delete puzzle-photos"
on storage.objects for delete
to authenticated
using (bucket_id = 'puzzle-photos');


-- 3) (Optional) enable Realtime on the table -------------------
-- This lets the admin panel receive new photos instantly
-- without refreshing. If your project already has the
-- `supabase_realtime` publication, this updates it; if the
-- command fails because it's already included, you can ignore it.
alter publication supabase_realtime add table public.captures;
