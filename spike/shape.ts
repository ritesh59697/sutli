import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { fetchPosition } from "../src/core/jupiter";
import { buildArmTx, checkArmShape, describeTx } from "../src/core/order";
const conn = new Connection(process.env.RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");
const pos = (await fetchPosition(conn, new PublicKey(process.argv[2])))!;
const nonce = Keypair.generate().publicKey;
const tx = await buildArmTx(conn, pos, nonce, Keypair.generate().publicKey.toBase58());
console.log(describeTx(tx));
const exp = { owner: pos.owner, nonceAccount: nonce.toBase58(), position: pos.address, openTime: pos.openTime };
console.log("good shape:", checkArmShape(tx, exp) ?? "OK");
console.log("wrong nonce:", checkArmShape(tx, { ...exp, nonceAccount: Keypair.generate().publicKey.toBase58() }));
const evil = await buildArmTx(conn, pos, nonce, Keypair.generate().publicKey.toBase58());
evil.add(SystemProgram.transfer({ fromPubkey: new PublicKey(pos.owner), toPubkey: Keypair.generate().publicKey, lamports: 1 }));
console.log("extra transfer:", checkArmShape(evil, exp));
const r = await fetch("http://localhost:8797/orders", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ txB64: Buffer.from(tx.serialize({ requireAllSignatures: false })).toString("base64"), position: pos.address, nonceAccount: nonce.toBase58(),
    trigger: { source: { kind: "kalshi", id: "X" }, direction: "above", line: 0.6, holdPolls: 3, minLiquidityUsd: 500 } }) });
console.log("keeper on unsigned:", r.status, await r.text());
console.log("stale openTime:", checkArmShape(tx, { ...exp, openTime: exp.openTime + 1 }));
