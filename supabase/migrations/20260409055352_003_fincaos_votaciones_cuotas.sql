/*
  # FincaOS - Votaciones, Cuotas y Mediación

  ## Summary
  Adds the voting system, community fees tracking, incident "join" feature,
  and mediation/normative consultation tables.

  ## New Tables

  ### votaciones
  Community voting sessions (polls/resolutions).
  - titulo, descripcion: what's being voted on
  - estado: abierta | cerrada
  - fecha_cierre: when voting ends
  - coeficiente_requerido: minimum coefficient needed to pass (per LPH)

  ### opciones_votacion
  Available vote options for each voting session (e.g. "A favor", "En contra", "Abstención").

  ### respuestas_votacion
  Individual votes cast by residents.
  - One per resident per voting session (unique constraint).
  - coeficiente: resident's ownership coefficient (weight of their vote).

  ### cuotas_vecinos
  Monthly fee tracking per resident.
  - mes_año: period (e.g. "2026-04")
  - importe: amount due
  - estado: al_dia | pendiente | moroso

  ### incidencia_afectados
  Tracks which residents "joined" (sumarme) an incident.
  - One row per resident per incident.

  ### mediaciones
  Conflict mediation cases.
  - tipo: ruido | parking | mascotas | obras | filtraciones | otro
  - estado: ia_propuesta | mediador_requerido | resuelto | judicial
  - es_anonimo: whether complainant is anonymous

  ### consultas_normativas
  Q&A with the normative assistant.
  - pregunta: user's question
  - respuesta: AI-generated answer
  - util: thumbs up/down feedback

  ## Security
  - RLS enabled on all new tables
  - Voters can only vote once per votacion (unique constraint)
  - Mediation complainant identity protected by is_anonimo flag

  ## Notes
  1. Voting uses coeficientes (ownership percentage) per LPH requirements
  2. Cuotas are managed by admin/presidente only
  3. Mediación phases: IA → human mediator (49-79€) → legal report
*/

-- ============================================================
-- TABLE: votaciones
-- ============================================================
create table if not exists public.votaciones (
  id                    uuid primary key default uuid_generate_v4(),
  comunidad_id          uuid not null references public.comunidades(id) on delete cascade,
  autor_id              uuid not null references public.perfiles(id),
  titulo                text not null,
  descripcion           text,
  estado                text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  fecha_cierre          timestamptz,
  coeficiente_requerido numeric(5,2) default 50.00,
  created_at            timestamptz default now()
);

-- ============================================================
-- TABLE: opciones_votacion
-- ============================================================
create table if not exists public.opciones_votacion (
  id            uuid primary key default uuid_generate_v4(),
  votacion_id   uuid not null references public.votaciones(id) on delete cascade,
  texto         text not null,
  orden         integer default 0
);

-- ============================================================
-- TABLE: respuestas_votacion
-- ============================================================
create table if not exists public.respuestas_votacion (
  id           uuid primary key default uuid_generate_v4(),
  votacion_id  uuid not null references public.votaciones(id) on delete cascade,
  opcion_id    uuid not null references public.opciones_votacion(id),
  vecino_id    uuid not null references public.perfiles(id),
  coeficiente  numeric(5,2) default 1.00,
  created_at   timestamptz default now(),
  unique (votacion_id, vecino_id)
);

-- ============================================================
-- TABLE: cuotas_vecinos
-- ============================================================
create table if not exists public.cuotas_vecinos (
  id            uuid primary key default uuid_generate_v4(),
  comunidad_id  uuid not null references public.comunidades(id) on delete cascade,
  vecino_id     uuid not null references public.perfiles(id),
  mes_anio      text not null,
  importe       numeric(10,2) not null default 0,
  estado        text not null default 'pendiente' check (estado in ('al_dia', 'pendiente', 'moroso')),
  pagado_at     timestamptz,
  created_at    timestamptz default now(),
  unique (comunidad_id, vecino_id, mes_anio)
);

-- ============================================================
-- TABLE: incidencia_afectados
-- ============================================================
create table if not exists public.incidencia_afectados (
  id             uuid primary key default uuid_generate_v4(),
  incidencia_id  uuid not null references public.incidencias(id) on delete cascade,
  vecino_id      uuid not null references public.perfiles(id),
  created_at     timestamptz default now(),
  unique (incidencia_id, vecino_id)
);

