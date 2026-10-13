import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchScoreboard, fetchTeams } from "@/lib/espn";

export const maxDuration = 120;

const STATUS: Record<string, string> = {
  STATUS_SCHEDULED: "scheduled",
  STATUS_IN_PROGRESS: "in_progress",
  STATUS_HALFTIME: "in_progress",
  STATUS_END_PERIOD: "in_progress",
  STATUS_FINAL: "final",
  STATUS_POSTPONED: "postponed",
};

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = createAdminClient();

  const { data: run } = await db
    .from("ingestion_runs")
    .insert({ kind: "schedule" })
    .select("id")
    .single();

  try {
    // 1. Teams
    const espnTeams = await fetchTeams();
    const { data: teams, error: teamErr } = await db
      .from("teams")
      .upsert(
        espnTeams.map((t) => ({
          espn_id: t.id,
          abbr: t.abbreviation,
          name: t.displayName,
        })),
        { onConflict: "espn_id" },
      )
      .select("id, espn_id");
    if (teamErr) throw teamErr;
    const teamId = new Map(teams!.map((t) => [t.espn_id as string, t.id as number]));

    // 2. Regular-season games, weeks 1-18
    const current = await fetchScoreboard();
    const season = current.season.year;
    const rows: Record<string, unknown>[] = [];
    for (let week = 1; week <= 18; week++) {
      const board = await fetchScoreboard(week);
      for (const e of board.events) {
        const comp = e.competitions[0].competitors;
        const home = comp.find((c) => c.homeAway === "home")!;
        const away = comp.find((c) => c.homeAway === "away")!;
        rows.push({
          espn_id: e.id,
          season,
          week,
          kickoff_at: e.date,
          home_team_id: teamId.get(home.team.id),
          away_team_id: teamId.get(away.team.id),
          status: STATUS[e.status.type.name] ?? "scheduled",
        });
      }
    }
    const { error: gameErr } = await db.from("games").upsert(rows, { onConflict: "espn_id" });
    if (gameErr) throw gameErr;

    await db
      .from("ingestion_runs")
      .update({ status: "ok", finished_at: new Date().toISOString() })
      .eq("id", run!.id);
    return NextResponse.json({ ok: true, teams: teams!.length, games: rows.length, season });
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    await db
      .from("ingestion_runs")
      .update({ status: "error", error: message, finished_at: new Date().toISOString() })
      .eq("id", run!.id);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
