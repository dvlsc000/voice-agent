-- Operations: customers, appointments (double-booking impossible at DB level), calls, enquiries, notifications.

-- Personal data readers: everyone except read-only analysts (data minimisation).
create or replace function private.can_read_personal_data(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_operate_org(org) or private.is_platform_admin();
$$;
grant execute on function private.can_read_personal_data(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- customers
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  full_name text not null check (length(full_name) between 1 and 200),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email extensions.citext,
  preferred_language public.language_code,
  sms_opt_in boolean not null default false,
  sms_opt_in_at timestamptz,
  notes text check (length(notes) <= 2000),
  last_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
-- One customer record per phone number per business; voice bookings upsert on this.
create unique index customers_org_phone on public.customers (organization_id, phone_e164) where phone_e164 is not null;

-- ---------------------------------------------------------------- appointments
create type public.booking_status as enum (
  'requested', 'validating', 'holding', 'committing', 'confirmed', 'needs_reconciliation',
  'failed', 'expired', 'cancelled', 'completed', 'no_show'
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  location_id uuid,
  customer_id uuid,
  service_id uuid not null,
  staff_id uuid not null,
  status public.booking_status not null default 'requested',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  block_start timestamptz not null, -- includes buffer before
  block_end timestamptz not null, -- includes buffer after
  hold_expires_at timestamptz,
  reference_hash text, -- sha256(salt:reference); the plain reference is only ever spoken/sent to the customer
  source text not null check (source in ('voice', 'dashboard', 'external_sync', 'api')),
  call_id uuid,
  idempotency_key text not null,
  external_calendar_event_id text,
  rescheduled_from_id uuid references public.appointments (id),
  cancellation_reason text,
  notes text check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  check (ends_at > starts_at and block_start <= starts_at and block_end >= ends_at),
  check (status <> 'holding' or hold_expires_at is not null),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete set null (customer_id),
  foreign key (organization_id, service_id) references public.services (organization_id, id),
  foreign key (organization_id, staff_id) references public.staff_members (organization_id, id),
  foreign key (organization_id, location_id) references public.locations (organization_id, id),
  -- The core guarantee: one staff member cannot hold two overlapping live bookings, whatever the race.
  constraint appointments_no_double_booking exclude using gist (
    staff_id with =,
    tstzrange(block_start, block_end, '[)') with &&
  ) where (status in ('holding', 'committing', 'confirmed', 'needs_reconciliation'))
);
create index appointments_org_start_idx on public.appointments (organization_id, starts_at);
create index appointments_staff_start_idx on public.appointments (staff_id, starts_at) where status in ('holding', 'committing', 'confirmed', 'needs_reconciliation');
create index appointments_holds_idx on public.appointments (hold_expires_at) where status = 'holding';

-- Mirror of packages/core/src/booking/state-machine.ts — the database refuses illegal transitions too.
create or replace function private.check_booking_transition() returns trigger
language plpgsql set search_path = '' as $$
declare ok boolean;
begin
  if new.status = old.status then return new; end if;
  ok := case old.status
    when 'requested' then new.status in ('validating', 'cancelled')
    when 'validating' then new.status in ('holding', 'failed')
    when 'holding' then new.status in ('committing', 'expired', 'failed', 'cancelled')
    when 'committing' then new.status in ('confirmed', 'failed', 'needs_reconciliation')
    when 'needs_reconciliation' then new.status in ('confirmed', 'failed')
    when 'confirmed' then new.status in ('cancelled', 'completed', 'no_show')
    else false
  end;
  if not ok then
    raise exception 'Illegal booking transition % -> %', old.status, new.status using errcode = 'check_violation';
  end if;
  insert into public.appointment_events (organization_id, appointment_id, from_status, to_status, actor_user_id)
  values (new.organization_id, new.id, old.status, new.status, (select auth.uid()));
  return new;
end $$;

create table public.appointment_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  appointment_id uuid not null,
  from_status public.booking_status,
  to_status public.booking_status not null,
  actor_user_id uuid,
  details jsonb not null default '{}'::jsonb,
  at timestamptz not null default now(),
  foreign key (organization_id, appointment_id) references public.appointments (organization_id, id) on delete cascade
);
create index appointment_events_appt_idx on public.appointment_events (appointment_id, at);

create trigger appointments_transition before update of status on public.appointments
  for each row execute function private.check_booking_transition();

-- Release holds that outlived their TTL (called by the booking service before checks, and by a scheduled job).
create or replace function private.expire_stale_holds(p_org uuid default null) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.appointments set status = 'expired'
  where status = 'holding' and hold_expires_at < now() and (p_org is null or organization_id = p_org);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.expire_stale_holds(uuid) from public, authenticated;
grant execute on function private.expire_stale_holds(uuid) to service_role;

-- ---------------------------------------------------------------- calls
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  phone_number_id uuid,
  agent_version_id uuid,
  provider text not null,
  provider_call_id text not null,
  direction text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  from_e164 text, -- null when caller ID withheld
  to_e164 text,
  language public.language_code,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_sec int check (duration_sec >= 0),
  ended_by text check (ended_by in ('caller', 'agent', 'error', 'timeout')),
  outcome text check (outcome in ('booked', 'rescheduled', 'cancelled', 'info_given', 'message_taken', 'lead_captured',
                                  'transferred', 'escalated', 'abandoned', 'spam', 'failed', 'other')),
  summary text check (length(summary) <= 2000),
  customer_id uuid,
  escalation_rule_id text,
  cost_micros bigint not null default 0, -- fully loaded provider cost in micro-USD, from provider_cost_events
  created_at timestamptz not null default now(),
  unique (provider, provider_call_id),
  unique (organization_id, id),
  foreign key (organization_id, phone_number_id) references public.phone_numbers (organization_id, id) on delete set null (phone_number_id),
  foreign key (organization_id, agent_version_id) references public.agent_versions (organization_id, id) on delete set null (agent_version_id),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete set null (customer_id)
);
create index calls_org_started_idx on public.calls (organization_id, started_at desc);

