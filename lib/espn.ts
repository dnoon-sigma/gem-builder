const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";

async function getJson<T>(url: string, revalidate?: number): Promise<T> {
  const res = await fetch(
    url,
    revalidate ? { next: { revalidate } } : { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export type EspnTeam = { id: string; abbreviation: string; displayName: string };

export async function fetchTeams(): Promise<EspnTeam[]> {
  const data = await getJson<{
    sports: { leagues: { teams: { team: EspnTeam }[] }[] }[];
  }>(`${SITE}/teams`);
  return data.sports[0].leagues[0].teams.map((t) => t.team);
}

export type EspnEvent = {
  id: string;
  date: string;
  status: { type: { name: string } };
  competitions: {
    competitors: { homeAway: "home" | "away"; team: { id: string } }[];
  }[];
};

type Scoreboard = {
  season: { year: number; type: number };
  week: { number: number };
  events: EspnEvent[];
};

export async function fetchScoreboard(week?: number): Promise<Scoreboard> {
  const q = week ? `?week=${week}&seasontype=2` : "";
  return getJson<Scoreboard>(`${SITE}/scoreboard${q}`);
}

export type EspnAthlete = {
  id: string;
  fullName: string;
  jersey?: string;
  position?: { abbreviation: string };
};

type RosterResponse = {
  athletes: { position: string; items: EspnAthlete[] }[];
};

// Roster groups ESPN returns: offense, defense, specialTeam,
// injuredReserveOrOut, suspended, practiceSquad
export async function fetchRoster(teamId: string) {
  const data = await getJson<RosterResponse>(`${SITE}/teams/${teamId}/roster`);
  return data.athletes;
}

export type DepthSlot = { position: string; athleteId: string; rank: number };

type DepthResponse = {
  items: {
    positions: Record<
      string,
      { athletes: { rank: number; athlete: { $ref: string } }[] }
    >;
  }[];
};

// Flattens every formation ESPN returns into position/rank rows. A player can
// appear in more than one formation; we keep the best (lowest) rank per
// position + athlete.
export async function fetchDepthChart(teamId: string, season: number): Promise<DepthSlot[]> {
  const data = await getJson<DepthResponse>(
    `${CORE}/seasons/${season}/teams/${teamId}/depthcharts`,
  );
  const best = new Map<string, DepthSlot>();
  for (const formation of data.items) {
    for (const [position, entry] of Object.entries(formation.positions)) {
      for (const a of entry.athletes) {
        const athleteId = a.athlete.$ref.match(/athletes\/(\d+)/)?.[1];
        if (!athleteId) continue;
        const key = `${position}:${athleteId}`;
        const prev = best.get(key);
        if (!prev || a.rank < prev.rank) {
          best.set(key, { position: position.toUpperCase(), athleteId, rank: a.rank });
        }
      }
    }
  }
  return [...best.values()];
}

// ---------------------------------------------------------------------------
// Upcoming week + betting odds (DraftKings, via ESPN)
// ---------------------------------------------------------------------------
type OddsSide = {
  close?: { line?: string; odds?: string };
};

type RawOdds = {
  provider?: { displayName?: string };
  overUnder?: number;
  moneyline?: { home?: OddsSide; away?: OddsSide };
  pointSpread?: { home?: OddsSide; away?: OddsSide };
};

type RawCompetitor = {
  homeAway: "home" | "away";
  team: { id: string; abbreviation: string; displayName: string; logo?: string };
  records?: { type: string; summary: string }[];
};

type RawEvent = Omit<EspnEvent, "competitions"> & {
  competitions: { competitors: RawCompetitor[]; odds?: RawOdds[] }[];
};

export type Matchup = {
  id: string;
  kickoff: string;
  status: string;
  away: TeamLine;
  home: TeamLine;
  total?: number;
  book?: string;
};

export type TeamLine = {
  abbr: string;
  name: string;
  logo?: string;
  record?: string;
  spread?: string;
  spreadOdds?: string;
  moneyline?: string;
};

export type UpcomingWeek = { season: number; week: number; matchups: Matchup[] };

// "Next week" = the first week that still has games to play. ESPN's default
// scoreboard shows the week just played until it rolls over, so if every game
// there is final we move on to the following week.
export async function fetchUpcomingWeek(): Promise<UpcomingWeek> {
  let board = await getJson<Omit<Scoreboard, "events"> & { events: RawEvent[] }>(
    `${SITE}/scoreboard`,
    300,
  );
  const allFinal = board.events.every((e) => e.status.type.name === "STATUS_FINAL");
  if (allFinal) {
    board = await getJson(
      `${SITE}/scoreboard?week=${board.week.number + 1}&seasontype=2`,
      300,
    );
  }

  const matchups = board.events.map((e): Matchup => {
    const comp = e.competitions[0];
    const odds = comp.odds?.[0];
    const side = (c: RawCompetitor): TeamLine => {
      const k = c.homeAway;
      return {
        abbr: c.team.abbreviation,
        name: c.team.displayName,
        logo: c.team.logo,
        record: c.records?.find((r) => r.type === "total")?.summary,
        spread: odds?.pointSpread?.[k]?.close?.line,
        spreadOdds: odds?.pointSpread?.[k]?.close?.odds,
        moneyline: odds?.moneyline?.[k]?.close?.odds,
      };
    };
    return {
      id: e.id,
      kickoff: e.date,
      status: e.status.type.name,
      away: side(comp.competitors.find((c) => c.homeAway === "away")!),
      home: side(comp.competitors.find((c) => c.homeAway === "home")!),
      total: odds?.overUnder,
      book: odds?.provider?.displayName,
    };
  });
  matchups.sort((a, b) => a.kickoff.localeCompare(b.kickoff));

  return { season: board.season.year, week: board.week.number, matchups };
}
