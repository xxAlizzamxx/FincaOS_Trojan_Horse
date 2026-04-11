/*
  # FincaOS - Row Level Security Policies

  ## Summary
  Enables RLS on all FincaOS tables and creates security policies.
  Users can only access data from their own community.
  Admins and presidents have elevated permissions.

  ## Security Design
  - All access requires authentication (auth.uid() is not null)
  - Community isolation: users only see data from their own community
  - Role-based elevation: admin/presidente can perform management actions
  - Helper functions minimize repetition and ensure consistency

  ## Helper Functions
  1. get_my_comunidad_id() - returns current user's community ID
  2. is_admin_or_presidente() - returns true if user has elevated role

  ## Policies Created
  - perfiles: select (own community), update (own record only)
  - incidencias: select/insert/update within community, with role checks
  - incidencia_fotos: select/insert within community
  - comentarios: select (respecting admin-only notes), insert within community
  - anuncios: select (own community), insert/update (admin/presidente only)
  - documentos: select (own community), insert (admin/presidente only)
  - comunidades: select (own community only)
*/

-- ============================================================
-- ENABLE RLS
-- ============================================================
alter table public.comunidades       enable row level security;
alter table public.perfiles          enable row level security;
alter table public.incidencias       enable row level security;
alter table public.incidencia_fotos  enable row level security;
alter table public.comentarios       enable row level security;
alter table public.anuncios          enable row level security;
alter table public.documentos        enable row level security;

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================
create or replace function public.get_my_comunidad_id()
returns uuid language sql security definer stable as $$
  select comunidad_id from public.perfiles where id = auth.uid() limit 1;
$$;

create or replace function public.is_admin_or_presidente()
returns boolean language sql security definer stable as $$
  select rol in ('admin', 'presidente')
  from public.perfiles where id = auth.uid() limit 1;
$$;

-- ============================================================
-- POLICIES: comunidades
-- ============================================================
drop policy if exists "comunidades_select_own" on public.comunidades;
create policy "comunidades_select_own"
  on public.comunidades for select
  to authenticated
  using (id = public.get_my_comunidad_id());

drop policy if exists "comunidades_insert_authenticated" on public.comunidades;
create policy "comunidades_insert_authenticated"
  on public.comunidades for insert
  to authenticated
  with check (true);

-- ============================================================
-- POLICIES: perfiles
-- ============================================================
drop policy if exists "perfiles_select_same_community" on public.perfiles;
create policy "perfiles_select_same_community"
  on public.perfiles for select
  to authenticated
  using (
    id = auth.uid()
    or comunidad_id = public.get_my_comunidad_id()
  );

drop policy if exists "perfiles_insert_own" on public.perfiles;
create policy "perfiles_insert_own"
  on public.perfiles for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists "perfiles_update_own" on public.perfiles;
create policy "perfiles_update_own"
  on public.perfiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ============================================================
-- POLICIES: incidencias
-- ============================================================
drop policy if exists "incidencias_select_community" on public.incidencias;
create policy "incidencias_select_community"
  on public.incidencias for select
  to authenticated
  using (comunidad_id = public.get_my_comunidad_id());

drop policy if exists "incidencias_insert_community" on public.incidencias;
create policy "incidencias_insert_community"
  on public.incidencias for insert
  to authenticated
  with check (
    comunidad_id = public.get_my_comunidad_id()
    and autor_id = auth.uid()
  );

drop policy if exists "incidencias_update_admin_or_author" on public.incidencias;
create policy "incidencias_update_admin_or_author"
  on public.incidencias for update
  to authenticated
  using (
    autor_id = auth.uid()
    or public.is_admin_or_presidente()
  )
  with check (
    autor_id = auth.uid()
    or public.is_admin_or_presidente()
  );

-- ============================================================
-- POLICIES: incidencia_fotos
-- ============================================================
drop policy if exists "fotos_select_community" on public.incidencia_fotos;
create policy "fotos_select_community"
  on public.incidencia_fotos for select
  to authenticated
  using (
    exists (
      select 1 from public.incidencias i
      where i.id = incidencia_id
        and i.comunidad_id = public.get_my_comunidad_id()
    )
  );

drop policy if exists "fotos_insert_community" on public.incidencia_fotos;
create policy "fotos_insert_community"
  on public.incidencia_fotos for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from public.incidencias i
      where i.id = incidencia_id
        and i.comunidad_id = public.get_my_comunidad_id()
    )
  );

-- ============================================================
-- POLICIES: comentarios
-- ============================================================
drop policy if exists "comentarios_select_community" on public.comentarios;
create policy "comentarios_select_community"
  on public.comentarios for select
  to authenticated
  using (
    (es_nota_admin = false or public.is_admin_or_presidente())
    and exists (
      select 1 from public.incidencias i
      where i.id = incidencia_id
        and i.comunidad_id = public.get_my_comunidad_id()
    )
  );

drop policy if exists "comentarios_insert_community" on public.comentarios;
create policy "comentarios_insert_community"
  on public.comentarios for insert
  to authenticated
  with check (
    autor_id = auth.uid()
    and exists (
      select 1 from public.incidencias i
      where i.id = incidencia_id
        and i.comunidad_id = public.get_my_comunidad_id()
    )
  );

-- ============================================================
-- POLICIES: anuncios
-- ============================================================
drop policy if exists "anuncios_select_community" on public.anuncios;
create policy "anuncios_select_community"
  on public.anuncios for select
  to authenticated
  using (comunidad_id = public.get_my_comunidad_id());

drop policy if exists "anuncios_insert_admin" on public.anuncios;
create policy "anuncios_insert_admin"
  on public.anuncios for insert
  to authenticated
  with check (
    comunidad_id = public.get_my_comunidad_id()
    and autor_id = auth.uid()
    and public.is_admin_or_presidente()
  );

drop policy if exists "anuncios_update_admin" on public.anuncios;
create policy "anuncios_update_admin"
  on public.anuncios for update
  to authenticated
  using (public.is_admin_or_presidente())
  with check (public.is_admin_or_presidente());

-- ============================================================
-- POLICIES: documentos
-- ============================================================
drop policy if exists "documentos_select_community" on public.documentos;
create policy "documentos_select_community"
  on public.documentos for select
  to authenticated
  using (comunidad_id = public.get_my_comunidad_id());

drop policy if exists "documentos_insert_admin" on public.documentos;
create policy "documentos_insert_admin"
  on public.documentos for insert
  to authenticated
  with check (
    comunidad_id = public.get_my_comunidad_id()
    and public.is_admin_or_presidente()
  );
