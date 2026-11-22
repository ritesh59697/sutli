// Jupiter Perps: find a wallet's open positions and build the close request.
import { AnchorProvider, BN, BorshAccountsCoder, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { IDL, type Perpetuals } from "./jupiter-idl";
import { JLP_POOL, PERPS_EVENT_AUTHORITY, PERPS_PROGRAM_ID, config } from "./config";

export type Side = "long" | "short";
export interface PositionView {
  address: string;
  owner: string;
  side: Side;
  custody: string;
  collateralCustody: string;
  marketMint: string;
  collateralMint: string;
  sizeUsd: number;      // USD, 6dp decoded
  collateralUsd: number;
  entryPrice: number;
  openTime: number;     // unix seconds; used to pin the armed order to this exact position
}

const readOnlyWallet = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T,>(t: T) => t,
  signAllTransactions: async <T,>(t: T[]) => t,
};
export const perpsProgram = (conn: Connection) =>
  new Program<Perpetuals>(IDL, PERPS_PROGRAM_ID, new AnchorProvider(conn, readOnlyWallet as any, {}));

const coder = new BorshAccountsCoder(IDL);
const usd = (bn: BN) => Number(bn.toString()) / 1e6;
const sideByte: Record<Side, number> = { long: 1, short: 2 };

export function positionPda(owner: PublicKey, custody: PublicKey, collateralCustody: PublicKey, side: Side) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), owner.toBuffer(), JLP_POOL.toBuffer(), custody.toBuffer(), collateralCustody.toBuffer(), Buffer.from([sideByte[side]])],
    PERPS_PROGRAM_ID,
  )[0];
}

export async function loadCustodies(conn: Connection) {
  const program = perpsProgram(conn);
  const pool: any = await program.account.pool.fetch(JLP_POOL);
  const keys: PublicKey[] = pool.custodies;
  const accs: any[] = await program.account.custody.fetchMultiple(keys);
  return keys.map((k, i) => ({ address: k, mint: accs[i].mint as PublicKey, isStable: Boolean(accs[i].isStable) }));
}

export function decodePosition(address: PublicKey, data: Buffer, custodies: { address: PublicKey; mint: PublicKey }[]): PositionView {
  const p: any = coder.decode("position", data);
  const mintOf = (c: PublicKey) => custodies.find(x => x.address.equals(c))?.mint.toBase58() ?? "";
  return {
    address: address.toBase58(),
    owner: p.owner.toBase58(),
    side: Object.keys(p.side)[0] as Side,
    custody: p.custody.toBase58(),
    collateralCustody: p.collateralCustody.toBase58(),
    marketMint: mintOf(p.custody),
    collateralMint: mintOf(p.collateralCustody),
    sizeUsd: usd(p.sizeUsd),
    collateralUsd: usd(p.collateralUsd),
    entryPrice: usd(p.price),
    openTime: Number(p.openTime.toString()),
  };
}

/** Every (market, collateral, side) slot has one fixed PDA, so we check them all directly. */
export async function listPositions(conn: Connection, owner: PublicKey): Promise<PositionView[]> {
  const custodies = await loadCustodies(conn);
  const markets = custodies.filter(c => !c.isStable);
  const stables = custodies.filter(c => c.isStable);
  const slots: { pda: PublicKey }[] = [];
  for (const m of markets) {
    slots.push({ pda: positionPda(owner, m.address, m.address, "long") });
    for (const s of stables) slots.push({ pda: positionPda(owner, m.address, s.address, "short") });
  }
  // Some free RPCs cap accounts per call, so fetch in configured chunks.
  const size = config.rpc.maxAccountsPerCall;
  const infos = [];
  for (let i = 0; i < slots.length; i += size)
    infos.push(...(await conn.getMultipleAccountsInfo(slots.slice(i, i + size).map(s => s.pda))));
  const out: PositionView[] = [];
  infos.forEach((info, i) => {
    if (!info || !info.owner.equals(PERPS_PROGRAM_ID)) return;
    const v = decodePosition(slots[i].pda, info.data, custodies);
    if (v.sizeUsd > 0) out.push(v);
  });
  return out;
}

export async function fetchPosition(conn: Connection, address: PublicKey): Promise<PositionView | null> {
  const info = await conn.getAccountInfo(address);
  if (!info || !info.owner.equals(PERPS_PROGRAM_ID)) return null;
  const v = decodePosition(address, info.data, await loadCustodies(conn));
  return v.sizeUsd > 0 ? v : null;
}

/** Full-position market close. Collateral comes back in the collateral mint. */
export async function buildCloseIx(conn: Connection, pos: PositionView, counter: BN): Promise<TransactionInstruction> {
  const owner = new PublicKey(pos.owner);
  const position = new PublicKey(pos.address);
  const desiredMint = new PublicKey(pos.collateralMint);
  const [positionRequest] = PublicKey.findProgramAddressSync(
    [Buffer.from("position_request"), position.toBuffer(), counter.toArrayLike(Buffer, "le", 8), Buffer.from([2])],
    PERPS_PROGRAM_ID,
  );
  // Long close fails if the limit is above the oracle price: a floor of 1 means "any price".
  // Short close fails if the price is above the limit: u64 max means "any price".
  // Jupiter fills at its oracle price, so this cannot be sandwiched.
  const priceSlippage = pos.side === "long" ? new BN(1) : new BN("18446744073709551615");
  return perpsProgram(conn).methods
    .createDecreasePositionMarketRequest({
      collateralUsdDelta: new BN(0), sizeUsdDelta: new BN(0), priceSlippage,
      jupiterMinimumOut: null, counter, entirePosition: true,
    } as any)
    .accounts({
      owner,
      receivingAccount: getAssociatedTokenAddressSync(desiredMint, owner, true),
      perpetuals: PublicKey.findProgramAddressSync([Buffer.from("perpetuals")], PERPS_PROGRAM_ID)[0],
      pool: JLP_POOL, position, positionRequest,
      positionRequestAta: getAssociatedTokenAddressSync(desiredMint, positionRequest, true),
      custody: new PublicKey(pos.custody), collateralCustody: new PublicKey(pos.collateralCustody),
      desiredMint, referral: null, eventAuthority: PERPS_EVENT_AUTHORITY, program: PERPS_PROGRAM_ID,
    } as any)
    .instruction();
}
