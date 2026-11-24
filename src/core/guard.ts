// On-chain pin: the armed close only lands if the position account still holds the
// exact openTime the user armed. A closed-then-reopened position has a new openTime,
// so a stale order fails instead of closing a position the user never armed.
// Uses the Lighthouse assertion program (AssertAccountData, I64 Equal).
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { config } from "./config";

const ASSERT_ACCOUNT_DATA = 2; // Lighthouse instruction discriminator
const LOG_SILENT = 0;
const VALUE_I64 = 8; // DataValueAssertion variant index: Bool, U8, I8, U16, I16, U32, I32, U64, I64
const OP_EQUAL = 0;

function leb128(n: number): Buffer {
  const out: number[] = [];
  do {
    let byte = n & 0x7f;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return Buffer.from(out);
}

export function assertI64EqualIx(target: PublicKey, offset: number, value: bigint): TransactionInstruction {
  const v = Buffer.alloc(8);
  v.writeBigInt64LE(value);
  const data = Buffer.concat([Buffer.from([ASSERT_ACCOUNT_DATA, LOG_SILENT]), leb128(offset), Buffer.from([VALUE_I64]), v, Buffer.from([OP_EQUAL])]);
  return new TransactionInstruction({ programId: new PublicKey(config.lighthouseProgramId), keys: [{ pubkey: target, isSigner: false, isWritable: false }], data });
}

const FIXED_SIZE: Record<string, number> = { bool: 1, u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, u64: 8, i64: 8, u128: 16, i128: 16, publicKey: 32 };
const ANCHOR_DISCRIMINATOR = 8;

/**
 * Byte offset of a field in an Anchor account, computed from the program's IDL
 * (discriminator + the sizes of the fields before it). Only fixed-size fields may precede it.
 */
export function idlFieldOffset(idl: { accounts?: { name: string; type: { fields: { name: string; type: unknown }[] } }[] }, account: string, field: string): number {
  const fields = idl.accounts?.find(a => a.name === account)?.type.fields;
  if (!fields) throw new Error(`account ${account} not in IDL`);
  let offset = ANCHOR_DISCRIMINATOR;
  for (const f of fields) {
    if (f.name === field) return offset;
    const size = typeof f.type === "string" ? FIXED_SIZE[f.type] : undefined;
    if (size === undefined) throw new Error(`cannot size field ${f.name} before ${field}`);
    offset += size;
  }
  throw new Error(`field ${field} not in ${account}`);
}

/** Offset of `value` as an i64, taken from the layout and confirmed against the live bytes. */
export function locateI64(data: Buffer, value: bigint, layoutOffset: number): number {
  if (data.length < layoutOffset + 8 || data.readBigInt64LE(layoutOffset) !== value)
    throw new Error("position account layout does not match the expected openTime; refusing to pin");
  return layoutOffset;
}

/** Decode one of our guard instructions, for the "what you signed" view and keeper checks. */
export function decodeAssertI64(ix: TransactionInstruction): { target: string; offset: number; value: bigint } | null {
  if (!ix.programId.equals(new PublicKey(config.lighthouseProgramId))) return null;
  const d = ix.data;
  if (d[0] !== ASSERT_ACCOUNT_DATA) return null;
  let i = 2, offset = 0, shift = 1;
  while (true) {
    const b = d[i++];
    offset += (b & 0x7f) * shift;
    if (!(b & 0x80)) break;
    shift *= 128;
  }
  if (d[i] !== VALUE_I64 || d[i + 9] !== OP_EQUAL || d.length !== i + 10) return null;
  return { target: ix.keys[0].pubkey.toBase58(), offset, value: d.readBigInt64LE(i + 1) };
}
