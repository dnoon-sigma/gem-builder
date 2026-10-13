import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchDepthChart, fetchRoster, fetchScoreboard } from "@/lib/espn";

export const maxDuration = 300;

const GROUP_STATUS: Record<string, string> = {
  injuredReserveOrOut: "injured_reserve",
  practiceSquad: "practice_squad",
  suspended: "suspended",
};

// Snapshots every team's roster for the current week. Safe to re-run: rows are
// upserted on (season, week, team, player).
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = createAdminClient();

  const { data: run } = await db
    .from("ingestion_runs")
    .insert({ kind: "rosters" })
    .select("id")
    .single();

  try {
    const board = await fetchScoreboard();
    const season = board.season.year;
    const week = board.week.number;

    const { data: teams, error: teamErr } = await db.from("teams").select("id, espn_id, abbr");
    if (teamErr) throw teamErr;
    if (!teams?.length) throw new Error("No teams found. Run /api/ingest/schedule first.");

    let players = 0;
    const failures: string[] = [];

    const loadTeam = async (team: { id: number; espn_id: string; abbr: string }) => {
      const [groups, depth] = await Promise.all([
        fetchRoster(team.espn_id),
        fetchDepthChart(team.espn_id, season).catch(() => []),
      ]);

      const athletes = new Map<
        string,
        { name: string; position?: string; jersey?: number; status: string }
      >();
      for (const g of groups) {
        for (const a of g.items) {
          athletes.set(a.id, {
            name: a.fullName,
            position: a.position?.abbreviation,
            jersey: a.jersey ? Number(a.jersey) : undefined,
            status: GROUP_STATUS[g.position] ?? "active",
          });
        }
      }

      const { data: saved, error: pErr } = await db
        .from("players")
        .upsert(
          [...athletes].map(([espnId, a]) => ({
            espn_id: espnId,
            full_name: a.name,
            position: a.position ?? null,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "espn_id" },
        )
        .select("id, espn_id");
      if (pErr) throw pErr;
      const playerId = new Map(saved!.map((p) => [p.espn_id as string, p.id as number]));

      // Best depth slot per player: lowest rank wins.
      const bestDepth = new Map<string, { position: string; rank: number }>();
      for (const d of depth) {
        const prev = bestDepth.get(d.athleteId);
        if (!prev || d.rank < prev.rank) bestDepth.set(d.athleteId, d);
      }

      const rows = [...athletes].map(([espnId, a]) => ({
        season,
        week,
        team_id: team.id,
        player_id: playerId.get(espnId)!,
        jersey_number: a.jersey ?? null,
        status: a.status,
        depth_position: bestDepth.get(espnId)?.position ?? null,
        depth_order: bestDepth.get(espnId)?.rank ?? null,
        captured_at: new Date().toISOString(),
      }));
      const { error: rErr } = await db
        .from("roster_entries")
        .upsert(rows, { onConflict: "season,week,team_id,player_id" });
      if (rErr) throw rErr;
      players += rows.length;
    };

    // Small worker pool so we don't hammer ESPN.
    const queue = [...teams];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let t = queue.shift(); t; t = queue.shift()) {
          try {
            await loadTeam(t);
          } catch (e) {
            failures.push(`${t.abbr}: ${e instanceof Error ? e.message : JSON.stringify(e)}`);
          }
        }
      }),
    );

    await db
      .from("ingestion_runs")
      .update({
        status: failures.length ? "error" : "ok",
        error: failures.length ? failures.join("; ") : null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run!.id);
    return NextResponse.json({ ok: !failures.length, season, week, rosterRows: players, failures });
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    await db
      .from("ingestion_runs")
      .update({ status: "error", error: message, finished_at: new Date().toISOString() })
      .eq("id", run!.id);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
