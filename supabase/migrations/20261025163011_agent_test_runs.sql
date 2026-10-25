-- Automated test conversations for an agent version. Publishing requires a passing run (enforced server-side).
create table public.agent_test_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  agent_version_id uuid not null,
  status text not null check (status in ('running', 'passed', 'failed', 'error')),
  model text not null,
  passed int not null default 0,
  failed int not null default 0,
  results jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (organization_id, agent_version_id) references public.agent_versions (organization_id, id) on delete cascade
);
create index agent_test_runs_version_idx on public.agent_test_runs (organization_id, agent_version_id, created_at desc);
select private.apply_tenant_policies('public.agent_test_runs', 'none');

alter table public.agent_versions
  add constraint agent_versions_test_run_fk foreign key (test_run_id) references public.agent_test_runs (id) on delete set null;
create index agent_versions_test_run_idx on public.agent_versions (test_run_id);
