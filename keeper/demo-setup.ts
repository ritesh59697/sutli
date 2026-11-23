// One-time devnet setup for the judge sandbox:
//   1. load or create the demo keypair (keys/, gitignored)
//   2. top up pm-AMM test USDC from the protocol's devnet faucet
//   3. create our own pm-AMM market ("SOL above $X at <deadline>?") seeded with liquidity
// Devnet SOL for fees must already be in the demo wallet (the public faucet needs a captcha).
import { AnchorProvider, Wallet } from "@anchor-lang/core";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { PmAmmClient } from "@pm-amm/sdk";
import { config } from "../src/core/config";
import { loadDemoKeypair, readDemoState, writeDemoState, DEMO_KEYPAIR_PATH } from "./demo-wallet";

const rpc = process.env.DEVNET_RPC;
if (!rpc) throw new Error("DEVNET_RPC not set");
const conn = new Connection(rpc, "confirmed");
const kp = loadDemoKeypair(true);
console.log("demo wallet", kp.publicKey.toBase58(), "(", DEMO_KEYPAIR_PATH, ")");

const sol = await conn.getBalance(kp.publicKey);
console.log("devnet SOL", sol / LAMPORTS_PER_SOL);
if (sol < config.demo.minSolLamports) {
  console.log(`Needs at least ${config.demo.minSolLamports / LAMPORTS_PER_SOL} devnet SOL for fees and market rent. Send some, then re-run.`);
  process.exit(2);
}

const existing = readDemoState();
if (existing) { console.log("demo market already exists:", existing.market, existing.name); process.exit(0); }

const r = await fetch(config.demo.faucetUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: kp.publicKey.toBase58() }) });
console.log("faucet", r.status, (await r.text()).slice(0, 160));

const px = await (await fetch(`${config.demo.priceApi}?ids=${config.demo.underlyingMint}`)).json();
const price = Number(px[config.demo.underlyingMint]?.usdPrice);
if (!(price > 0)) throw new Error("could not fetch underlying price");
const strike = Math.round(price);
const end = new Date(config.demo.marketEndIso);
const name = `Sutli demo: ${config.demo.underlyingLabel} above $${strike} at ${end.toISOString().slice(5, 16).replace("T", " ")} UTC?`;
if (Buffer.byteLength(name) > 64) throw new Error(`market name too long: ${name}`);

const provider = new AnchorProvider(conn as any, new Wallet(kp), { commitment: "confirmed" });
const client = PmAmmClient.fromProvider(provider, new PublicKey(config.pmAmm.programId), new PublicKey(config.pmAmm.collateralMint.devnet));
const durationSecs = Math.floor((end.getTime() - Date.now()) / 1000);
const out = await client.send.createMarket({ name, durationSecs, initialPriceBps: config.demo.initialPriceBps, depositUsdc: config.demo.seedLiquidityUsdc });
writeDemoState({ market: out.marketPda, createdSig: out.signature, name, line: config.demo.line, createdAt: Date.now() });
console.log("created", out.marketPda, "tx", out.signature, "\n", name);
