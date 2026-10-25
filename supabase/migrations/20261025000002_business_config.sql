-- Business configuration: templates, locations, hours, staff, services, agents, phone numbers, knowledge.
-- Cross-tenant references are made impossible with composite foreign keys on (organization_id, id).

-- Standard policy set for tenant tables.
--   read:  members + platform staff
--   write: 'configure' (owner/manager) or 'operate' (owner/manager/receptionist) or 'none' (server only)
create or replace function private.apply_tenant_policies(tbl regclass, write_level text) returns void
language plpgsql set search_path = '' as $$
declare
  t text := tbl::text;
  name text := replace(replace(tbl::text, 'public.', ''), '"', '');
  fn text;
begin
  execute format('alter table %s enable row level security', t);
  execute format('revoke all on %s from anon, authenticated', t);
  execute format('grant select on %s to authenticated', t);
  execute format('create policy %I on %s for select to authenticated using (private.can_read_org(organization_id))', name || '_read', t);
  if write_level = 'none' then
    return;
  end if;
  fn := case write_level when 'configure' then 'private.can_configure_org' when 'operate' then 'private.can_operate_org' end;
  if fn is null then raise exception 'unknown write level %', write_level; end if;
  execute format('grant insert, update, delete on %s to authenticated', t);
  execute format('create policy %I on %s for insert to authenticated with check (%s(organization_id))', name || '_insert', t, fn);
  execute format('create policy %I on %s for update to authenticated using (%s(organization_id)) with check (%s(organization_id))', name || '_update', t, fn, fn);
  execute format('create policy %I on %s for delete to authenticated using (%s(organization_id))', name || '_delete', t, fn);
end $$;
revoke all on function private.apply_tenant_policies(regclass, text) from public, authenticated;

-- ---------------------------------------------------------------- industry templates (global, versioned)
create table public.industry_templates (
  id text not null check (id ~ '^[a-z_]+$'),
  version int not null check (version > 0),
  definition jsonb not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (id, version)
);
create unique index industry_templates_one_current on public.industry_templates (id) where is_current;
alter table public.industry_templates enable row level security;
revoke all on public.industry_templates from anon, authenticated;
grant select on public.industry_templates to authenticated;
create policy industry_templates_read on public.industry_templates for select to authenticated using (true);

-- ---------------------------------------------------------------- locations
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  address_line text,
  city text,
  postcode text,
  timezone text check (timezone is null or private.is_valid_timezone(timezone)), -- null = organization timezone
  directions jsonb not null default '{}'::jsonb, -- {"en": "...", "hr": "..."}
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index locations_one_primary on public.locations (organization_id) where is_primary;

-- Weekly opening hours: several ranges per weekday allowed (lunch breaks). ISO weekday 1 = Monday.
create table public.business_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7),
  opens time not null,
  closes time not null,
  check (closes > opens or closes = '00:00'),
  foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade
);
create index business_hours_loc_idx on public.business_hours (location_id, weekday);

-- ---------------------------------------------------------------- staff and services
create table public.staff_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  location_id uuid,
  display_name text not null,
  aliases text[] not null default '{}', -- "Marko", "Mark" — helps resolve spoken names
  active boolean not null default true,
  bookable boolean not null default true,
  transfer_phone_e164 text check (transfer_phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  calendar_connection_id uuid,
  external_calendar_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete set null (location_id)
);

create table public.staff_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  staff_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7),
  starts time not null,
  ends time not null,
  check (ends > starts or ends = '00:00'),
  foreign key (organization_id, staff_id) references public.staff_members (organization_id, id) on delete cascade
);
create index staff_hours_staff_idx on public.staff_hours (staff_id, weekday);

