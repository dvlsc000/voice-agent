-- Commercial (plans, subscriptions, usage, costs) and platform operations (jobs, webhooks, onboarding,
-- incidents, privacy requests, retention).

create or replace function private.log_appointment_created() returns trigger
language plpgsql set search_path = '' as $$
begin
  insert into public.appointment_events (organization_id, appointment_id, from_status, to_status, actor_user_id)
  values (new.organization_id, new.id, null, new.status, (select auth.uid()));
  return new;
end $$;
create trigger appointments_created_event after insert on public.appointments
  for each row execute function private.log_appointment_created();

-- ---------------------------------------------------------------- plans (pricing is data, not code)
create table public.plans (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  name text not null,
  price_minor int not null check (price_minor >= 0),
  currency char(3) not null default 'EUR',
  included_minutes int not null check (included_minutes >= 0),
  overage_per_minute_minor int not null check (overage_per_minute_minor >= 0),
  included_phone_numbers int not null default 1,
  included_locations int not null default 1,
  included_agents int not null default 1,
  allowed_capabilities text[] not null,
  hard_minute_cap int check (hard_minute_cap is null or hard_minute_cap > 0),
  support_tier text not null default 'standard' check (support_tier in ('standard', 'priority', 'dedicated')),
  stripe_price_id text,
  stripe_overage_price_id text,
  is_public boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.plans enable row level security;
revoke all on public.plans from anon, authenticated;
grant select on public.plans to authenticated;
create policy plans_read on public.plans for select to authenticated using (active and is_public or private.is_platform_staff());

create table public.subscriptions (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  plan_code text not null references public.plans (code),
  status text not null check (status in ('trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  past_due_since timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  stripe_invoice_id text not null unique,
  status text not null,
  number text,
  amount_due_minor int not null,
  amount_paid_minor int not null default 0,
  currency char(3) not null,
  period_start timestamptz,
  period_end timestamptz,
  hosted_invoice_url text,
  invoice_pdf_url text,
  created_at timestamptz not null default now()
);
create index invoices_org_idx on public.invoices (organization_id, created_at desc);

-- Billable usage: append-only, idempotent per source event.
create table public.usage_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  call_id uuid,
  metric text not null check (metric in ('call_seconds', 'sms_sent', 'phone_number_days')),
  quantity bigint not null check (quantity >= 0),
  occurred_at timestamptz not null,
  idempotency_key text not null unique,
  reported_to_stripe_at timestamptz
);
create index usage_events_org_time_idx on public.usage_events (organization_id, occurred_at);

-- What each call actually cost us, per provider component.
create table public.provider_cost_events (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id) on delete set null,
  call_id uuid,
  provider text not null,
  component text not null, -- telephony, stt, llm, tts, transfer, sms, number_rental …
  quantity numeric not null,
  unit text not null,
  amount_micros bigint not null, -- micro-units of currency
  currency char(3) not null default 'USD',
  estimated boolean not null default true, -- true until reconciled with the provider invoice
  occurred_at timestamptz not null,
  idempotency_key text not null unique
);
create index provider_cost_events_org_time_idx on public.provider_cost_events (organization_id, occurred_at);

-- Monthly roll-up the dashboards read from (refreshed by a job).
create table public.usage_monthly (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  calls int not null default 0,
  call_seconds bigint not null default 0,
  bookings int not null default 0,
  failed_bookings int not null default 0,
  transfers int not null default 0,
  cost_micros_usd bigint not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (organization_id, month)
);

-- ---------------------------------------------------------------- platform operations (service-only)
create table public.jobs (
  id bigint generated always as identity primary key,
  queue text not null default 'default',
  kind text not null,
  organization_id uuid references public.organizations (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'dead')),
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null default 8,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_ready_idx on public.jobs (queue, run_at) where status = 'queued';

-- Claim work safely across multiple workers.
create or replace function private.claim_jobs(p_queue text, p_worker text, p_limit int default 10)
returns setof public.jobs
language sql security definer set search_path = '' as $$
  update public.jobs j set status = 'running', locked_at = now(), locked_by = p_worker, attempts = j.attempts + 1
  where j.id in (
    select id from public.jobs
    where queue = p_queue and status = 'queued' and run_at <= now()
    order by run_at
    for update skip locked
    limit p_limit
  )
  returning j.*;
$$;

-- Exponential backoff; after max_attempts the job is dead-lettered for operator review.
create or replace function private.fail_job(p_id bigint, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.jobs set
    status = case when attempts >= max_attempts then 'dead' else 'queued' end,
    run_at = now() + make_interval(secs => least(3600, power(2, attempts) * 15)),
    last_error = left(p_error, 2000),
    locked_at = null, locked_by = null,
    finished_at = case when attempts >= max_attempts then now() end
  where id = p_id;
$$;
revoke all on function private.claim_jobs(text, text, int), private.fail_job(bigint, text) from public, authenticated;
grant execute on function private.claim_jobs(text, text, int), private.fail_job(bigint, text) to service_role;

-- Every inbound webhook is recorded once; the unique key makes processing idempotent.
create table public.webhook_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event_id text not null,
  event_type text not null,
  signature_valid boolean not null,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

create table public.onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress', 'awaiting_external', 'ready_for_review', 'live', 'abandoned')),
  current_step text not null default 'business',
  answers jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotent provisioning steps: retrying never duplicates (unique per session + kind).
create table public.onboarding_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid not null references public.onboarding_sessions (id) on delete cascade,
  kind text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'blocked', 'failed', 'skipped')),
  blocked_reason text,
  attempts int not null default 0,
  result jsonb,
  last_error text,
  updated_at timestamptz not null default now(),
  unique (session_id, kind)
);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade, -- null = platform-wide
  severity text not null check (severity in ('sev1', 'sev2', 'sev3')),
  title text not null,
  status text not null default 'open' check (status in ('open', 'mitigated', 'resolved')),
  component text,
  details jsonb not null default '{}'::jsonb,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('access', 'erasure', 'rectification', 'restriction', 'objection')),
  subject_phone_e164 text,
  subject_email extensions.citext,
  status text not null default 'received' check (status in ('received', 'verifying', 'in_progress', 'completed', 'rejected')),
  received_at timestamptz not null default now(),
  due_at timestamptz not null default (now() + interval '30 days'),
  completed_at timestamptz,
  notes text
);

