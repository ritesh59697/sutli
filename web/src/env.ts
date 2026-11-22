import { clusterApiUrl } from "@solana/web3.js";

export const env = {
  mainnetRpc: import.meta.env.VITE_MAINNET_RPC || clusterApiUrl("mainnet-beta"),
  devnetRpc: import.meta.env.VITE_DEVNET_RPC || clusterApiUrl("devnet"),
  keeperUrl: import.meta.env.VITE_KEEPER_URL || "http://localhost:8787",
};
