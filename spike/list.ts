import { Connection, PublicKey } from "@solana/web3.js";
import { listPositions } from "../src/core/jupiter";
const conn = new Connection(process.env.RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");
console.log(JSON.stringify(await listPositions(conn, new PublicKey(process.argv[2])), null, 1));
