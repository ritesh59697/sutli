import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { config } from "../../src/core/config";
import { env } from "./env";

export const mainnet = new Connection(env.mainnetRpc, "confirmed");
export const devnet = new Connection(env.devnetRpc, "confirmed");

const labels = config.mintLabels as Record<string, string>;
export const short = (k: string, n = 4) => `${k.slice(0, n)}…${k.slice(-n)}`;
export const mintLabel = (mint: string) => labels[mint] ?? short(mint);
export const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
export const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(1)}%`);
export const txLink = (sig: string, cluster: "mainnet" | "devnet" = "mainnet") =>
  `${config.explorer}/tx/${sig}${cluster === "devnet" ? "?cluster=devnet" : ""}`;
export const accountLink = (addr: string, cluster: "mainnet" | "devnet" = "mainnet") =>
  `${config.explorer}/account/${addr}${cluster === "devnet" ? "?cluster=devnet" : ""}`;

export async function keeper<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${env.keeperUrl}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as any).error ?? `keeper returned ${r.status}`);
  return body as T;
}

/** Sign with the wallet, then send through our own connection so the cluster is ours to choose. */
export async function signAndSend(
  conn: Connection,
  tx: Transaction,
  signTransaction: (t: Transaction) => Promise<Transaction>,
  extraSigners: { publicKey: PublicKey; secretKey: Uint8Array }[] = [],
) {
  const signed = await signTransaction(tx);
  if (extraSigners.length) signed.partialSign(...extraSigners);
  const sig = await conn.sendRawTransaction(signed.serialize());
  const res = await conn.confirmTransaction(
    { signature: sig, blockhash: tx.recentBlockhash!, lastValidBlockHeight: tx.lastValidBlockHeight! },
    "confirmed",
  );
  if (res.value.err) throw new Error(`transaction failed: ${JSON.stringify(res.value.err)}`);
  return sig;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
