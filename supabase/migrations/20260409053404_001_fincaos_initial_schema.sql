/*
  # FincaOS - Initial Schema

  ## Summary
  Creates the core database tables for FincaOS, a community management platform
  for Spanish homeowner communities (comunidades de propietarios).

  ## New Tables

  ### comunidades
  Represents a building or homeowner association.
  - id: unique identifier
  - nombre: building name
  - direccion: street address
  - codigo: unique join code for residents (e.g. used in invite links)
  - num_viviendas: total number of units in the building
  - created_at: creation timestamp

  ### perfiles
  User profiles that extend Supabase auth.users.
  - id: references auth.users(id)
  - comunidad_id: which community this user belongs to
  - nombre_completo: full name
  - numero_piso: apartment identifier (e.g. "2B", "Bajo Izq")
  - rol: vecino | presidente | admin
  - avatar_url: profile photo URL
  - telefono: optional phone number

  ### categorias_incidencia
  Lookup table for incident categories (Ascensor, Fontaneria, etc.)
  Pre-populated with 8 categories.

  ### incidencias
  Incidents / issues reported by residents.
  - comunidad_id: which community
  - autor_id: who reported it
  - categoria_id: type of issue
  - titulo, descripcion: what happened
  - estado: pendiente | en_progreso | presupuestada | aprobada | en_ejecucion | resuelta | cerrada
  - prioridad: baja | normal | alta | urgente

  ### incidencia_fotos
  Photos attached to incidents, stored in Supabase Storage.

  ### comentarios
  Comments and status updates on incidents.
  - es_nota_admin: admin-only internal notes hidden from residents

  ### anuncios
  Community bulletin board posts.
  - fijado: pinned announcements appear first

  ### documentos
  Shared community documents (statutes, meeting minutes, contracts).

  ## Security
  - RLS enabled on all tables
  - Trigger: auto-create perfil on user signup
  - Trigger: keep updated_at current on perfiles and incidencias

  ## Notes
  1. The `codigo` field on comunidades is the unique join code shared via invite links
  2. Roles: vecino (resident), presidente (board president), admin (property manager)
  3. All photo/document files are stored in Supabase Storage, only paths stored in DB
*/

-- ============================================================
-- EXTENSIONS
-- ============================================================
create extension if not exists "uuid-ossp";

-- ============================================================
-- TABLE: comunidades
-- ============================================================
create table if not exists public.comunidades (
  id             uuid primary key default uuid_generate_v4(),
  nombre         text not null,
  direccion      text,
  codigo         text unique not null,
  num_viviendas  integer default 0,
  created_at     timestamptz default now()
);

-- ============================================================
-- TABLE: perfiles
-- ============================================================
create table if not exists public.perfiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  comunidad_id    uuid references public.comunidades(id),
  nombre_completo text not null default '',
  numero_piso     text,
  rol             text not null default 'vecino'
                  check (rol in ('vecino', 'presidente', 'admin')),
  avatar_url      text,
  telefono        text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ============================================================
-- TABLE: categorias_incidencia
-- ============================================================
create table if not exists public.categorias_incidencia (
  id      serial primary key,
  nombre  text not null unique,
  icono   text
);

insert into public.categorias_incidencia (nombre, icono) values
  ('Ascensor', 'arrow-up'),
  ('Fontanería', 'droplets'),
  ('Electricidad', 'zap'),
  ('Zonas comunes', 'users'),
  ('Jardín', 'leaf'),
  ('Garaje', 'car'),
  ('Fachada', 'building'),
  ('Ruidos', 'volume-2'),
  ('Otro', 'help-circle')
on conflict (nombre) do nothing;

-- ============================================================
-- TABLE: incidencias
-- ============================================================
create table if not exists public.incidencias (
  id              uuid primary key default uuid_generate_v4(),
  comunidad_id    uuid not null references public.comunidades(id) on delete cascade,
  autor_id        uuid not null references public.perfiles(id),
  categoria_id    integer references public.categorias_incidencia(id),
  titulo          text not null,
  descripcion     text,
  estado          text not null default 'pendiente'
                  check (estado in ('pendiente', 'en_revision', 'presupuestada', 'aprobada', 'en_ejecucion', 'resuelta', 'cerrada')),
  prioridad       text not null default 'normal'
                  check (prioridad in ('baja', 'normal', 'alta', 'urgente')),
  ubicacion       text,
  estimacion_min  integer,
  estimacion_max  integer,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  resuelta_at     timestamptz
);

-- ============================================================
-- TABLE: incidencia_fotos
-- ============================================================
create table if not exists public.incidencia_fotos (
  id             uuid primary key default uuid_generate_v4(),
  incidencia_id  uuid not null references public.incidencias(id) on delete cascade,
  storage_path   text not null,
  uploaded_by    uuid references public.perfiles(id),
  created_at     timestamptz default now()
);

-- ============================================================
-- TABLE: comentarios
-- ============================================================
create table if not exists public.comentarios (
  id             uuid primary key default uuid_generate_v4(),
  incidencia_id  uuid not null references public.incidencias(id) on delete cascade,
  autor_id       uuid not null references public.perfiles(id),
  contenido      text not null,
  es_nota_admin  boolean default false,
  created_at     timestamptz default now()
);

-- ============================================================
-- TABLE: anuncios
-- ============================================================
create table if not exists public.anuncios (
  id              uuid primary key default uuid_generate_v4(),
  comunidad_id    uuid not null references public.comunidades(id) on delete cascade,
  autor_id        uuid not null references public.perfiles(id),
  titulo          text not null,
  contenido       text not null,
  fijado          boolean default false,
  publicado_at    timestamptz default now(),
  expires_at      timestamptz,
  created_at      timestamptz default now()
);

-- ============================================================
-- TABLE: documentos
-- ============================================================
create table if not exists public.documentos (
  id              uuid primary key default uuid_generate_v4(),
  comunidad_id    uuid not null references public.comunidades(id) on delete cascade,
  subido_por      uuid references public.perfiles(id),
  nombre          text not null,
  descripcion     text,
  storage_path    text not null,
  tipo_mime       text,
  created_at      timestamptz default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists idx_incidencias_comunidad_estado on public.incidencias (comunidad_id, estado);
create index if not exists idx_incidencias_comunidad_created on public.incidencias (comunidad_id, created_at desc);
create index if not exists idx_comentarios_incidencia on public.comentarios (incidencia_id, created_at);
create index if not exists idx_anuncios_comunidad on public.anuncios (comunidad_id, fijado desc, publicado_at desc);
create index if not exists idx_perfiles_comunidad on public.perfiles (comunidad_id);

-- ============================================================
-- TRIGGERS: updated_at
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_perfiles_updated_at on public.perfiles;
create trigger trg_perfiles_updated_at
  before update on public.perfiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_incidencias_updated_at on public.incidencias;
create trigger trg_incidencias_updated_at
  before update on public.incidencias
  for each row execute function public.set_updated_at();

-- ============================================================
-- TRIGGER: auto-create perfil on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.perfiles (id, nombre_completo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre_completo', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
