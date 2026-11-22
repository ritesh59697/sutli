// Arm order = one legacy transaction: [advance nonce, compute budget, Jupiter close].
// The wallet signs it once; it is never broadcast until the trigger fires.
import { BN, BorshInstructionCoder } from "@coral-xyz/anchor";
import { IDL } from "./jupiter-idl";
import {
  ComputeBudgetProgram, Connection, Keypair, NONCE_ACCOUNT_LENGTH, NonceAccount, PublicKey,
  SystemInstruction, SystemProgram, Transaction, TransactionInstruction,
} from "@solana/web3.js";
import { PERPS_PROGRAM_ID, config } from "./config";
import { buildCloseIx, type PositionView } from "./jupiter";

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
  return buildPinnedTx(new PublicKey(pos.owner), nonceAccount, nonceValue, [
    ComputeBudgetProgram.setComputeUnitLimit({ units: config.jupiterPerps.closeComputeUnits }), close,
  ]);
}

/** Disarm = advance the nonce. The stored signed bytes can never land after this. */
export async function buildDisarmTx(conn: Connection, owner: PublicKey, nonceAccount: PublicKey) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  return new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight })
    .add(SystemProgram.nonceAdvance({ noncePubkey: nonceAccount, authorizedPubkey: owner }));
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
export function checkArmShape(tx: Transaction, expect: { owner: string; nonceAccount: string; position: string }): string | null {
  tx = compiled(tx);
  const d = describeTx(tx);
  if (d.length !== 3) return "Arm transaction must have exactly 3 instructions.";
  if (d[0].action !== "Advance nonce" || d[0].detail !== expect.nonceAccount) return "First instruction must advance this order's nonce.";
  if (d[1].program !== "Compute budget") return "Second instruction must be the compute limit.";
  if (d[2].action !== "Close entire position (market)" || d[2].detail !== expect.position) return "Third instruction must close the armed position.";
  if (tx.feePayer?.toBase58() !== expect.owner) return "Fee payer must be the position owner.";
  if (tx.instructions[2].keys[0].pubkey.toBase58() !== expect.owner) return "Close request owner mismatch.";
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
    if (ix.programId.equals(ComputeBudgetProgram.programId)) return { program: "Compute budget", action: "Set compute limit" };
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
