// Live odds for the YES side, as prices in [0,1]. bid = what you could sell YES for right now.
import type { Connection } from "@solana/web3.js";
import { config } from "./config";

export type OddsSource =
  | { kind: "kalshi"; id: string }
  | { kind: "polymarket"; id: string }
  | { kind: "pmamm"; id: string; cluster: "mainnet" | "devnet" };

export interface Odds {
  label: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  liquidityUsd: number;
  closesAt?: string;
  at: number;
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

async function getJson(url: string) {
  const { retries, timeoutMs } = config.odds;
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 404) throw Object.assign(new Error(`market not found on ${new URL(url).host}`), { final: true });
      if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
      return await r.json();
    } catch (e) {
      last = e;
      if ((e as any).final) break;
      await new Promise(r => setTimeout(r, config.odds.backoffMs * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** `conns` is only needed for on-chain sources (pm-AMM). */
export async function fetchOdds(src: OddsSource, conns?: Partial<Record<"mainnet" | "devnet", Connection>>): Promise<Odds> {
  if (src.kind === "pmamm") {
    const conn = conns?.[src.cluster];
    if (!conn) throw new Error(`no ${src.cluster} connection configured for pm-AMM`);
    const { fetchPmAmmOdds } = await import("./pmamm"); // server-side only; keeps the SDK out of the web bundle
    return fetchPmAmmOdds(conn, src.cluster, src.id);
  }
  if (src.kind === "kalshi") {
    const { market: m } = await getJson(`${config.odds.kalshiBase}/markets/${encodeURIComponent(src.id)}`);
    const bid = num(m.yes_bid_dollars);
    const ask = num(m.yes_ask_dollars);
    // Kalshi contracts pay $1; USD depth resting at the YES bid ≈ size × bid.
    const depth = (num(m.yes_bid_size_fp) ?? 0) * (bid ?? 0);
    return { label: m.title, bid, ask, last: num(m.last_price_dollars), liquidityUsd: depth, closesAt: m.close_time, at: Date.now() };
  }
  const m = await getJson(`${config.odds.polymarketBase}/markets/${encodeURIComponent(src.id)}`);
  return {
    label: m.question,
    bid: num(m.bestBid),
    ask: num(m.bestAsk),
    last: num(m.lastTradePrice),
    liquidityUsd: num(m.liquidityNum) ?? 0,
    closesAt: m.endDate,
    at: Date.now(),
  };
}

export const sourceKey = (s: OddsSource) => (s.kind === "pmamm" ? `pmamm:${s.cluster}:${s.id}` : `${s.kind}:${s.id}`);
