# ORISCAN — AI Vision HUD Camera

A mobile-first, futuristic AI HUD camera web app. Real-time face mesh, hand
skeleton, gesture recognition, head pose and eye-tracking telemetry, rendered
over a live camera feed with a neon glass HUD. Runs entirely client-side
(HTML/CSS/vanilla JS, Three.js, MediaPipe Tasks Vision) with Supabase for
auth, storage and an admin console. No build step — open `index.html`.

Original design. Not affiliated with or derived from Marvel, Iron Man, Tony
Stark or J.A.R.V.I.S.

## Files

| File | Purpose |
|---|---|
| `index.html` | Landing page + camera/HUD app |
| `style.css` | Full design system (landing, HUD, admin) |
| `script.js` | Camera, MediaPipe tracking, gestures, capture, upload |
| `admin.html` | Admin login + dashboard shell |
| `admin.js` | Admin auth + CRUD dashboard logic |
| `supabase.js` | Supabase client + all data access functions |

## 1. Create a Supabase project

Create a project at supabase.com, then copy your **Project URL** and
**anon public key** into `supabase.js`:

```js
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';
```

Never put the `service_role` key in any client file.

## 2. Enable Anonymous sign-in

Dashboard → Authentication → Providers → enable **Anonymous Sign-Ins**.
Regular visitors get an anonymous session automatically so their captures
are private to them, with no signup flow required.

## 3. Create an admin user

Dashboard → Authentication → Users → Add User (email + password). Copy the
generated user's UUID for the SQL step below.

## 4. Database schema, storage bucket & RLS policies

Run this in the Supabase SQL editor:

```sql
-- uploads table
create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  file_type text not null check (file_type in ('image','video')),
  file_size bigint not null default 0,
  created_at timestamptz not null default now()
);

alter table public.uploads enable row level security;

-- admins table (whitelist of admin user ids)
create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;

-- insert your admin's UUID here
insert into public.admins (user_id) values ('PASTE-ADMIN-USER-UUID-HERE');

-- helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean language sql stable security definer as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

-- uploads policies
create policy "users insert own uploads"
  on public.uploads for insert
  with check (auth.uid() = user_id);

create policy "users select own uploads"
  on public.uploads for select
  using (auth.uid() = user_id or public.is_admin());

create policy "users delete own uploads"
  on public.uploads for delete
  using (auth.uid() = user_id or public.is_admin());

-- admins table policies (read-only, no client writes)
create policy "admins can read admins table"
  on public.admins for select
  using (public.is_admin());

-- storage bucket
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

-- storage policies: users manage files in their own uid-named folder
create policy "users upload to own folder"
  on storage.objects for insert
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "users read own files or admin"
  on storage.objects for select
  using (bucket_id = 'media' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

create policy "users delete own files or admin"
  on storage.objects for delete
  using (bucket_id = 'media' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
```

## 5. Run

Open `index.html` directly in a browser (or serve the folder with any static
file server). Open `admin.html` to sign in as an admin and manage uploads.

## Notes

- All AI tracking (face mesh, hand skeleton, gestures) runs locally in the
  browser via MediaPipe Tasks Vision (WASM/GPU delegate). No video frames are
  sent anywhere unless the user taps **Save to Cloud**.
- Captured photos/videos are composited (camera + HUD overlay) client-side,
  then optionally uploaded to the private `media` storage bucket under the
  user's own folder.
- Admin status is determined by membership in the `admins` table, checked via
  RLS-protected `is_admin()` — never trust a client-side flag alone.
