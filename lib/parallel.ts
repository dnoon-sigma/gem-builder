const BASE = "https://api.parallel.ai";

function headers() {
  const key = process.env.PARALLEL_API_KEY;
  if (!key) throw new Error("PARALLEL_API_KEY is not set");
  return { "x-api-key": key, "Content-Type": "application/json" };
}

export const parallelEnabled = () => process.env.PARALLEL_ENABLED === "true";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Parallel ${method} ${path} -> ${res.status}: ${await res.text()}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

// What each injury event looks like. Parallel returns one event per player
// whose status changed.
export const INJURY_OUTPUT_SCHEMA = {
  type: "json",
  json_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      player_name: { type: "string", description: "Full name of the player" },
      designation: {
        type: "string",
        description:
          "Official game status: Healthy, Probable, Questionable, Doubtful, Out, Injured Reserve, PUP or Suspended",
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
      summary: { type: "string", description: "One sentence describing the update" },
    },
    required: [
      "player_name",
      "designation",
      "practice_status",
      "injury",
      "replacement_player",
      "summary",
    ],
  },
} as const;

export type MonitorResponse = { monitor_id: string; frequency: string; status: string };

export function createMonitor(args: {
  query: string;
  frequency: string;
  webhookUrl: string;
  metadata: Record<string, string>;
}) {
  return call<MonitorResponse>("POST", "/v1/monitors", {
    type: "event_stream",
    frequency: args.frequency,
    processor: "lite",
    settings: { query: args.query, output_schema: INJURY_OUTPUT_SCHEMA },
    webhook: {
      url: args.webhookUrl,
      event_types: ["monitor.event.detected", "monitor.execution.failed"],
    },
    metadata: args.metadata,
  });
}

export function updateMonitorFrequency(monitorId: string, frequency: string) {
  return call<MonitorResponse>("POST", `/v1/monitors/${monitorId}/update`, { frequency });
}

export type ParallelEvent = {
  event_id: string;
  event_group_id: string;
  event_date: string | null;
  event_type: string;
  output?: {
    type: "json" | "text";
    content: unknown;
    basis?: { citations?: { url: string }[] }[];
  };
};

export async function fetchEventGroup(monitorId: string, eventGroupId: string) {
  const data = await call<{ events: ParallelEvent[] }>(
    "GET",
    `/v1/monitors/${monitorId}/events?event_group_id=${encodeURIComponent(eventGroupId)}`,
  );
  return data.events;
}
