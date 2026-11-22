// pm-AMM (PREDICT, Paradigm's pm-AMM on Solana) as an odds source.
// Curve math follows the protocol's reference helper (predict-pm-amm.dev/helpers/pm-amm-helpers.ts):
// reserves are stored as of lastAccrualTs and must be rescaled to now (L_eff = L_0·√(T−t))
// before pricing, or quotes run a few % rich.
import { Connection, PublicKey } from "@solana/web3.js";
import { PmAmmClient, type MarketAccount, type SwapDirection } from "@pm-amm/sdk";
import { capitalPhi, i80f48ToNumber, phi, poolValue } from "@pm-amm/sdk/math";
import { getMint } from "@solana/spl-token";
import { config } from "./config";

export type Cluster = "mainnet" | "devnet";
const cfg = config.pmAmm;
const decimalsCache = new Map<string, number>();
async function collateralUnit(conn: Connection, mint: PublicKey) {
  const k = mint.toBase58();
  if (!decimalsCache.has(k)) decimalsCache.set(k, (await getMint(conn, mint)).decimals);
  return 10 ** decimalsCache.get(k)!;
}

export interface PmAmmState { x: number; y: number; lEff: number; price: number; secondsLeft: number; resolved: boolean; winner: "yes" | "no" | null }

export function marketState(m: MarketAccount, now = Math.floor(Date.now() / 1000)): PmAmmState {
  const endTs = m.endTs.toNumber();
  const lZero = i80f48ToNumber(m.lZero);
  const lEff = lZero * Math.sqrt(Math.max(endTs - now, 1));
  const lLast = lZero * Math.sqrt(Math.max(endTs - m.lastAccrualTs.toNumber(), 1));
  const scale = lLast > 0 ? lEff / lLast : 0;
  const x = i80f48ToNumber(m.reserveYes) * scale;
  const y = i80f48ToNumber(m.reserveNo) * scale;
  const winner = m.winningSide === 1 ? "yes" : m.winningSide === 2 ? "no" : null;
  const price = winner ? (winner === "yes" ? 1 : 0) : lEff > 0 ? capitalPhi((y - x) / lEff) : 0.5;
  return { x, y, lEff, price, secondsLeft: Math.max(endTs - now, 0), resolved: m.resolved, winner };
}

// The curve: x = L(uΦ(u)+φ(u)−u), y = L(uΦ(u)+φ(u)), u = (y−x)/L
const base = (u: number) => u * capitalPhi(u) + phi(u);
function solveU(f: (u: number) => number, target: number, increasing: boolean) {
  let lo = -40, hi = 40;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (increasing ? f(mid) < target : f(mid) > target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
const xFromY = (y: number, L: number) => y - L * solveU(base, y / L, true);

function curveOut(s: PmAmmState, dir: SwapDirection, dIn: number): number {
  const { x, y, lEff: L } = s;
  const clampZ = (z: number) => Math.max(-cfg.zClamp, Math.min(cfg.zClamp, z));
  if (dir === "usdcToYes") return dIn + (x - xFromY(y + dIn, L));
  if (dir === "yesToUsdc") return y - L * base(clampZ((y - x - dIn) / L));
  throw new Error(`direction ${dir} not used by Sutli`);
}

/** Net output in raw units for a swap, fee included (fee is on the USDC leg). */
export function quote(s: PmAmmState, dir: "usdcToYes" | "yesToUsdc", amountIn: number) {
  const feeIn = dir === "usdcToYes" ? Math.floor((amountIn * cfg.swapFeeBps) / 10_000) : 0;
  const gross = Math.max(Math.floor(curveOut(s, dir, amountIn - feeIn)), 0);
  const feeOut = dir === "yesToUsdc" ? Math.floor((gross * cfg.swapFeeBps) / 10_000) : 0;
  return gross - feeOut;
}

const clients = new Map<Cluster, PmAmmClient>();
function client(conn: Connection, cluster: Cluster) {
  if (!clients.has(cluster))
    clients.set(cluster, PmAmmClient.readOnly(conn, new PublicKey(cfg.programId), new PublicKey(cfg.collateralMint[cluster])));
  return clients.get(cluster)!;
}

/**
 * YES odds a trader could actually get for a probe-sized trade:
 * bid = USDC per YES when selling, ask = USDC per YES when buying. Both include the fee.
 * Depth = pool value V = L_eff·φ(Φ⁻¹(P)) in USDC: what it costs to move the price materially.
 */
export async function fetchPmAmmOdds(conn: Connection, cluster: Cluster, market: string) {
  const m = await client(conn, cluster).fetchMarket(new PublicKey(market));
  if (!m) throw Object.assign(new Error("pm-AMM market not found on " + cluster), { final: true });
  const RAW = await collateralUnit(conn, m.collateralMint);
  const s = marketState(m);
  const label = Buffer.from(m.name).toString("utf8").replace(/\0+$/, "").trim() || market;
  const closesAt = new Date(m.endTs.toNumber() * 1000).toISOString();
  if (s.resolved || s.secondsLeft === 0)
    return { label, bid: s.winner ? s.price : null, ask: s.winner ? s.price : null, last: s.price, liquidityUsd: 0, closesAt, at: Date.now() };
  const probe = Math.round(cfg.probeUsd * RAW);
  const yesBought = quote(s, "usdcToYes", probe);
  const yesToSell = Math.max(Math.round(probe / Math.max(s.price, 1e-6)), 1);
  const usdcBack = quote(s, "yesToUsdc", yesToSell);
  return {
    label,
    bid: usdcBack / yesToSell,
    ask: yesBought > 0 ? probe / yesBought : null,
    last: s.price,
    liquidityUsd: poolValue(s.price, s.lEff) / RAW,
    closesAt,
    at: Date.now(),
  };
}
