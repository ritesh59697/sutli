// Mainnet simulation of the on-chain pin: right openTime must pass, a stale one must fail.
import { BN } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Connection, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { buildCloseIx, fetchPosition } from "../src/core/jupiter";
import { assertI64EqualIx, locateI64 } from "../src/core/guard";
import { config } from "../src/core/config";

const conn = new Connection(process.env.RPC_URL!, "confirmed");
const address = new PublicKey(process.argv[2]);
const pos = (await fetchPosition(conn, address))!;
const data = (await conn.getAccountInfo(address))!.data;
const openTime = BigInt(pos.openTime);
const offset = locateI64(data, openTime);
console.log("openTime", pos.openTime, "found at offset", offset);

async function sim(label: string, value: bigint) {
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: config.jupiterPerps.closeComputeUnits }),
    assertI64EqualIx(address, offset, value),
    await buildCloseIx(conn, pos, new BN(777)),
  ];
  const { blockhash } = await conn.getLatestBlockhash();
  const msg = new TransactionMessage({ payerKey: new PublicKey(pos.owner), recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  const r = await conn.simulateTransaction(new VersionedTransaction(msg), { sigVerify: false, replaceRecentBlockhash: true });
  const lh = (r.value.logs ?? []).filter(l => l.includes(config.lighthouseProgramId) || /assert|Lighthouse/i.test(l)).slice(0, 4);
  console.log(`${label}: err=${JSON.stringify(r.value.err)}`, lh.join(" | "));
}
await sim("same position (should pass)", openTime);
await sim("reopened position (should fail)", openTime + 1n);
