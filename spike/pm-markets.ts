import { Connection, PublicKey } from "@solana/web3.js";
import { PmAmmClient } from "@pm-amm/sdk";
import { config } from "../src/core/config";
import { marketState } from "../src/core/pmamm";
for (const cluster of ["mainnet", "devnet"] as const) {
  const url = cluster === "mainnet" ? process.env.MAINNET_RPC! : process.env.DEVNET_RPC!;
  const conn = new Connection(url, "confirmed");
  const c = PmAmmClient.readOnly(conn, new PublicKey(config.pmAmm.programId), new PublicKey(config.pmAmm.collateralMint[cluster]));
  const all: any[] = await (c.program.account as any).market.all();
  const now = Math.floor(Date.now() / 1000);
  const live = all.filter(a => !a.account.resolved && a.account.endTs.toNumber() > now);
  console.log(`${cluster}: ${all.length} markets, ${live.length} open`);
  for (const a of live.slice(0, 6)) {
    const s = marketState(a.account);
    console.log(" ", a.publicKey.toBase58(), JSON.stringify(Buffer.from(a.account.name).toString().replace(/\0+$/, "")).slice(0, 50), "P=", s.price.toFixed(3), "Leff", s.lEff.toFixed(0), "ends", new Date(a.account.endTs.toNumber() * 1000).toISOString().slice(0, 16));
  }
}
