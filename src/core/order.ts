// Arm order = one legacy transaction:
// [advance nonce, compute budget, guard memo (co-signer), pin position openTime (Lighthouse), Jupiter close].
// The wallet signs it once; it is never broadcast until the trigger fires.
import { BN, BorshInstructionCoder } from "@coral-xyz/anchor";
import { IDL } from "./jupiter-idl";
import {
  ComputeBudgetProgram, Connection, Keypair, NONCE_ACCOUNT_LENGTH, NonceAccount, PublicKey,
  SystemInstruction, SystemProgram, Transaction, TransactionInstruction,
} from "@solana/web3.js";
import { PERPS_PROGRAM_ID, config } from "./config";
import { buildCloseIx, POSITION_OPEN_TIME_OFFSET, type PositionView } from "./jupiter";
import { assertI64EqualIx, decodeAssertI64, locateI64 } from "./guard";
import { computeBudgetIxs, describeComputeBudget } from "./fees";

export async function buildCreateNonceTx(conn: Connection, owner: PublicKey) {
  const nonce = Keypair.generate();
  const rent = await conn.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight }).add(
    SystemProgram.createAccount({ fromPubkey: owner, newAccountPubkey: nonce.publicKey, lamports: rent, space: NONCE_ACCOUNT_LENGTH, programId: SystemProgram.programId }),
    SystemProgram.nonceInitialize({ noncePubkey: nonce.publicKey, authorizedPubkey: owner }),
  );
  return { tx, nonce, rentLamports: rent };
}

export async function readNonce(conn: Connection, nonceAccount: PublicKey): Promise<{ value: string; authority: string } | null> {
  const info = await conn.getAccountInfo(nonceAccount);
  if (!info || info.data.length !== NONCE_ACCOUNT_LENGTH) return null;
  const n = NonceAccount.fromAccountData(info.data);
  return { value: n.nonce, authority: n.authorizedPubkey.toBase58() };
}

export function buildPinnedTx(owner: PublicKey, nonceAccount: PublicKey, nonceValue: string, body: TransactionInstruction[]) {
  return new Transaction({ feePayer: owner, nonceInfo: {
    nonce: nonceValue,
    nonceInstruction: SystemProgram.nonceAdvance({ noncePubkey: nonceAccount, authorizedPubkey: owner }),
  } }).add(...body);
}

export async function buildArmTx(conn: Connection, pos: PositionView, nonceAccount: PublicKey, nonceValue: string) {
  const counter = new BN(Math.floor(Math.random() * 2 ** 40));
  const close = await buildCloseIx(conn, pos, counter);
  const position = new PublicKey(pos.address);
  const acct = await conn.getAccountInfo(position);
  if (!acct) throw new Error("position account not found");
  const openTime = BigInt(pos.openTime);
  // A throwaway guard key signs first, so a wallet that edits transactions (Phantom did once) cannot.
  const guard = Keypair.generate();
  const tx = buildPinnedTx(new PublicKey(pos.owner), nonceAccount, nonceValue, [
    ...(await computeBudgetIxs(conn, config.jupiterPerps.closeComputeUnits, [position, new PublicKey(config.jupiterPerps.pool)])),
    guardMemo(new PublicKey(config.memoProgramId), guard.publicKey, `sutli order ${counter.toString()}`),
    assertI64EqualIx(position, locateI64(acct.data, openTime, POSITION_OPEN_TIME_OFFSET), openTime), // fails if the position was closed and reopened
    close,
  ]);
  tx.partialSign(guard);
  return tx;
}

/** Disarm = advance the nonce. The stored signed bytes can never land after this. */
export async function buildDisarmTx(conn: Connection, owner: PublicKey, nonceAccount: PublicKey) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  return new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight })
    .add(SystemProgram.nonceAdvance({ noncePubkey: nonceAccount, authorizedPubkey: owner }));
}

/** Plain-language list of differences between what we built and what the wallet signed. */
export function diffTx(expected: Transaction, signed: Transaction): string[] {
  const a = compiled(expected), b = compiled(signed);
  const out: string[] = [];
  if (a.recentBlockhash !== b.recentBlockhash) out.push(`blockhash ${a.recentBlockhash?.slice(0, 8)}… → ${b.recentBlockhash?.slice(0, 8)}…`);
  if (!a.feePayer?.equals(b.feePayer!)) out.push(`fee payer changed to ${b.feePayer?.toBase58()}`);
  const label = (ix: TransactionInstruction) => `${ix.programId.toBase58().slice(0, 8)}… (${ix.data.length}B, ${ix.keys.length} accounts)`;
  const n = Math.max(a.instructions.length, b.instructions.length);
  for (let i = 0; i < n; i++) {
    const x = a.instructions[i], y = b.instructions[i];
    if (!x) out.push(`added #${i}: ${label(y)}`);
    else if (!y) out.push(`removed #${i}: ${label(x)}`);
    else if (!x.programId.equals(y.programId) || !x.data.equals(y.data) || x.keys.length !== y.keys.length) out.push(`changed #${i}: ${label(x)} → ${label(y)}`);
  }
  return out.length ? out : ["same instructions and blockhash; only account ordering or header differs"];
}

