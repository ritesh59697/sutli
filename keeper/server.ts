// Sutli keeper. Holds pre-signed close orders and sends one only when its trigger holds.
// It can never build or alter a transaction: it can only send the exact bytes the owner signed.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../src/core/config";
import { fetchOdds, type Odds, type OddsSource } from "../src/core/odds";
import { conditionMet, type Trigger } from "../src/core/trigger";
import { checkArmShape, describeTx, fromB64, readNonce } from "../src/core/order";
import { fetchPosition } from "../src/core/jupiter";

const RPC = process.env.MAINNET_RPC || "https://api.mainnet-beta.solana.com";
const PORT = Number(process.env.KEEPER_PORT || 8787);
const ORDERS_FILE = process.env.ORDERS_FILE || config.keeper.ordersFile;
const POLL_MS = Number(process.env.POLL_MS || config.keeper.pollMs);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const conn = new Connection(RPC, "confirmed");

type Status = "armed" | "fired" | "filled" | "blocked" | "disarmed" | "stale";
interface Order {
  id: string;
  owner: string;
  position: string;
  positionOpenTime: number; // pins the order to the position the user armed
  side: string;
  nonceAccount: string;
  nonceValue: string;
  txB64: string;
  trigger: Trigger;
  status: Status;
  holdCount: number;
  lastOdds?: Odds;
  lastCheck?: string;
  note?: string;
  fireSig?: string;
  createdAt: number;
  updatedAt: number;
}

let orders: Order[] = existsSync(ORDERS_FILE) ? JSON.parse(readFileSync(ORDERS_FILE, "utf8")) : [];
const save = () => {
  mkdirSync(dirname(ORDERS_FILE), { recursive: true });
  writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
};
const touch = (o: Order, patch: Partial<Order>) => Object.assign(o, patch, { updatedAt: Date.now() });

/** Simulate the exact signed bytes: signatures verified, blockhash (the nonce) left untouched. */
const simulateSigned = (txB64: string) =>
  conn.simulateTransaction(VersionedTransaction.deserialize(Buffer.from(txB64, "base64")), { sigVerify: true, replaceRecentBlockhash: false });

/** Preconditions + a real simulation (signature checked, no blockhash swap). A failed landing burns the nonce, so never send blind. */
async function preflight(o: Order): Promise<{ ok: boolean; reason?: string; logs?: string[] }> {
  const nonce = await readNonce(conn, new PublicKey(o.nonceAccount));
  if (!nonce || nonce.value !== o.nonceValue) return { ok: false, reason: "nonce advanced: order was disarmed or already used" };
  const pos = await fetchPosition(conn, new PublicKey(o.position));
  if (!pos) return { ok: false, reason: "position is closed" };
  if (pos.openTime !== o.positionOpenTime) return { ok: false, reason: "a different position now sits at this address (closed and reopened)" };
  const sim = await simulateSigned(o.txB64);
  if (sim.value.err) return { ok: false, reason: `simulation failed: ${JSON.stringify(sim.value.err)}`, logs: sim.value.logs ?? [] };
  return { ok: true, logs: sim.value.logs ?? [] };
}

async function fire(o: Order) {
  const pf = await preflight(o);
  if (!pf.ok) {
    const stale = pf.reason?.startsWith("nonce") ? "disarmed" : pf.reason?.includes("position") ? "stale" : "blocked";
    touch(o, { status: stale, note: pf.reason });
    return;
  }
  const sig = await conn.sendRawTransaction(Buffer.from(o.txB64, "base64"), { skipPreflight: true, maxRetries: 5 });
  touch(o, { status: "fired", fireSig: sig, note: "close request sent; waiting for Jupiter keeper fill" });
}

async function tick() {
  const cache = new Map<string, Odds | Error>();
  for (const o of orders) {
    try {
      if (o.status === "fired") {
        const pos = await fetchPosition(conn, new PublicKey(o.position));
        if (!pos || pos.openTime !== o.positionOpenTime) touch(o, { status: "filled", note: "position closed by Jupiter keeper" });
        continue;
      }
      if (o.status !== "armed") continue;
      const key = `${o.trigger.source.kind}:${o.trigger.source.id}`;
      if (!cache.has(key)) cache.set(key, await fetchOdds(o.trigger.source).catch(e => e as Error));
      const odds = cache.get(key)!;
      if (odds instanceof Error) { touch(o, { lastCheck: `odds unavailable: ${odds.message}`, holdCount: 0 }); continue; }
      const c = conditionMet(odds, o.trigger);
      const holdCount = c.met ? o.holdCount + 1 : 0;
      touch(o, { lastOdds: odds, lastCheck: c.why, holdCount });
      if (holdCount >= o.trigger.holdPolls) await fire(o);
    } catch (e) {
      touch(o, { lastCheck: `keeper error: ${(e as Error).message}` });
    }
  }
  save();
}

