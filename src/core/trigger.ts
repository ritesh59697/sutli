import type { Odds, OddsSource } from "./odds";

export interface Trigger {
  source: OddsSource;
  direction: "above" | "below"; // fire when YES rises above / falls below the line
  line: number; // 0..1
  holdPolls: number; // condition must hold this many polls in a row
  minLiquidityUsd: number; // ignore thin books that a few dollars could move
}

/** Uses the executable side of the book, never the last trade. */
export function conditionMet(o: Odds, t: Trigger): { met: boolean; why: string } {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  if (o.liquidityUsd < t.minLiquidityUsd)
    return { met: false, why: `depth $${o.liquidityUsd.toFixed(0)} is below the $${t.minLiquidityUsd} floor` };
  if (t.direction === "above") {
    if (o.bid === null) return { met: false, why: "no YES bid" };
    return { met: o.bid >= t.line, why: `YES bid ${pct(o.bid)} vs line ${pct(t.line)}` };
  }
  if (o.ask === null) return { met: false, why: "no YES ask" };
  return { met: o.ask <= t.line, why: `YES ask ${pct(o.ask)} vs line ${pct(t.line)}` };
}
