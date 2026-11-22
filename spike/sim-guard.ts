import { BN } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { buildCloseIx, fetchPosition } from "../src/core/jupiter";
import { guardMemo } from "../src/core/order";
import { config } from "../src/core/config";
const conn = new Connection(process.env.RPC_URL!, "confirmed");
const pos = (await fetchPosition(conn, new PublicKey(process.argv[2])))!;
const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: config.jupiterPerps.closeComputeUnits }),
  guardMemo(new PublicKey(config.memoProgramId), Keypair.generate().publicKey, "sutli order test"),
  await buildCloseIx(conn, pos, new BN(12345))];
const { blockhash } = await conn.getLatestBlockhash();
const msg = new TransactionMessage({ payerKey: new PublicKey(pos.owner), recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
const sim = await conn.simulateTransaction(new VersionedTransaction(msg), { sigVerify: false, replaceRecentBlockhash: true });
console.log("err:", JSON.stringify(sim.value.err), "units:", sim.value.unitsConsumed);
