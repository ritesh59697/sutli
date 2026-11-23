import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { config } from "../../src/core/config";
import { env } from "./env";

export const mainnet = new Connection(env.mainnetRpc, "confirmed");
export const devnet = new Connection(env.devnetRpc, "confirmed");

const labels = config.mintLabels as Record<string, string>;
export const short = (k: string, n = 4) => `${k.slice(0, n)}…${k.slice(-n)}`;
/** Shorten only things that look like addresses; leave values such as "400000 units" intact. */
export const detailText = (d: string) => (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(d) ? short(d) : d);
export const mintLabel =(mint: string) => labels[mint] ?? short(mint);
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
  const sentHash = tx.recentBlockhash;
  const signed = await signTransaction(tx);
  if (signed.recentBlockhash !== sentHash)
    throw new Error(`The wallet replaced the blockhash (sent ${sentHash?.slice(0, 8)}…, got back ${signed.recentBlockhash?.slice(0, 8)}…). Check the wallet is on the same network as this page.`);
  if (extraSigners.length) signed.partialSign(...extraSigners);
  // Public RPCs load-balance across nodes that can lag; their preflight sometimes reports
  // "Blockhash not found" for a valid hash. Skip it and rely on confirmation for the real result.
  const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 5 });
  await waitForSignature(conn, sig);
  return sig;
}

/** Poll over HTTP instead of a websocket subscription: free RPCs cap open connections. */
export async function waitForSignature(conn: Connection, sig: string, timeoutMs = config.rpc.confirmTimeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await conn.getSignatureStatuses([sig]).catch(() => ({ value: [null] }));
    const s = value[0];
    if (s?.err) throw new Error(`transaction failed: ${JSON.stringify(s.err)}`);
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return;
    await new Promise(r => setTimeout(r, config.rpc.confirmPollMs));
  }
  throw new Error(`not confirmed within ${Math.round(timeoutMs / 1000)}s: ${sig}`);
}

export const errMsg = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  if (/blockhash not found|block height exceeded/i.test(m))
    return "The approval took longer than a Solana transaction stays valid (about a minute). Nothing was sent. Click again and approve promptly.";
  if (/user rejected/i.test(m)) return "You rejected the request in your wallet. Nothing was sent.";
  return m;
};
