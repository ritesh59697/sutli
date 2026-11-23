// Devnet-only demo wallet the keeper uses for the judge sandbox (creates the demo market, pushes odds).
// Holds free devnet SOL and pm-AMM test USDC; never used on mainnet.
import { Keypair } from "@solana/web3.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../src/core/config";

export const DEMO_KEYPAIR_PATH = process.env.DEMO_KEYPAIR || config.demo.keypairPath;
export const DEMO_STATE_PATH = process.env.DEMO_STATE || config.demo.statePath;

export function loadDemoKeypair(createIfMissing = false): Keypair {
  if (!existsSync(DEMO_KEYPAIR_PATH)) {
    if (!createIfMissing) throw new Error(`demo keypair missing at ${DEMO_KEYPAIR_PATH}; run npm run demo:setup`);
    const kp = Keypair.generate();
    mkdirSync(dirname(DEMO_KEYPAIR_PATH), { recursive: true });
    writeFileSync(DEMO_KEYPAIR_PATH, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
    return kp;
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(DEMO_KEYPAIR_PATH, "utf8"))));
}

export interface DemoState { market: string; createdSig: string; name: string; line: number; createdAt: number }
export const readDemoState = (): DemoState | null => (existsSync(DEMO_STATE_PATH) ? JSON.parse(readFileSync(DEMO_STATE_PATH, "utf8")) : null);
export function writeDemoState(s: DemoState) {
  mkdirSync(dirname(DEMO_STATE_PATH), { recursive: true });
  writeFileSync(DEMO_STATE_PATH, JSON.stringify(s, null, 2));
}
