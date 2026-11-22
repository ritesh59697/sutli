import { Connection, NONCE_ACCOUNT_LENGTH, PublicKey, SystemProgram } from "@solana/web3.js";
const conn = new Connection(process.env.DEVNET_RPC || "https://api.devnet.solana.com", "confirmed");
const owner = new PublicKey(process.argv[2]);
const sigs = await conn.getSignaturesForAddress(owner, { limit: 15 });
for (const s of sigs) {
  const tx = await conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
  for (const ix of tx?.transaction.message.instructions ?? []) {
    const p = (ix as any).parsed;
    if (p?.type === "initializeNonce") {
      const acct = p.info.nonceAccount;
      const info = await conn.getAccountInfo(new PublicKey(acct));
      console.log(s.signature.slice(0, 10), s.err ? "ERR" : "ok", "nonce", acct, "exists", !!info && info.data.length === NONCE_ACCOUNT_LENGTH);
    }
  }
}