-- ============================================================
-- TABLE: mediaciones
-- ============================================================
create table if not exists public.mediaciones (
  id              uuid primary key default uuid_generate_v4(),
  comunidad_id    uuid not null references public.comunidades(id) on delete cascade,
  denunciante_id  uuid not null references public.perfiles(id),
  tipo            text not null default 'otro'
                  check (tipo in ('ruido', 'parking', 'mascotas', 'obras', 'filtraciones', 'otro')),
  descripcion     text not null,
  es_recurrente   boolean default false,
  es_anonimo      boolean default true,
  estado          text not null default 'nueva'
                  check (estado in ('nueva', 'ia_procesando', 'ia_propuesta', 'mediador_requerido', 'resuelto', 'judicial')),
  propuesta_ia    text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ============================================================
-- TABLE: consultas_normativas
-- ============================================================
create table if not exists public.consultas_normativas (
  id              uuid primary key default uuid_generate_v4(),
  comunidad_id    uuid not null references public.comunidades(id) on delete cascade,
  vecino_id       uuid not null references public.perfiles(id),
  pregunta        text not null,
  respuesta       text,
  util            boolean,
  created_at      timestamptz default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists idx_votaciones_comunidad on public.votaciones (comunidad_id, estado);
create index if not exists idx_respuestas_votacion on public.respuestas_votacion (votacion_id);
create index if not exists idx_cuotas_comunidad on public.cuotas_vecinos (comunidad_id, mes_anio);
create index if not exists idx_afectados_incidencia on public.incidencia_afectados (incidencia_id);
create index if not exists idx_mediaciones_comunidad on public.mediaciones (comunidad_id);

-- ============================================================
-- TRIGGER: updated_at on mediaciones
-- ============================================================
drop trigger if exists trg_mediaciones_updated_at on public.mediaciones;
create trigger trg_mediaciones_updated_at
  before update on public.mediaciones
  for each row execute function public.set_updated_at();

-- ============================================================
-- ENABLE RLS
-- ============================================================
alter table public.votaciones           enable row level security;
alter table public.opciones_votacion    enable row level security;
alter table public.respuestas_votacion  enable row level security;
alter table public.cuotas_vecinos       enable row level security;
alter table public.incidencia_afectados enable row level security;
alter table public.mediaciones          enable row level security;
alter table public.consultas_normativas enable row level security;

-- ============================================================
-- POLICIES: votaciones
-- ============================================================
drop policy if exists "votaciones_select_community" on public.votaciones;
create policy "votaciones_select_community"
  on public.votaciones for select
  to authenticated
  using (comunidad_id = public.get_my_comunidad_id());

drop policy if exists "votaciones_insert_admin" on public.votaciones;
create policy "votaciones_insert_admin"
  on public.votaciones for insert
  to authenticated
  with check (
    comunidad_id = public.get_my_comunidad_id()
    and autor_id = auth.uid()
    and public.is_admin_or_presidente()
  );

drop policy if exists "votaciones_update_admin" on public.votaciones;
create policy "votaciones_update_admin"
  on public.votaciones for update
  to authenticated
  using (public.is_admin_or_presidente())
  with check (public.is_admin_or_presidente());

-- ============================================================
-- POLICIES: opciones_votacion
-- ============================================================
drop policy if exists "opciones_select_community" on public.opciones_votacion;
create policy "opciones_select_community"
  on public.opciones_votacion for select
  to authenticated
  using (
    exists (
      select 1 from public.votaciones v
      where v.id = votacion_id
        and v.comunidad_id = public.get_my_comunidad_id()
    )
  );

drop policy if exists "opciones_insert_admin" on public.opciones_votacion;
create policy "opciones_insert_admin"
  on public.opciones_votacion for insert
  to authenticated
  with check (
    public.is_admin_or_presidente()
    and exists (
      select 1 from public.votaciones v
      where v.id = votacion_id
        and v.comunidad_id = public.get_my_comunidad_id()
    )
  );

-- ============================================================
-- POLICIES: respuestas_votacion
-- ============================================================
drop policy if exists "respuestas_select_community" on public.respuestas_votacion;
create policy "respuestas_select_community"
  on public.respuestas_votacion for select
  to authenticated
  using (
    exists (
      select 1 from public.votaciones v
      where v.id = votacion_id
        and v.comunidad_id = public.get_my_comunidad_id()
    )
  );

drop policy if exists "respuestas_insert_own" on public.respuestas_votacion;
create policy "respuestas_insert_own"
  on public.respuestas_votacion for insert
  to authenticated
  with check (
    vecino_id = auth.uid()
    and exists (
      select 1 from public.votaciones v
      where v.id = votacion_id
        and v.comunidad_id = public.get_my_comunidad_id()
        and v.estado = 'abierta'
    )
  );

-- ============================================================
-- POLICIES: cuotas_vecinos
-- ============================================================
drop policy if exists "cuotas_select_own" on public.cuotas_vecinos;
create policy "cuotas_select_own"
  on public.cuotas_vecinos for select
  to authenticated
  using (
    vecino_id = auth.uid()
    or public.is_admin_or_presidente()
  );

drop policy if exists "cuotas_insert_admin" on public.cuotas_vecinos;
create policy "cuotas_insert_admin"
  on public.cuotas_vecinos for insert
  to authenticated
  with check (
    comunidad_id = public.get_my_comunidad_id()
    and public.is_admin_or_presidente()
  );

drop policy if exists "cuotas_update_admin" on public.cuotas_vecinos;
create policy "cuotas_update_admin"
  on public.cuotas_vecinos for update
  to authenticated
  using (public.is_admin_or_presidente())
  with check (public.is_admin_or_presidente());

-- ============================================================
-- POLICIES: incidencia_afectados
-- ============================================================
drop policy if exists "afectados_select_community" on public.incidencia_afectados;
create policy "afectados_select_community"
  on public.incidencia_afectados for select
  to authenticated
  using (
    exists (
      select 1 from public.incidencias i
      where i.id = incidencia_id
        and i.comunidad_id = public.get_my_comunidad_id()
    )
  );

drop policy if exists "afectados_insert_own" on public.incidencia_afectados;
create policy "afectados_insert_own"
  on public.incidencia_afectados for insert
  to authenticated
  with check (
    vecino_id = auth.uid()
    and exists (
      select 1 from public.incidencias i
      where i.id = incidencia_id
        and i.comunidad_id = public.get_my_comunidad_id()
    )
  );

drop policy if exists "afectados_delete_own" on public.incidencia_afectados;
create policy "afectados_delete_own"
  on public.incidencia_afectados for delete
  to authenticated
  using (vecino_id = auth.uid());

-- ============================================================
-- POLICIES: mediaciones
-- ============================================================
drop policy if exists "mediaciones_select_own_or_admin" on public.mediaciones;
create policy "mediaciones_select_own_or_admin"
  on public.mediaciones for select
  to authenticated
  using (
    denunciante_id = auth.uid()
    or public.is_admin_or_presidente()
  );

drop policy if exists "mediaciones_insert_community" on public.mediaciones;
create policy "mediaciones_insert_community"
  on public.mediaciones for insert
  to authenticated
  with check (
    comunidad_id = public.get_my_comunidad_id()
    and denunciante_id = auth.uid()
  );

drop policy if exists "mediaciones_update_own_or_admin" on public.mediaciones;
create policy "mediaciones_update_own_or_admin"
  on public.mediaciones for update
  to authenticated
  using (
    denunciante_id = auth.uid()
    or public.is_admin_or_presidente()
  )
  with check (
    denunciante_id = auth.uid()
    or public.is_admin_or_presidente()
  );

-- ============================================================
-- POLICIES: consultas_normativas
-- ============================================================
drop policy if exists "consultas_select_own" on public.consultas_normativas;
create policy "consultas_select_own"
  on public.consultas_normativas for select
  to authenticated
  using (vecino_id = auth.uid());

drop policy if exists "consultas_insert_own" on public.consultas_normativas;
create policy "consultas_insert_own"
  on public.consultas_normativas for insert
  to authenticated
  with check (
    vecino_id = auth.uid()
    and comunidad_id = public.get_my_comunidad_id()
  );

drop policy if exists "consultas_update_own" on public.consultas_normativas;
create policy "consultas_update_own"
  on public.consultas_normativas for update
  to authenticated
  using (vecino_id = auth.uid())
  with check (vecino_id = auth.uid());
