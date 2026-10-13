-- NFL Command Center: initial schema
-- Run in Supabase -> SQL Editor (or `supabase db push` later).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type roster_status as enum (
  'active',
  'injured_reserve',
  'pup',
  'practice_squad',
  'suspended',
  'inactive',
  'released'
);

create type injury_designation as enum (
  'healthy',
  'probable',
  'questionable',
  'doubtful',
  'out',
  'injured_reserve',
  'pup',
  'suspended'
);

create type practice_participation as enum ('full', 'limited', 'dnp', 'unknown');

create type alert_impact as enum ('high', 'medium', 'low');

create type game_status as enum ('scheduled', 'in_progress', 'final', 'postponed');

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
create table teams (
  id          bigint generated always as identity primary key,
  abbr        text not null unique,          -- e.g. KC
  name        text not null,                 -- e.g. Kansas City Chiefs
  conference  text,                          -- AFC / NFC
  division    text,                          -- e.g. West
  espn_id     text unique,
  created_at  timestamptz not null default now()
);

create table players (
  id          bigint generated always as identity primary key,
  full_name   text not null,
  position    text,                          -- QB, WR, OL, ...
  espn_id     text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index players_name_idx on players (full_name);

create table games (
  id            bigint generated always as identity primary key,
  espn_id       text unique,
  season        int  not null,
  week          int  not null,
  kickoff_at    timestamptz not null,
  home_team_id  bigint not null references teams (id),
  away_team_id  bigint not null references teams (id),
  status        game_status not null default 'scheduled',
  created_at    timestamptz not null default now(),
  check (home_team_id <> away_team_id)
);

create index games_kickoff_idx on games (kickoff_at);
create index games_season_week_idx on games (season, week);

-- ---------------------------------------------------------------------------
-- Weekly rosters
-- One row per player per team per week. Refresh weekly so history is kept
-- (trades, signings, IR moves all show up as changes between weeks).
-- ---------------------------------------------------------------------------
create table roster_entries (
  id              bigint generated always as identity primary key,
  season          int  not null,
  week            int  not null,
  team_id         bigint not null references teams (id),
  player_id       bigint not null references players (id),
  jersey_number   int,
  status          roster_status not null default 'active',
  depth_position  text,                       -- slot on the depth chart (e.g. WR1, LT)
  depth_order     int,                        -- 1 = starter, 2 = first backup, ...
  captured_at     timestamptz not null default now(),
  unique (season, week, team_id, player_id)
);

create index roster_entries_team_week_idx on roster_entries (team_id, season, week);
create index roster_entries_player_idx on roster_entries (player_id);

-- ---------------------------------------------------------------------------
-- Injury reports
-- Append-only: one row per player per check. Never update old rows, so we can
-- diff the newest row against the previous one to detect a changed designation.
-- ---------------------------------------------------------------------------
create table ingestion_runs (
  id            bigint generated always as identity primary key,
  kind          text not null,               -- 'injuries', 'schedule', 'rosters'
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  parallel_calls int not null default 0,     -- used for the daily spend cap
  status        text not null default 'running', -- running / ok / error
  error         text
);

create index ingestion_runs_started_idx on ingestion_runs (started_at);

create table injury_reports (
  id              bigint generated always as identity primary key,
  run_id          bigint references ingestion_runs (id),
  player_id       bigint not null references players (id),
  team_id         bigint not null references teams (id),
  game_id         bigint references games (id),
  season          int not null,
  week            int not null,
  designation     injury_designation not null,
  practice        practice_participation not null default 'unknown',
  injury          text,                       -- body part / description
  notes           text,
  source_url      text,
  reported_at     timestamptz not null default now()
);

create index injury_reports_player_time_idx on injury_reports (player_id, reported_at desc);
create index injury_reports_game_idx on injury_reports (game_id);

-- Latest known status per player per week (what the dashboard reads).
create view current_injury_status as
select distinct on (player_id, season, week)
  *
from injury_reports
order by player_id, season, week, reported_at desc;

-- ---------------------------------------------------------------------------
-- Replacements: who steps in when a player is hurt.
-- ---------------------------------------------------------------------------
create table lineup_replacements (
  id                    bigint generated always as identity primary key,
  season                int not null,
  week                  int not null,
  team_id               bigint not null references teams (id),
  game_id               bigint references games (id),
  injured_player_id     bigint not null references players (id),
  replacement_player_id bigint references players (id),   -- null = unknown/TBD
  position              text,
  rationale             text,                  -- e.g. "next on depth chart" / "per beat reporter"
  source_url            text,
  created_at            timestamptz not null default now(),
  superseded_at         timestamptz,           -- set when a newer replacement is recorded
  unique (season, week, team_id, injured_player_id, created_at)
);

create index lineup_replacements_team_week_idx on lineup_replacements (team_id, season, week);

-- ---------------------------------------------------------------------------
-- Alerts: created when a player's designation changes in a way that matters.
-- ---------------------------------------------------------------------------
create table alerts (
  id                    bigint generated always as identity primary key,
  game_id               bigint references games (id),
  team_id               bigint not null references teams (id),
  player_id             bigint not null references players (id),
  injury_report_id      bigint references injury_reports (id),
  previous_designation  injury_designation,
  new_designation       injury_designation not null,
  impact                alert_impact not null default 'medium',
  impact_reason         text,                  -- e.g. "Starting QB ruled out"
  replacement_player_id bigint references players (id),
  created_at            timestamptz not null default now(),
  read_at               timestamptz
);

create index alerts_created_idx on alerts (created_at desc);
create index alerts_unread_idx on alerts (created_at desc) where read_at is null;

-- ---------------------------------------------------------------------------
-- Security: RLS on everywhere. The dashboard reads with the anon key (public
-- NFL info); all writes go through server routes using the service role key,
-- which bypasses RLS.
-- ---------------------------------------------------------------------------
alter table teams               enable row level security;
alter table players             enable row level security;
alter table games               enable row level security;
alter table roster_entries      enable row level security;
alter table ingestion_runs      enable row level security;
alter table injury_reports      enable row level security;
alter table lineup_replacements enable row level security;
alter table alerts              enable row level security;

create policy "public read" on teams               for select using (true);
create policy "public read" on players             for select using (true);
create policy "public read" on games               for select using (true);
create policy "public read" on roster_entries      for select using (true);
create policy "public read" on injury_reports      for select using (true);
create policy "public read" on lineup_replacements for select using (true);
create policy "public read" on alerts              for select using (true);
-- ingestion_runs has no read policy: only the service role can see it.

alter view current_injury_status set (security_invoker = true);

-- Realtime: push new alerts and injury changes to the dashboard.
alter publication supabase_realtime add table alerts;
alter publication supabase_realtime add table injury_reports;