create table public.retention_policies (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  transcript_days int not null default 90 check (transcript_days between 1 and 3650),
  recording_days int not null default 30 check (recording_days between 1 and 3650),
  call_metadata_days int not null default 730 check (call_metadata_days between 30 and 3650),
  inactive_customer_days int not null default 1095 check (inactive_customer_days between 90 and 3650),
  updated_at timestamptz not null default now()
);

-- Retention sweep: hard-deletes expired transcripts/recording rows (storage objects removed by the worker first).
create or replace function private.apply_retention() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t int; r int; c int;
begin
  delete from public.call_transcripts where retain_until < now();
  get diagnostics t = row_count;
  delete from public.call_recordings where retain_until < now();
  get diagnostics r = row_count;
  delete from public.calls c using public.retention_policies p
   where p.organization_id = c.organization_id and c.started_at < now() - make_interval(days => p.call_metadata_days);
  get diagnostics c = row_count;
  return jsonb_build_object('transcripts', t, 'recordings', r, 'calls', c);
end $$;
revoke all on function private.apply_retention() from public, authenticated;
grant execute on function private.apply_retention() to service_role;

-- ---------------------------------------------------------------- triggers & policies
create trigger subscriptions_updated_at before update on public.subscriptions for each row execute function private.set_updated_at();
create trigger onboarding_sessions_updated_at before update on public.onboarding_sessions for each row execute function private.set_updated_at();
create trigger onboarding_tasks_updated_at before update on public.onboarding_tasks for each row execute function private.set_updated_at();
create trigger retention_policies_updated_at before update on public.retention_policies for each row execute function private.set_updated_at();
create trigger subscriptions_audit after insert or update or delete on public.subscriptions for each row execute function private.audit_row();
create trigger retention_policies_audit after insert or update or delete on public.retention_policies for each row execute function private.audit_row();

-- Tenants read their own billing/usage; only the server (Stripe webhooks) writes.
select private.apply_tenant_policies('public.subscriptions', 'none');
select private.apply_tenant_policies('public.invoices', 'none');
select private.apply_tenant_policies('public.usage_monthly', 'none');
select private.apply_tenant_policies('public.onboarding_sessions', 'none');
select private.apply_tenant_policies('public.onboarding_tasks', 'none');
select private.apply_tenant_policies('public.privacy_requests', 'none');
select private.apply_tenant_policies('public.retention_policies', 'configure');

-- Strictly internal: no client access at all (RLS on, no policies, no grants).
do $$
declare t text;
begin
  foreach t in array array['usage_events', 'provider_cost_events', 'jobs', 'webhook_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Incidents: platform staff only.
alter table public.incidents enable row level security;
revoke all on public.incidents from anon, authenticated;
grant select on public.incidents to authenticated;
create policy incidents_staff_read on public.incidents for select to authenticated using (private.is_platform_staff());

-- ---------------------------------------------------------------- default plans (EDIT IN ADMIN; placeholders pending pricing decision)
insert into public.plans (code, name, price_minor, included_minutes, overage_per_minute_minor, included_phone_numbers,
                          included_locations, included_agents, allowed_capabilities, support_tier, is_public, active)
values
  ('starter', 'Starter', 0, 0, 0, 1, 1, 1, array['reception', 'booking', 'messages'], 'standard', true, false),
  ('growth', 'Growth', 0, 0, 0, 1, 1, 1, array['reception', 'booking', 'rescheduling', 'cancellation', 'messages', 'human_handoff', 'sms_confirmations'], 'standard', true, false),
  ('professional', 'Professional', 0, 0, 0, 2, 3, 2, array['reception', 'booking', 'rescheduling', 'cancellation', 'lead_intake', 'messages', 'human_handoff', 'sms_confirmations'], 'priority', true, false),
  ('custom', 'Custom', 0, 0, 0, 1, 1, 1, array['reception', 'booking', 'rescheduling', 'cancellation', 'lead_intake', 'messages', 'human_handoff', 'sms_confirmations'], 'dedicated', false, false);
-- Plans are inserted INACTIVE with zero prices on purpose: a price must be a deliberate business decision.