/** A throwaway key that signs first. Wallets such as Phantom leave an already co-signed transaction unmodified. */
export function guardMemo(memoProgramId: PublicKey, guard: PublicKey, text: string) {
  return new TransactionInstruction({ programId: memoProgramId, keys: [{ pubkey: guard, isSigner: true, isWritable: false }], data: Buffer.from(text) });
}

/** The wallet must hand back exactly the message we built, with a valid signature. */
export function verifySigned(expected: Transaction, signed: Transaction): { ok: boolean; reason?: string } {
  const a = expected.serializeMessage(), b = signed.serializeMessage();
  if (!a.equals(b)) return { ok: false, reason: "The wallet changed the transaction before signing it." };
  if (!signed.verifySignatures(true)) return { ok: false, reason: "Signature missing or invalid." };
  return { ok: true };
}

const perpsCoder = new BorshInstructionCoder(IDL);

/** Strict shape check used by the keeper before it stores an order. */
export function checkArmShape(
  tx: Transaction,
  expect: { owner: string; nonceAccount: string; position: string; openTime: number },
): string | null {
  tx = compiled(tx);
  const d = describeTx(tx);
  if (d.length !== 6) return "Arm transaction must have exactly 6 instructions.";
  if (d[0].action !== "Advance nonce" || d[0].detail !== expect.nonceAccount) return "First instruction must advance this order's nonce.";
  const limit = describeComputeBudget(tx.instructions[1]), price = describeComputeBudget(tx.instructions[2]);
  if (d[1].program !== "Compute budget" || limit.action !== "Set compute limit") return "Second instruction must be the compute limit.";
  if (d[2].program !== "Compute budget" || price.action !== "Set priority fee") return "Third instruction must be the priority fee.";
  if ((price.microLamports! * limit.units!) / 1e6 > config.priorityFee.maxPriorityLamports) return "Priority fee is above the configured cap.";
  if (d[3].action !== "Guard signature") return "Fourth instruction must be the guard memo.";
  const pin = decodeAssertI64(tx.instructions[4]);
  if (!pin || pin.target !== expect.position || pin.value !== BigInt(expect.openTime) || pin.offset !== POSITION_OPEN_TIME_OFFSET)
    return "Fifth instruction must pin this exact position (its openTime).";
  if (d[5].action !== "Close entire position (market)" || d[5].detail !== expect.position) return "Sixth instruction must close the armed position.";
  if (tx.feePayer?.toBase58() !== expect.owner) return "Fee payer must be the position owner.";
  if (tx.instructions[5].keys[0].pubkey.toBase58() !== expect.owner) return "Close request owner mismatch.";
  return null;
}

export interface DecodedIx { program: string; action: string; detail?: string }
/** Human-readable list of what a signed arm tx can do. Unknown instructions are shown as unknown. */
/** The instructions exactly as signed: a nonce tx only gains its advance-nonce instruction at compile time. */
const compiled = (tx: Transaction) => Transaction.populate(tx.compileMessage());

export function describeTx(tx: Transaction): DecodedIx[] {
  return compiled(tx).instructions.map((ix): DecodedIx => {
    if (ix.programId.equals(SystemProgram.programId)) {
      const type = SystemInstruction.decodeInstructionType(ix);
      if (type === "AdvanceNonceAccount") {
        const d = SystemInstruction.decodeNonceAdvance(ix);
        return { program: "System", action: "Advance nonce", detail: d.noncePubkey.toBase58() };
      }
      return { program: "System", action: type };
    }
    if (ix.programId.equals(ComputeBudgetProgram.programId)) {
      const cb = describeComputeBudget(ix);
      const detail = cb.units !== undefined ? `${cb.units} units` : cb.microLamports !== undefined ? `${cb.microLamports} µlamports/unit` : undefined;
      return { program: "Compute budget", action: cb.action, detail };
    }
    const pin = decodeAssertI64(ix);
    if (pin) return { program: "Lighthouse", action: `Only if position still opened at ${new Date(Number(pin.value) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`, detail: pin.target };
    if (ix.programId.equals(new PublicKey(config.memoProgramId)) && ix.keys.length === 1 && ix.keys[0].isSigner)
      return { program: "Memo", action: "Guard signature", detail: ix.keys[0].pubkey.toBase58() };
    if (ix.programId.equals(PERPS_PROGRAM_ID)) {
      const d = perpsCoder.decode(ix.data);
      if (d?.name === "createDecreasePositionMarketRequest" && (d.data as any).params?.entirePosition)
        return { program: "Jupiter Perps", action: "Close entire position (market)", detail: ix.keys[4]?.pubkey.toBase58() };
      return { program: "Jupiter Perps", action: `Unexpected: ${d?.name ?? "undecodable"}` };
    }
    return { program: ix.programId.toBase58(), action: "Unknown instruction" };
  });
}

export const toB64 = (tx: Transaction) => Buffer.from(tx.serialize({ requireAllSignatures: true, verifySignatures: true })).toString("base64");
export const fromB64 = (s: string) => Transaction.from(Buffer.from(s, "base64"));