alter table public.appointments
  add foreign key (organization_id, call_id) references public.calls (organization_id, id) on delete set null (call_id);

-- Ordered, append-only operational trace of a call (tool requests/results, transfers, errors). No transcript text.
create table public.call_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  call_id uuid not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  at timestamptz not null default now(),
  foreign key (organization_id, call_id) references public.calls (organization_id, id) on delete cascade
);
create index call_events_call_idx on public.call_events (call_id, id);

-- Transcripts are separate so they can have stricter access and their own retention.
create table public.call_transcripts (
  call_id uuid primary key,
  organization_id uuid not null,
  segments jsonb not null, -- [{role, text, at}]
  redacted boolean not null default false,
  retain_until timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, call_id) references public.calls (organization_id, id) on delete cascade
);
create index call_transcripts_retention_idx on public.call_transcripts (retain_until);

create table public.call_recordings (
  call_id uuid primary key,
  organization_id uuid not null,
  storage_path text not null, -- private bucket object; served via short-lived signed URLs with access logging
  duration_sec int,
  retain_until timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, call_id) references public.calls (organization_id, id) on delete cascade
);
create index call_recordings_retention_idx on public.call_recordings (retain_until);

-- ---------------------------------------------------------------- enquiries: messages, callbacks, leads
create table public.enquiries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  call_id uuid,
  kind text not null check (kind in ('message', 'callback', 'lead', 'voicemail')),
  urgency text not null default 'normal' check (urgency in ('normal', 'urgent')),
  caller_name text,
  callback_phone_e164 text check (callback_phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  summary text check (length(summary) <= 2000),
  fields jsonb not null default '{}'::jsonb,
  sensitive_fields jsonb not null default '{}'::jsonb, -- never included in email/SMS notifications
  escalation_rule_id text,
  status text not null default 'new' check (status in ('new', 'in_progress', 'done', 'spam')),
  assigned_to uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, call_id) references public.calls (organization_id, id) on delete set null (call_id)
);
create index enquiries_org_status_idx on public.enquiries (organization_id, status, created_at desc);

-- ---------------------------------------------------------------- notifications (deduplicated outbox)
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  template text not null,
  language public.language_code not null,
  recipient text not null,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'suppressed')),
  provider_message_id text,
  error text,
  attempts int not null default 0,
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, dedupe_key)
);
create index notifications_queue_idx on public.notifications (send_after) where status = 'queued';

-- ---------------------------------------------------------------- triggers & policies
create trigger customers_updated_at before update on public.customers for each row execute function private.set_updated_at();
create trigger appointments_updated_at before update on public.appointments for each row execute function private.set_updated_at();
create trigger enquiries_updated_at before update on public.enquiries for each row execute function private.set_updated_at();
create trigger appointments_audit after insert or update or delete on public.appointments for each row execute function private.audit_row();
create trigger customers_audit after delete on public.customers for each row execute function private.audit_row();

-- Customers: personal data → not visible to analysts.
alter table public.customers enable row level security;
revoke all on public.customers from anon, authenticated;
grant select, insert, update, delete on public.customers to authenticated;
create policy customers_read on public.customers for select to authenticated using (private.can_read_personal_data(organization_id));
create policy customers_write on public.customers for insert to authenticated with check (private.can_operate_org(organization_id));
create policy customers_update on public.customers for update to authenticated using (private.can_operate_org(organization_id)) with check (private.can_operate_org(organization_id));
create policy customers_delete on public.customers for delete to authenticated using (private.can_configure_org(organization_id));

-- Appointments: readable by members (analysts see times/status; customer details are in customers);
-- status changes from the dashboard go through the booking API (service role) so external calendars stay in sync.
select private.apply_tenant_policies('public.appointments', 'none');
grant update (notes) on public.appointments to authenticated;
create policy appointments_notes_update on public.appointments for update to authenticated
  using (private.can_operate_org(organization_id)) with check (private.can_operate_org(organization_id));
select private.apply_tenant_policies('public.appointment_events', 'none');

select private.apply_tenant_policies('public.calls', 'none');
select private.apply_tenant_policies('public.call_events', 'none');

alter table public.call_transcripts enable row level security;
revoke all on public.call_transcripts from anon, authenticated;
grant select on public.call_transcripts to authenticated;
create policy call_transcripts_read on public.call_transcripts for select to authenticated using (private.can_read_personal_data(organization_id));

alter table public.call_recordings enable row level security;
revoke all on public.call_recordings from anon, authenticated;
grant select on public.call_recordings to authenticated;
create policy call_recordings_read on public.call_recordings for select to authenticated
  using (private.has_org_role(organization_id, array['owner', 'manager']::public.member_role[]));

alter table public.enquiries enable row level security;
revoke all on public.enquiries from anon, authenticated;
grant select on public.enquiries to authenticated;
grant update (status, assigned_to, resolved_at) on public.enquiries to authenticated;
create policy enquiries_read on public.enquiries for select to authenticated using (private.can_read_personal_data(organization_id));
create policy enquiries_update on public.enquiries for update to authenticated
  using (private.can_operate_org(organization_id)) with check (private.can_operate_org(organization_id));

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
create policy notifications_read on public.notifications for select to authenticated using (private.can_read_personal_data(organization_id));
