import type { SupabaseClient } from "@supabase/supabase-js";

export type InjuryUpdate = {
  player_name: string;
  designation: string;
  practice_status?: string;
  injury?: string;
  replacement_player?: string;
  summary?: string;
};

export type Designation =
  | "healthy"
  | "probable"
  | "questionable"
  | "doubtful"
  | "out"
  | "injured_reserve"
  | "pup"
  | "suspended";

export function parseDesignation(raw: string): Designation | undefined {
  const s = raw.toLowerCase();
  if (/injured reserve|\bir\b/.test(s)) return "injured_reserve";
  if (/\bpup\b/.test(s)) return "pup";
  if (/suspend/.test(s)) return "suspended";
  if (/doubtful/.test(s)) return "doubtful";
  if (/questionable/.test(s)) return "questionable";
  if (/probable/.test(s)) return "probable";
  if (/\bout\b/.test(s)) return "out";
  if (/healthy|cleared|active|no designation|full/.test(s)) return "healthy";
  return undefined;
}

function parsePractice(raw?: string): "full" | "limited" | "dnp" | "unknown" {
  const s = (raw ?? "").toLowerCase();
  if (/did not|dnp|no practice/.test(s)) return "dnp";
  if (/limited/.test(s)) return "limited";
  if (/full/.test(s)) return "full";
  return "unknown";
}

const normalize = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

type RosterRow = {
  player_id: number;
  depth_position: string | null;
  depth_order: number | null;
  status: string;
  players: { full_name: string; position: string | null };
};

const SEVERE = new Set<Designation>(["out", "doubtful", "injured_reserve", "pup", "suspended"]);

// How much a change matters to a game: starters out are high, a questionable
// quarterback is high, other questionable starters medium, backups low.
export function impactOf(
  designation: Designation,
  position: string | null,
  depthOrder: number | null,
): { impact: "high" | "medium" | "low"; reason: string } {
  const starter = depthOrder === 1;
  const pos = position ?? "player";
  if (designation === "healthy" || designation === "probable") {
    return { impact: "low", reason: `${pos} cleared or likely to play` };
  }
  if (position === "QB" && starter) return { impact: "high", reason: `Starting QB is ${designation}` };
  if (starter && SEVERE.has(designation)) {
    return { impact: "high", reason: `Starting ${pos} is ${designation.replace("_", " ")}` };
  }
  if (starter) return { impact: "medium", reason: `Starting ${pos} is ${designation}` };
  return { impact: "low", reason: `Backup ${pos} is ${designation.replace("_", " ")}` };
}

// Writes one injury report, and, when the player's designation changed, an
// alert plus a replacement suggestion. Returns what happened.
export async function applyInjuryUpdate(
  db: SupabaseClient,
  args: {
    teamId: number;
    update: InjuryUpdate;
    eventId: string;
    sourceUrl?: string;
    now?: Date;
  },
) {
  const now = args.now ?? new Date();
  const designation = parseDesignation(args.update.designation);
  if (!designation) return { status: "skipped" as const, reason: "unknown designation" };

  // Latest roster snapshot for the team
  const { data: latest } = await db
    .from("roster_entries")
    .select("season, week")
    .eq("team_id", args.teamId)
    .order("season", { ascending: false })
    .order("week", { ascending: false })
    .limit(1)
    .single();
  if (!latest) return { status: "skipped" as const, reason: "no roster loaded" };

  const { data: roster } = await db
    .from("roster_entries")
    .select("player_id, depth_position, depth_order, status, players(full_name, position)")
    .eq("team_id", args.teamId)
    .eq("season", latest.season)
    .eq("week", latest.week)
    .returns<RosterRow[]>();
  const rows = roster ?? [];

  const wanted = normalize(args.update.player_name);
  const entry = rows.find((r) => normalize(r.players.full_name) === wanted);
  if (!entry) return { status: "skipped" as const, reason: `no roster match for ${args.update.player_name}` };

  // Team's next game
  const { data: games } = await db
    .from("games")
    .select("id")
    .or(`home_team_id.eq.${args.teamId},away_team_id.eq.${args.teamId}`)
    .gt("kickoff_at", now.toISOString())
    .order("kickoff_at", { ascending: true })
    .limit(1);
  const gameId = games?.[0]?.id ?? null;

  // Previous status this week, to detect a change
  const { data: prev } = await db
    .from("injury_reports")
    .select("designation")
    .eq("player_id", entry.player_id)
    .eq("season", latest.season)
    .eq("week", latest.week)
    .order("reported_at", { ascending: false })
    .limit(1);
  const previous = (prev?.[0]?.designation as Designation | undefined) ?? undefined;

  const { data: report, error } = await db
    .from("injury_reports")
    .insert({
      player_id: entry.player_id,
      team_id: args.teamId,
      game_id: gameId,
      season: latest.season,
      week: latest.week,
      designation,
      practice: parsePractice(args.update.practice_status),
      injury: args.update.injury || null,
      notes: args.update.summary || null,
      source_url: args.sourceUrl ?? null,
      source_event_id: args.eventId,
      reported_at: now.toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    // unique violation on source_event_id = a retried webhook
    if (error.code === "23505") return { status: "duplicate" as const };
    throw error;
  }

  if (previous === designation) return { status: "recorded" as const, alert: false };
  if (!previous && designation === "healthy") return { status: "recorded" as const, alert: false };

  // Replacement: the reported one if we can match them, else the next player
  // on the depth chart at the same slot who isn't hurt themselves.
  let replacementId: number | null = null;
  if (SEVERE.has(designation) || designation === "questionable") {
    const named = args.update.replacement_player
      ? rows.find((r) => normalize(r.players.full_name) === normalize(args.update.replacement_player!))
      : undefined;
    const byDepth = rows
      .filter(
        (r) =>
          r.depth_position &&
          r.depth_position === entry.depth_position &&
          r.player_id !== entry.player_id &&
          r.status === "active" &&
          (r.depth_order ?? 99) > (entry.depth_order ?? 0),
      )
      .sort((a, b) => (a.depth_order ?? 99) - (b.depth_order ?? 99))[0];
    replacementId = (named ?? byDepth)?.player_id ?? null;

    if (replacementId && SEVERE.has(designation)) {
      await db
        .from("lineup_replacements")
        .update({ superseded_at: now.toISOString() })
        .eq("season", latest.season)
        .eq("week", latest.week)
        .eq("team_id", args.teamId)
        .eq("injured_player_id", entry.player_id)
        .is("superseded_at", null);
      await db.from("lineup_replacements").insert({
        season: latest.season,
        week: latest.week,
        team_id: args.teamId,
        game_id: gameId,
        injured_player_id: entry.player_id,
        replacement_player_id: replacementId,
        position: entry.depth_position ?? entry.players.position,
        rationale: named ? "Reported replacement" : "Next on depth chart",
        source_url: args.sourceUrl ?? null,
      });
    }
  }

  const { impact, reason } = impactOf(designation, entry.players.position, entry.depth_order);
  await db.from("alerts").insert({
    game_id: gameId,
    team_id: args.teamId,
    player_id: entry.player_id,
    injury_report_id: report.id,
    previous_designation: previous ?? null,
    new_designation: designation,
    impact,
    impact_reason: reason,
    replacement_player_id: replacementId,
  });
  return { status: "recorded" as const, alert: true, impact };
}