-- Closures and special hours for the whole business (staff_id null) or one staff member.
create table public.date_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  location_id uuid,
  staff_id uuid,
  date date not null,
  closed boolean not null,
  ranges jsonb not null default '[]'::jsonb, -- [{"start":"10:00","end":"14:00"}] when not closed
  label text,
  check (closed or jsonb_array_length(ranges) > 0),
  foreign key (organization_id, staff_id) references public.staff_members (organization_id, id) on delete cascade,
  foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade
);
create unique index date_exceptions_unique on public.date_exceptions
  (organization_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'), coalesce(staff_id, '00000000-0000-0000-0000-000000000000'), date);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  names jsonb not null check (names ? 'en' or names ? 'hr'), -- localized display names
  aliases text[] not null default '{}',
  duration_min int not null check (duration_min between 5 and 600),
  buffer_before_min int not null default 0 check (buffer_before_min between 0 and 240),
  buffer_after_min int not null default 0 check (buffer_after_min between 0 and 240),
  price_minor int check (price_minor is null or price_minor >= 0),
  price_is_from boolean not null default false,
  price_approved boolean not null default false, -- agent quotes only approved prices
  currency char(3) not null default 'EUR',
  bookable_by_phone boolean not null default true,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.service_staff (
  organization_id uuid not null,
  service_id uuid not null,
  staff_id uuid not null,
  primary key (service_id, staff_id),
  foreign key (organization_id, service_id) references public.services (organization_id, id) on delete cascade,
  foreign key (organization_id, staff_id) references public.staff_members (organization_id, id) on delete cascade
);

create table public.booking_rules (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  slot_interval_min int not null default 15 check (slot_interval_min in (5, 10, 15, 20, 30, 60)),
  min_lead_min int not null default 60 check (min_lead_min >= 0),
  max_days_ahead int not null default 60 check (max_days_ahead between 1 and 365),
  hold_ttl_sec int not null default 300 check (hold_ttl_sec between 30 and 1800),
  cancellation_notice_hours int not null default 24 check (cancellation_notice_hours >= 0),
  allow_phone_cancellation boolean not null default true,
  allow_phone_rescheduling boolean not null default true,
  walk_in_policy jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- integrations (credentials kept out of reach)
create type public.integration_provider as enum ('google_calendar', 'microsoft_calendar', 'calcom', 'webhook');
create type public.integration_status as enum ('pending_authorization', 'connected', 'error', 'revoked');

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider public.integration_provider not null,
  status public.integration_status not null default 'pending_authorization',
  account_label text,
  scopes text[] not null default '{}',
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

-- Secrets referenced by Supabase Vault id. No client grants at all; only service_role reads this.
create table public.integration_secrets (
  connection_id uuid primary key references public.integration_connections (id) on delete cascade,
  vault_secret_id uuid not null,
  rotated_at timestamptz not null default now()
);
alter table public.integration_secrets enable row level security;
revoke all on public.integration_secrets from anon, authenticated;

alter table public.staff_members
  add foreign key (organization_id, calendar_connection_id)
  references public.integration_connections (organization_id, id) on delete set null (calendar_connection_id);

-- ---------------------------------------------------------------- agents (versioned, auditable)
create type public.agent_version_status as enum ('draft', 'testing', 'published', 'archived');

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  active_version_id uuid,
  voice_provider text not null default 'eu_native',
  external_agent_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.agent_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  agent_id uuid not null,
  version_no int not null check (version_no > 0),
  template_id text not null,
  template_version int not null,
  settings jsonb not null, -- validated AgentSettings
  compiled jsonb, -- CompiledAgent snapshot (prompt, tools, first message)
  content_hash text,
  status public.agent_version_status not null default 'draft',
  test_run_id uuid,
  created_by uuid,
  published_by uuid,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (agent_id, version_no),
  unique (organization_id, id),
  foreign key (organization_id, agent_id) references public.agents (organization_id, id) on delete cascade,
  foreign key (template_id, template_version) references public.industry_templates (id, version),
  check (status <> 'published' or (compiled is not null and content_hash is not null and published_at is not null))
);
alter table public.agents
  add foreign key (organization_id, active_version_id) references public.agent_versions (organization_id, id)
  on delete set null (active_version_id) deferrable initially deferred;

-- Published versions are immutable: roll back by activating an older version, not by editing.
create or replace function private.freeze_published_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'published' and (new.settings is distinct from old.settings or new.compiled is distinct from old.compiled
     or new.content_hash is distinct from old.content_hash) then
    raise exception 'Published agent versions are immutable; create a new version' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger agent_versions_freeze before update on public.agent_versions
  for each row execute function private.freeze_published_version();

-- ---------------------------------------------------------------- phone numbers
create type public.phone_number_status as enum ('requested', 'pending_regulatory', 'porting', 'provisioning', 'active', 'suspended', 'released');

create table public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  e164 text check (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  country public.country_code not null,
  connection_type text not null check (connection_type in ('provider_number', 'forwarded', 'sip_byoc', 'ported')),
  provider text not null,
  provider_number_id text,
  status public.phone_number_status not null default 'requested',
  agent_id uuid,
  after_hours_behavior text not null default 'agent' check (after_hours_behavior in ('agent', 'voicemail', 'forward')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, agent_id) references public.agents (organization_id, id) on delete set null (agent_id)
);
-- A number routes to exactly one tenant: this is how inbound calls resolve tenant context server-side.
create unique index phone_numbers_e164_live on public.phone_numbers (e164) where status <> 'released' and e164 is not null;

-- ---------------------------------------------------------------- knowledge (approved facts only reach the agent)
create type public.knowledge_status as enum ('draft', 'pending_review', 'approved', 'archived');

create table public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('faq', 'policy', 'info', 'instruction')),
  language public.language_code not null,
  question text,
  content text not null check (length(content) <= 4000),
  source text not null default 'manual' check (source in ('manual', 'website_import', 'document')),
  source_url text,
  status public.knowledge_status not null default 'draft',
  version int not null default 1,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'approved' or approved_at is not null)
);
create index knowledge_items_org_idx on public.knowledge_items (organization_id, status);

