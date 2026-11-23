import { Connection } from "@solana/web3.js";
const c = new Connection(process.env.DEVNET_RPC!, "confirmed");
const sigs = await c.getSignaturesForAddress(new (await import("@solana/web3.js")).PublicKey(process.argv[2]), { limit: 5 });
console.log(sigs.map(s => [s.signature.slice(0, 12), s.err, s.confirmationStatus]));
