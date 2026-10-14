// One-off: loads each team's current injury list into Supabase using Parallel's
// Task API (one research run per team). Records reports without creating
// alerts. Run from the project root:
//   node --env-file=.env.local scripts/injury-baseline.mts [ABBR]
import { createClient } from "@supabase/supabase-js";
import { applyInjuryUpdate } from "../lib/injuries.ts";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const headers = { "x-api-key": process.env.PARALLEL_API_KEY!, "Content-Type": "application/json" };
const only = process.argv[2]?.toUpperCase();
const today = new Date().toISOString().slice(0, 10);

const playerSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    player_name: { type: "string", description: "Full name of the player" },
    designation: {
      type: "string",
      description:
        "Official game status for the team's next game: Probable, Questionable, Doubtful, Out, Injured Reserve, PUP, Suspended, or Unknown if no designation has been issued yet",
    },
    practice_status: {
      type: "string",
      description: "Latest practice participation: Full, Limited, Did not participate, or Unknown",
    },
    injury: { type: "string", description: "Body part or injury, or empty if unknown" },
    replacement_player: {
      type: "string",
      description: "Player reported to replace them in the lineup, or empty if none reported",
    },
    summary: { type: "string", description: "One sentence on their status" },
  },
  required: ["player_name", "designation", "practice_status", "injury", "replacement_player", "summary"],
};

const task_spec = {
  output_schema: {
    type: "json",
    json_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        players: {
          type: "array",
          description:
            "Every player currently on this team's injury report or otherwise unavailable through injury: players ruled Out, Doubtful, Questionable or Probable, players on Injured Reserve or PUP, and players limited or not practicing. Empty array if none.",
          items: playerSchema,
        },
      },
      required: ["players"],
    },
  },
};

const { data: teams } = await db.from("teams").select("id, abbr, name").order("abbr");
const targets = (teams ?? []).filter((t) => !only || t.abbr === only);

// Start every run, then collect results.
const runs = await Promise.all(
  targets.map(async (t) => {
    const res = await fetch("https://api.parallel.ai/v1/tasks/runs", {
      method: "POST",
      headers,
      body: JSON.stringify({
        processor: "base",
        input: `NFL team: ${t.name}. Today is ${today}. Using the team's latest official injury report and credible news, list every player currently listed with an injury status or unavailable through injury (Out, Doubtful, Questionable, Probable, Injured Reserve, PUP) and anyone limited or not practicing.`,
        task_spec,
        metadata: { team: t.abbr },
      }),
    });
    if (!res.ok) throw new Error(`${t.abbr}: create run ${res.status} ${await res.text()}`);
    return { team: t, runId: ((await res.json()) as { run_id: string }).run_id };
  }),
);
console.log(`started ${runs.length} runs`);

async function result(runId: string) {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`https://api.parallel.ai/v1/tasks/runs/${runId}/result?timeout=60`, { headers });
    if (res.status === 408) continue;
    if (!res.ok) throw new Error(`result ${res.status} ${await res.text()}`);
    return res.json() as Promise<{ output: { content: { players: any[] }; basis?: any[] } }>;
  }
  throw new Error("timed out");
}

let total = 0;
for (const { team, runId } of runs) {
  try {
    const r = await result(runId);
    const players = r.output.content.players ?? [];
    const tally: Record<string, number> = {};
    const unmatched: string[] = [];
    for (const [i, p] of players.entries()) {
      const out = await applyInjuryUpdate(db, {
        teamId: team.id,
        update: p,
        eventId: `baseline-${today}-${team.abbr}-${String(p.player_name).toLowerCase().replace(/[^a-z]+/g, "-")}`,
        baseline: true,
      });
      tally[out.status] = (tally[out.status] ?? 0) + 1;
      if (out.status === "skipped") unmatched.push(`${p.player_name} (${(out as any).reason})`);
    }
    total += tally.recorded ?? 0;
    console.log(team.abbr.padEnd(4), `${players.length} found`, JSON.stringify(tally), unmatched.length ? `UNMATCHED: ${unmatched.join("; ")}` : "");
  } catch (e) {
    console.log(team.abbr.padEnd(4), "FAILED", e instanceof Error ? e.message : e);
  }
}
console.log("recorded total:", total);
