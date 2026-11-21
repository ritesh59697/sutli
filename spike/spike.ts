// Spike: can a third party build a Jupiter Perps close request for an existing position,
// and does it simulate on mainnet? (sigVerify off, so no keys needed)
import { AnchorProvider, BN, BorshAccountsCoder, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { IDL, type Perpetuals } from "./idl";
import cfg from "./config.json";

const conn = new Connection(process.env.RPC_URL || cfg.rpcUrl, "confirmed");
const PID = new PublicKey(cfg.perpsProgramId);
const program = new Program<Perpetuals>(IDL, PID, new AnchorProvider(conn, new Wallet(Keypair.generate()), {}));
const coder = new BorshAccountsCoder(IDL);

async function findLivePosition() {
  const disc = BorshAccountsCoder.accountDiscriminator("Position");
  const sigs = await conn.getSignaturesForAddress(PID, { limit: 40 });
  const seen = new Set<string>();
  for (const s of sigs) {
    if (s.err) continue;
    const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
    if (!tx) continue;
    const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses }).keySegments().flat();
    const fresh = keys.filter(k => !seen.has(k.toBase58())); fresh.forEach(k => seen.add(k.toBase58()));
    for (let i = 0; i < fresh.length; i += 100) {
      const infos = await conn.getMultipleAccountsInfo(fresh.slice(i, i + 100));
      for (let j = 0; j < infos.length; j++) {
        const a = infos[j];
        if (!a || !a.owner.equals(PID) || !a.data.subarray(0, 8).equals(disc)) continue;
        const p: any = coder.decode("position", a.data);
        if (p.sizeUsd.gtn(0)) return { pubkey: fresh[i + j], p };
      }
    }
  }
  throw new Error("no live position found in recent txs");
}

const { pubkey: position, p } = await findLivePosition();
const pool: any = await program.account.pool.fetch(new PublicKey(cfg.jlpPool));
const custody: any = await program.account.custody.fetch(p.custody);
const collateralCustody: any = await program.account.custody.fetch(p.collateralCustody);
const side = Object.keys(p.side)[0];
console.log("position", position.toBase58(), "owner", p.owner.toBase58(), "side", side, "sizeUsd", p.sizeUsd.toString());
console.log("pool.maxRequestExecutionSec", pool.maxRequestExecutionSec?.toString());

const counter = new BN(Math.floor(Math.random() * 1e9));
const [positionRequest] = PublicKey.findProgramAddressSync(
  [Buffer.from("position_request"), position.toBuffer(), counter.toArrayLike(Buffer, "le", 8), Buffer.from([2])], PID);
const desiredMint: PublicKey = collateralCustody.mint;
// long decrease fails if priceSlippage > current price, so a floor of 1 micro-USD = "any price"; short: very high cap
const priceSlippage = side === "long" ? new BN(1) : new BN("1000000000000000");
const ix = await program.methods.createDecreasePositionMarketRequest({
  collateralUsdDelta: new BN(0), sizeUsdDelta: new BN(0), priceSlippage, jupiterMinimumOut: null, counter, entirePosition: true,
}).accounts({
  owner: p.owner, receivingAccount: getAssociatedTokenAddressSync(desiredMint, p.owner, true),
  perpetuals: PublicKey.findProgramAddressSync([Buffer.from("perpetuals")], PID)[0],
  pool: new PublicKey(cfg.jlpPool), position, positionRequest,
  positionRequestAta: getAssociatedTokenAddressSync(desiredMint, positionRequest, true),
  custody: p.custody, collateralCustody: p.collateralCustody, desiredMint, referral: null,
  eventAuthority: new PublicKey(cfg.perpsEventAuthority), program: PID,
} as any).instruction();

const { blockhash } = await conn.getLatestBlockhash();
const msg = new TransactionMessage({ payerKey: p.owner, recentBlockhash: blockhash,
  instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ix] }).compileToV0Message();
const sim = await conn.simulateTransaction(new VersionedTransaction(msg), { sigVerify: false, replaceRecentBlockhash: true });
console.log("err:", JSON.stringify(sim.value.err));
console.log((sim.value.logs || []).slice(-12).join("\n"));
