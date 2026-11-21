// Devnet: does a durable-nonce tx that lands but FAILS still consume (advance) the nonce?
import { Connection, Keypair, LAMPORTS_PER_SOL, NONCE_ACCOUNT_LENGTH, NonceAccount, SystemProgram, Transaction } from "@solana/web3.js";
const conn = new Connection(process.env.DEVNET_RPC || "https://api.devnet.solana.com", "confirmed");
const user = Keypair.generate(), nonceKp = Keypair.generate();
const sig = await conn.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL);
await conn.confirmTransaction(sig);
const rent = await conn.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
const setup = new Transaction().add(
  SystemProgram.createAccount({ fromPubkey: user.publicKey, newAccountPubkey: nonceKp.publicKey, lamports: rent, space: NONCE_ACCOUNT_LENGTH, programId: SystemProgram.programId }),
  SystemProgram.nonceInitialize({ noncePubkey: nonceKp.publicKey, authorizedPubkey: user.publicKey }));
await conn.sendTransaction(setup, [user, nonceKp]).then(s => conn.confirmTransaction(s));
const read = async () => NonceAccount.fromAccountData((await conn.getAccountInfo(nonceKp.publicKey))!.data).nonce;
const n0 = await read();
// pre-signed tx whose 2nd instruction fails (transfer more than balance)
const tx = new Transaction({ feePayer: user.publicKey, recentBlockhash: n0 }).add(
  SystemProgram.nonceAdvance({ noncePubkey: nonceKp.publicKey, authorizedPubkey: user.publicKey }),
  SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 5 * LAMPORTS_PER_SOL }));
tx.sign(user);
const raw = tx.serialize();
await new Promise(r => setTimeout(r, 3000)); // nonce must differ from current blockhash era
const s1 = await conn.sendRawTransaction(raw, { skipPreflight: true });
const res = await conn.confirmTransaction({ signature: s1, nonceAccountPubkey: nonceKp.publicKey, nonceValue: n0, minContextSlot: 0 } as any);
console.log("failing tx landed, err =", JSON.stringify(res.value.err));
const n1 = await read();
console.log("nonce advanced:", n0 !== n1);
try { await conn.sendRawTransaction(raw, { skipPreflight: false }); console.log("resend accepted?!"); } catch (e: any) { console.log("resend rejected:", e.message.split("\n")[0].slice(0, 120)); }
