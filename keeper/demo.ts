// Judge sandbox. No wallet needed, nothing is sent on mainnet.
//  - odds: our own pm-AMM market on devnet (real trades by the keeper's devnet demo wallet)
//  - position: a real, currently open Jupiter Perps position on mainnet, read-only
//  - dry run: Sutli builds the exact close it would sign (compute limit, guard, Lighthouse pin, Jupiter close)
//    and simulates it on mainnet. The advance-nonce step is left out because the position is someone else's.
import { AnchorProvider, Wallet } from "@anchor-lang/core";
import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PmAmmClient } from "@pm-amm/sdk";
import { config } from "../src/core/config";
import { buildCloseIx, fetchPosition, findLivePosition, type PositionView } from "../src/core/jupiter";
import { assertI64EqualIx, locateI64 } from "../src/core/guard";
import { computeBudgetIxs } from "../src/core/fees";
import { describeTx, guardMemo } from "../src/core/order";
import { buyToReach, fetchPmAmmOdds, marketState, quote } from "../src/core/pmamm";
import { conditionMet, type Trigger } from "../src/core/trigger";
import { loadDemoKeypair, readDemoState } from "./demo-wallet";
import { Transaction } from "@solana/web3.js";

export function createDemo(mainnet: Connection, devnet: Connection | undefined) {
  let samplePos: { pos: PositionView; at: number } | null = null;
  let lastPush = 0;
  let lastDryRun: unknown = null;

  const state = () => {
    const s = readDemoState();
    if (!s || !devnet) return null;
    return s;
  };
  const trigger = (market: string, line: number): Trigger => ({
    source: { kind: "pmamm", id: market, cluster: "devnet" }, direction: "above", line,
    // The demo market is small on purpose; its floor is set separately and shown in the UI.
    holdPolls: 1, minLiquidityUsd: config.demo.minLiquidityUsd,
  });

  async function position(): Promise<PositionView | null> {
    if (samplePos && Date.now() - samplePos.at < config.demoSandbox.positionTtlMs) {
      const still = await fetchPosition(mainnet, new PublicKey(samplePos.pos.address));
      if (still && still.openTime === samplePos.pos.openTime) return samplePos.pos;
    }
    const pos = await findLivePosition(mainnet, { signatures: config.demoSandbox.scanSignatures, preferSide: "long" });
    samplePos = pos ? { pos, at: Date.now() } : null;
    return pos;
  }

  async function snapshot() {
    const s = state();
    if (!s) return { ready: false as const, reason: "demo market not set up (npm run demo:setup)" };
    const odds = await fetchPmAmmOdds(devnet!, "devnet", s.market);
    const t = trigger(s.market, s.line);
    return { ready: true as const, market: s.market, name: s.name, line: s.line, odds, condition: conditionMet(odds, t), position: await position(), lastDryRun };
  }

  function pmClient() {
    const kp = loadDemoKeypair();
    const provider = new AnchorProvider(devnet as any, new Wallet(kp), { commitment: "confirmed" });
    return { kp, client: PmAmmClient.fromProvider(provider, new PublicKey(config.pmAmm.programId), new PublicKey(config.pmAmm.collateralMint.devnet)) };
  }

  /** Real devnet trade on our pm-AMM market: "up" buys YES, "down" sells the YES the demo wallet holds. */
  async function push(dir: "up" | "down") {
    const s = state();
    if (!s) throw new Error("demo market not set up");
    const wait = lastPush + config.demo.pushCooldownMs - Date.now();
    if (wait > 0) throw Object.assign(new Error(`please wait ${Math.ceil(wait / 1000)}s between pushes`), { status: 429 });
    lastPush = Date.now();
    const { kp, client } = pmClient();
    const marketPk = new PublicKey(s.market);
    const m = await client.fetchMarket(marketPk);
    if (!m) throw new Error("demo market missing");
    const st = marketState(m);
    const unit = 10 ** (await devnet!.getTokenAccountBalance(getAssociatedTokenAddressSync(m.collateralMint, kp.publicKey)).then(b => b.value.decimals));
    const slip = (n: number) => Math.floor(n * (1 - config.demoSandbox.slippageBps / 10_000));
    let sig: string;
    if (dir === "up") {
      // Buy just enough YES to lift the price past the line (plus a margin), capped by config.
      const target = Math.min(s.line + config.demo.pushMargin, config.demo.pushMaxPrice);
      const amount = Math.max(buyToReach(st, target, Math.round(config.demo.pushMaxUsdc * unit)), Math.round(config.demo.pushMinUsdc * unit));
      sig = await client.send.swap(marketPk, "usdcToYes", amount, slip(quote(st, "usdcToYes", amount)));
    } else {
      const bal = await devnet!.getTokenAccountBalance(getAssociatedTokenAddressSync(m.yesMint, kp.publicKey)).catch(() => null);
      const yes = Number(bal?.value.amount ?? 0);
      if (yes <= 0) throw new Error("nothing to sell: odds are already at the demo's starting point");
      sig = await client.send.swap(marketPk, "yesToUsdc", yes, slip(quote(st, "yesToUsdc", yes)));
    }
    return { sig, after: await snapshot() };
  }

  /** Build the exact close Sutli would pre-sign for the sample position and simulate it on mainnet. */
  async function dryRun() {
    const snap = await snapshot();
    if (!snap.ready) throw new Error(snap.reason);
    const pos = snap.position;
    if (!pos) throw new Error("no open Jupiter position found to demo against; try again shortly");
    const address = new PublicKey(pos.address);
    const acct = await mainnet.getAccountInfo(address);
    if (!acct) throw new Error("position account vanished");
    const openTime = BigInt(pos.openTime);
    const counter = new BN(Math.floor(Math.random() * 2 ** 40));
    const ixs = [
      ...(await computeBudgetIxs(mainnet, config.jupiterPerps.closeComputeUnits, [address, new PublicKey(config.jupiterPerps.pool)])),
      guardMemo(new PublicKey(config.memoProgramId), Keypair.generate().publicKey, `sutli demo ${counter.toString()}`),
      assertI64EqualIx(address, locateI64(acct.data, openTime), openTime),
      await buildCloseIx(mainnet, pos, counter),
    ];
    const { blockhash } = await mainnet.getLatestBlockhash();
    const msg = new TransactionMessage({ payerKey: new PublicKey(pos.owner), recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
    const sim = await mainnet.simulateTransaction(new VersionedTransaction(msg), { sigVerify: false, replaceRecentBlockhash: true });
    const logs = sim.value.logs ?? [];
    const legacy = new Transaction({ feePayer: new PublicKey(pos.owner), recentBlockhash: blockhash }).add(...ixs);
    lastDryRun = {
      at: Date.now(),
      fired: snap.condition.met,
      why: snap.condition.why,
      position: pos.address,
      ok: sim.value.err === null,
      err: sim.value.err,
      unitsConsumed: sim.value.unitsConsumed,
      instructions: describeTx(legacy),
      logs: logs.filter(l => /Program (PERPH|L2TEx)|Check permissions|Validate inputs|success|failed/.test(l)).slice(-10),
    };
    return lastDryRun;
  }

  return { snapshot, push, dryRun };
}
