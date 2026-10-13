-- One Parallel Monitor per team. Tracks which monitor watches which team and
-- what frequency it is currently set to, so we only call Parallel to change it
-- when the desired frequency actually changes.
create table monitors (
  id                  bigint generated always as identity primary key,
  team_id             bigint not null unique references teams (id),
  parallel_monitor_id text not null unique,
  frequency           text not null,
  status              text not null default 'active',
  last_synced_at      timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

alter table monitors enable row level security;
-- No policies: only the service role (server routes) can read or write.

-- Parallel's event id, so a webhook retry never creates a duplicate report.
alter table injury_reports add column source_event_id text unique;
