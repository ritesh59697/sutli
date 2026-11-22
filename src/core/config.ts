import raw from "../../sutli.config.json";
import { PublicKey } from "@solana/web3.js";

export const config = raw;
export const PERPS_PROGRAM_ID = new PublicKey(raw.jupiterPerps.programId);
export const PERPS_EVENT_AUTHORITY = new PublicKey(raw.jupiterPerps.eventAuthority);
export const JLP_POOL = new PublicKey(raw.jupiterPerps.pool);