const app = new Hono();
app.use("*", cors({ origin: ALLOWED_ORIGIN }));

app.get("/health", c => c.json({ ok: true, orders: orders.length, pollMs: POLL_MS }));

app.get("/odds", async c => {
  const kind = c.req.query("kind") as OddsSource["kind"];
  const id = c.req.query("id") ?? "";
  if (!["kalshi", "polymarket"].includes(kind) || !id) return c.json({ error: "kind and id required" }, 400);
  try { return c.json(await fetchOdds({ kind, id } as OddsSource)); }
  catch (e) { return c.json({ error: (e as Error).message }, 502); }
});

app.get("/orders", c => {
  const owner = c.req.query("owner");
  const list = owner ? orders.filter(o => o.owner === owner) : orders;
  return c.json(list.map(({ txB64, ...rest }) => ({ ...rest, instructions: describeTx(fromB64(txB64)) })));
});

app.post("/orders", async c => {
  const b = await c.req.json<{ txB64: string; trigger: Trigger; position: string; nonceAccount: string }>();
  let tx;
  try { tx = fromB64(b.txB64); } catch { return c.json({ error: "not a transaction" }, 400); }
  if (!tx.verifySignatures(true)) return c.json({ error: "transaction is not fully signed" }, 400);
  const pos = await fetchPosition(conn, new PublicKey(b.position));
  if (!pos) return c.json({ error: "position not found or closed" }, 400);
  const shapeErr = checkArmShape(tx, { owner: pos.owner, nonceAccount: b.nonceAccount, position: b.position });
  if (shapeErr) return c.json({ error: shapeErr }, 400);
  const nonce = await readNonce(conn, new PublicKey(b.nonceAccount));
  if (!nonce || nonce.authority !== pos.owner || nonce.value !== tx.recentBlockhash)
    return c.json({ error: "nonce account missing, not owned by the position owner, or already advanced" }, 400);
  if (orders.some(o => o.nonceAccount === b.nonceAccount && o.status === "armed"))
    return c.json({ error: "each armed order needs its own nonce account" }, 400);
  const t = b.trigger;
  if (!(t.line > 0 && t.line < 1) || !["above", "below"].includes(t.direction) || !(t.holdPolls >= 1) || !(t.minLiquidityUsd >= 0))
    return c.json({ error: "invalid trigger" }, 400);
  const sim = await simulateSigned(b.txB64);
  if (sim.value.err) return c.json({ error: `close would fail today: ${JSON.stringify(sim.value.err)}`, logs: sim.value.logs }, 400);
  const o: Order = {
    id: randomUUID(), owner: pos.owner, position: b.position, positionOpenTime: pos.openTime, side: pos.side,
    nonceAccount: b.nonceAccount, nonceValue: nonce.value, txB64: b.txB64, trigger: t,
    status: "armed", holdCount: 0, createdAt: Date.now(), updatedAt: Date.now(),
  };
  orders.push(o);
  save();
  return c.json({ id: o.id, simulatedOk: true });
});

/** Dry run for anyone: simulate the stored signed bytes against mainnet right now. Sends nothing. */
app.post("/orders/:id/simulate", async c => {
  const o = orders.find(x => x.id === c.req.param("id"));
  if (!o) return c.json({ error: "not found" }, 404);
  const pf = await preflight(o);
  return c.json({ ...pf, logs: (pf.logs ?? []).slice(-15) });
});

serve({ fetch: app.fetch, port: PORT });
console.log(`sutli keeper on :${PORT}, rpc ${new URL(RPC).host}, poll ${POLL_MS}ms, ${orders.length} orders`);
setInterval(() => { tick().catch(e => console.error("tick", e)); }, POLL_MS);
