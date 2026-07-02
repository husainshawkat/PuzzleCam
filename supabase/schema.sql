-- ════════════════════════════════════════════════════════════
-- Puzzle Cam — esquema de Supabase
-- Pega y ejecuta todo este archivo en:
-- Supabase Dashboard → SQL Editor → New query → Run
-- ════════════════════════════════════════════════════════════

-- 1) Tabla que registra cada captura ---------------------------
create table if not exists public.captures (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  image_url text not null,
  created_at timestamptz not null default now()
);

alter table public.captures enable row level security;

-- Cualquiera (incluso sin sesión) puede registrar una nueva captura
-- desde la app de la cámara.
drop policy if exists "anon puede insertar capturas" on public.captures;
create policy "anon puede insertar capturas"
on public.captures for insert
to anon
with check (true);

-- Solo cuentas autenticadas (el panel de admin) pueden leer.
drop policy if exists "autenticados pueden leer capturas" on public.captures;
create policy "autenticados pueden leer capturas"
on public.captures for select
to authenticated
using (true);

-- Solo cuentas autenticadas pueden borrar.
drop policy if exists "autenticados pueden borrar capturas" on public.captures;
create policy "autenticados pueden borrar capturas"
on public.captures for delete
to authenticated
using (true);


-- 2) Bucket de Storage para las imágenes ------------------------
insert into storage.buckets (id, name, public)
values ('puzzle-photos', 'puzzle-photos', true)
on conflict (id) do nothing;

-- Lectura pública de las imágenes (necesaria para mostrarlas
-- tanto en la tira local como en el panel de admin vía URL pública).
drop policy if exists "lectura publica puzzle-photos" on storage.objects;
create policy "lectura publica puzzle-photos"
on storage.objects for select
to public
using (bucket_id = 'puzzle-photos');

-- La app de la cámara (sin sesión) puede subir archivos.
drop policy if exists "anon puede subir puzzle-photos" on storage.objects;
create policy "anon puede subir puzzle-photos"
on storage.objects for insert
to anon
with check (bucket_id = 'puzzle-photos');

-- Solo el admin autenticado puede borrar archivos del bucket.
drop policy if exists "autenticados pueden borrar puzzle-photos" on storage.objects;
create policy "autenticados pueden borrar puzzle-photos"
on storage.objects for delete
to authenticated
using (bucket_id = 'puzzle-photos');


-- 3) (Opcional) habilitar Realtime en la tabla -------------------
-- Esto permite que el panel de admin reciba las fotos nuevas al
-- instante sin tener que refrescar. Si tu proyecto ya tiene la
-- publicación `supabase_realtime`, esto la actualiza; si el bucket
-- de comandos falla porque ya está incluida, puedes ignorarlo.
alter publication supabase_realtime add table public.captures;
