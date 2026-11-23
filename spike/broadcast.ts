// Broadcast a signed devnet transaction (base64 on stdin) and wait for confirmation.
import { Connection } from "@solana/web3.js";
const conn = new Connection(process.env.DEVNET_RPC!, "confirmed");
const raw = Buffer.from((await new Response(process.stdin as any).text()).trim(), "base64");
const sim = await conn.simulateTransaction((await import("@solana/web3.js")).VersionedTransaction.deserialize(raw), { sigVerify: true, replaceRecentBlockhash: false });
console.log("simulation:", JSON.stringify(sim.value.err));
if (sim.value.err) { console.log((sim.value.logs ?? []).slice(-5).join("\n")); process.exit(1); }
let sig = "";
for (let i = 0; i < 20; i++) {
  sig = await conn.sendRawTransaction(raw, { skipPreflight: true });
  await new Promise(r => setTimeout(r, 2000));
  const st = (await conn.getSignatureStatuses([sig])).value[0];
  if (st?.confirmationStatus) { console.log("confirmed", sig, "err", JSON.stringify(st.err)); process.exit(st.err ? 1 : 0); }
}
console.log("not confirmed", sig);
