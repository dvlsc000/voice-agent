-- Foundation: tenancy, membership, platform staff, audit.
-- Conventions (see docs/database.md):
--   * Every tenant-owned row carries organization_id and is protected by RLS.
--   * Helper functions live in schema `private` (not exposed through the Data API).
--   * Timestamps are timestamptz (UTC); each organization stores its IANA timezone.
--   * anon gets nothing. authenticated gets explicit grants. service_role (server) bypasses RLS.

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------- enums
create type public.org_status as enum ('onboarding', 'trial', 'active', 'suspended', 'closed');
create type public.member_role as enum ('owner', 'manager', 'receptionist', 'analyst');
create type public.platform_role as enum ('platform_admin', 'platform_support');
create type public.country_code as enum ('IE', 'HR');
create type public.language_code as enum ('en', 'hr');

-- ---------------------------------------------------------------- utilities
create or replace function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function private.is_valid_timezone(tz text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = tz);
$$;

-- ---------------------------------------------------------------- platform staff (our company)
create table public.platform_staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.platform_role not null,
  mfa_required boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- organizations (tenants)
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  industry_template_id text not null,
  country public.country_code not null,
  timezone text not null check (private.is_valid_timezone(timezone)),
  primary_language public.language_code not null,
  additional_languages public.language_code[] not null default '{}',
  status public.org_status not null default 'onboarding',
  website_url text,
  contact_email extensions.citext,
  contact_phone_e164 text check (contact_phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  fallback_phone_e164 text check (fallback_phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  -- Salt for hashing booking references; never exposed to clients (see column grants).
  reference_salt text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

-- ---------------------------------------------------------------- authorization helpers
-- SECURITY DEFINER so policies can consult membership without recursive RLS evaluation.
create or replace function private.is_platform_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_staff where user_id = (select auth.uid()));
$$;

create or replace function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_staff where user_id = (select auth.uid()) and role = 'platform_admin');
$$;

create or replace function private.has_org_role(org uuid, roles public.member_role[] default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and (roles is null or m.role = any (roles))
  );
$$;

-- Read access: any member, or our platform staff (support).
create or replace function private.can_read_org(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_org_role(org) or private.is_platform_staff();
$$;

-- Configuration writes: owner/manager only.
create or replace function private.can_configure_org(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_org_role(org, array['owner', 'manager']::public.member_role[]);
$$;

-- Front-desk operations (appointments, enquiries): owner/manager/receptionist.
create or replace function private.can_operate_org(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_org_role(org, array['owner', 'manager', 'receptionist']::public.member_role[]);
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------- audit log
create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id) on delete set null,
  actor_user_id uuid,
  actor_type text not null check (actor_type in ('user', 'service', 'system')),
  action text not null,
  target_table text not null,
  target_id text,
  old_data jsonb,
  new_data jsonb,
  at timestamptz not null default now()
);
create index audit_logs_org_at_idx on public.audit_logs (organization_id, at desc);

create or replace function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_id text;
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  v_org := coalesce((v_new ->> 'organization_id')::uuid, (v_old ->> 'organization_id')::uuid,
                    case when tg_table_name = 'organizations' then coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid) end);
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id');
  -- Never copy secrets into the audit trail.
  v_old := v_old - 'reference_salt' - 'reference_hash';
  v_new := v_new - 'reference_salt' - 'reference_hash';
  insert into public.audit_logs (organization_id, actor_user_id, actor_type, action, target_table, target_id, old_data, new_data)
  values (
    v_org,
    (select auth.uid()),
    case when (select auth.uid()) is null then 'service' else 'user' end,
    lower(tg_op),
    tg_table_name,
    v_id,
    v_old,
    v_new
  );
  return coalesce(new, old);
end $$;

create trigger organizations_audit after insert or update or delete on public.organizations
  for each row execute function private.audit_row();
create trigger organization_members_audit after insert or update or delete on public.organization_members
  for each row execute function private.audit_row();

-- Never leave an organization without an owner.
create or replace function private.protect_last_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (tg_op = 'DELETE' or new.role <> 'owner') and old.role = 'owner' then
    if not exists (
      select 1 from public.organization_members
      where organization_id = old.organization_id and role = 'owner' and user_id <> old.user_id
    ) and exists (select 1 from public.organizations where id = old.organization_id) then
      raise exception 'An organization must keep at least one owner' using errcode = 'check_violation';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger organization_members_last_owner before update or delete on public.organization_members
  for each row execute function private.protect_last_owner();

-- ---------------------------------------------------------------- RLS
alter table public.platform_staff enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.audit_logs enable row level security;

revoke all on public.platform_staff, public.organizations, public.organization_members, public.audit_logs from anon, authenticated;

grant select on public.platform_staff to authenticated;
create policy platform_staff_self_read on public.platform_staff for select to authenticated
  using (user_id = (select auth.uid()) or private.is_platform_staff());

-- Organizations: members read; owners/managers update descriptive fields only (column grants).
-- Creation, status and plan changes happen server-side (service role) with audit.
grant select (id, name, slug, industry_template_id, country, timezone, primary_language, additional_languages,
              status, website_url, contact_email, contact_phone_e164, fallback_phone_e164, created_at, updated_at)
  on public.organizations to authenticated;
grant update (name, timezone, primary_language, additional_languages, website_url, contact_email,
              contact_phone_e164, fallback_phone_e164)
  on public.organizations to authenticated;
create policy organizations_read on public.organizations for select to authenticated
  using (private.can_read_org(id));
create policy organizations_update on public.organizations for update to authenticated
  using (private.can_configure_org(id)) with check (private.can_configure_org(id));

-- Members: every member sees colleagues; only owners manage membership.
grant select, insert, update, delete on public.organization_members to authenticated;
create policy members_read on public.organization_members for select to authenticated
  using (private.can_read_org(organization_id));
create policy members_owner_insert on public.organization_members for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner']::public.member_role[]));
create policy members_owner_update on public.organization_members for update to authenticated
  using (private.has_org_role(organization_id, array['owner']::public.member_role[]))
  with check (private.has_org_role(organization_id, array['owner']::public.member_role[]));
create policy members_owner_delete on public.organization_members for delete to authenticated
  using (private.has_org_role(organization_id, array['owner']::public.member_role[]));

-- Audit: owners/managers see their own org's trail; platform staff see all. Nobody edits it.
grant select on public.audit_logs to authenticated;
create policy audit_read on public.audit_logs for select to authenticated
  using (private.is_platform_staff() or (organization_id is not null and private.can_configure_org(organization_id)));
