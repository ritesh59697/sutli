const keeperUrl = import.meta.env.VITE_KEEPER_URL || "http://localhost:8797";

// RPC goes through the keeper's proxy so the provider key stays server-side.
// A VITE_*_RPC override is only for local experiments; never put a keyed URL there for a deploy.
export const env = {
  keeperUrl,
  mainnetRpc: import.meta.env.VITE_MAINNET_RPC || `${keeperUrl}/rpc/mainnet`,
  devnetRpc: import.meta.env.VITE_DEVNET_RPC || `${keeperUrl}/rpc/devnet`,
};
