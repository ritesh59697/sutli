// Priority fee chosen from recent network fees. Setting it ourselves matters for pre-signed
// nonce transactions: wallets such as Phantom insert their own compute-budget instructions
// AHEAD of the advance-nonce step when a tx sets no price, which silently breaks the nonce.
import { ComputeBudgetInstruction, ComputeBudgetProgram, Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { config } from "./config";

/** Highest price (µlamports/CU) that keeps the total priority fee under the configured cap. */
export const ceilingFor = (units: number) => Math.floor((config.priorityFee.maxPriorityLamports * 1e6) / units);

export async function priorityFeeMicroLamports(conn: Connection, writable: PublicKey[], units: number): Promise<number> {
  const { percentile, multiplier, floorMicroLamports } = config.priorityFee;
  let fees: number[] = [];
  try {
    fees = (await conn.getRecentPrioritizationFees({ lockedWritableAccounts: writable })).map(f => f.prioritizationFee).filter(f => f > 0);
  } catch { /* fall back to the floor */ }
  fees.sort((a, b) => a - b);
  const pick = fees.length ? fees[Math.min(fees.length - 1, Math.floor((percentile / 100) * fees.length))] : 0;
  return Math.min(ceilingFor(units), Math.max(floorMicroLamports, Math.ceil(pick * multiplier)));
}

/** Both compute-budget instructions, so the wallet has nothing to add. */
export async function computeBudgetIxs(conn: Connection, units: number, writable: PublicKey[]): Promise<TransactionInstruction[]> {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: await priorityFeeMicroLamports(conn, writable, units) }),
  ];
}

export function describeComputeBudget(ix: TransactionInstruction): { action: string; units?: number; microLamports?: number } {
  const type = ComputeBudgetInstruction.decodeInstructionType(ix);
  if (type === "SetComputeUnitLimit") return { action: "Set compute limit", units: ComputeBudgetInstruction.decodeSetComputeUnitLimit(ix).units };
  if (type === "SetComputeUnitPrice") return { action: "Set priority fee", microLamports: Number(ComputeBudgetInstruction.decodeSetComputeUnitPrice(ix).microLamports) };
  return { action: type };
}
