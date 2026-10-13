import type { Matchup } from "@/lib/espn";

// A game is "lopsided" when the market gives the favorite at least this chance
// of winning (roughly a -360 moneyline favorite, after removing the vig).
export const LOPSIDED_THRESHOLD = 0.75;

const parseMl = (ml?: string) => {
  if (!ml) return undefined;
  const n = Number(ml.replace("+", ""));
  return Number.isFinite(n) && n !== 0 ? n : undefined;
};

const impliedProb = (ml: number) => (ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100));

export type WinProb = { away: number; home: number };

// Moneyline -> win probability for each side, with the bookmaker margin
// removed so the two sides add to 100%.
export function winProb(g: Matchup): WinProb | undefined {
  const a = parseMl(g.away.moneyline);
  const h = parseMl(g.home.moneyline);
  if (a === undefined || h === undefined) return undefined;
  const pa = impliedProb(a);
  const ph = impliedProb(h);
  return { away: pa / (pa + ph), home: ph / (pa + ph) };
}

export function lopsided(g: Matchup, p = winProb(g)) {
  if (!p) return undefined;
  const awayFav = p.away >= p.home;
  const prob = awayFav ? p.away : p.home;
  if (prob < LOPSIDED_THRESHOLD) return undefined;
  return { team: awayFav ? g.away.abbr : g.home.abbr, prob };
}
