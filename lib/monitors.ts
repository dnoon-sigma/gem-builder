// Monitoring cadence.
//  - Normally each team's monitor checks once a day.
//  - In the 36 hours before a team's kickoff it checks more often.
//
// Frequencies can only change when our sync job runs (daily on Vercel's free
// plan), so the window is opened one sync interval early. That guarantees the
// full 36 hours before kickoff is covered at the faster pace, at the cost of up
// to a day of extra fast checks.
export const BASE_FREQUENCY = "1d";
export const FAST_FREQUENCY = process.env.PARALLEL_FAST_FREQUENCY ?? "3h";
export const WINDOW_HOURS = 36;
export const SYNC_INTERVAL_HOURS = 24;

export function desiredFrequency(nextKickoff: Date | undefined, now = new Date()): string {
  if (!nextKickoff) return BASE_FREQUENCY;
  const hours = (nextKickoff.getTime() - now.getTime()) / 36e5;
  return hours > 0 && hours <= WINDOW_HOURS + SYNC_INTERVAL_HOURS
    ? FAST_FREQUENCY
    : BASE_FREQUENCY;
}

export const monitorQuery = (teamName: string) =>
  `Credible, recent reports on injuries and lineup changes for the ${teamName}: ` +
  `game-day designations (Questionable, Doubtful, Out, Injured Reserve), practice participation, ` +
  `and any change to who is starting or replacing an injured player. ` +
  `Report one event per player whose status changed.`;