-- ---------------------------------------------------------------- triggers, audit and policies
do $$
declare t text;
begin
  foreach t in array array['locations', 'staff_members', 'services', 'integration_connections', 'agents', 'phone_numbers', 'knowledge_items', 'booking_rules'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', t || '_updated_at', t);
  end loop;
  foreach t in array array['locations', 'business_hours', 'staff_members', 'staff_hours', 'date_exceptions', 'services', 'service_staff',
                           'booking_rules', 'integration_connections', 'agents', 'agent_versions', 'phone_numbers', 'knowledge_items'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row()', t || '_audit', t);
  end loop;
end $$;

select private.apply_tenant_policies('public.locations', 'configure');
select private.apply_tenant_policies('public.business_hours', 'configure');
select private.apply_tenant_policies('public.staff_members', 'configure');
select private.apply_tenant_policies('public.staff_hours', 'configure');
select private.apply_tenant_policies('public.date_exceptions', 'configure');
select private.apply_tenant_policies('public.services', 'configure');
select private.apply_tenant_policies('public.service_staff', 'configure');
select private.apply_tenant_policies('public.booking_rules', 'configure');
select private.apply_tenant_policies('public.knowledge_items', 'configure');
-- Server-managed (OAuth flows, provisioning, publishing need validation + external side effects):
select private.apply_tenant_policies('public.integration_connections', 'none');
select private.apply_tenant_policies('public.agents', 'none');
select private.apply_tenant_policies('public.agent_versions', 'none');
select private.apply_tenant_policies('public.phone_numbers', 'none');

-- Clients may approve knowledge only as themselves.
create or replace function private.stamp_knowledge_approval() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved' or old.content is distinct from new.content) then
    new.approved_at := now();
    new.approved_by := (select auth.uid());
    if tg_op = 'UPDATE' and old.content is distinct from new.content then new.version := old.version + 1; end if;
  end if;
  return new;
end $$;
create trigger knowledge_items_approval before insert or update on public.knowledge_items
  for each row execute function private.stamp_knowledge_approval();
