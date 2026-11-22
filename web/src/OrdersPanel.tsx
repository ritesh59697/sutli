import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { FlaskConical, Loader2, XCircle } from "lucide-react";
import { buildDisarmTx, type DecodedIx } from "../../src/core/order";
import type { Odds } from "../../src/core/odds";
import type { Trigger } from "../../src/core/trigger";
import { errMsg, keeper, mainnet, pct, short, signAndSend, txLink } from "./lib";

interface OrderRow {
  id: string; position: string; side: string; nonceAccount: string; status: string; trigger: Trigger;
  holdCount: number; lastOdds?: Odds; lastCheck?: string; note?: string; fireSig?: string; instructions: DecodedIx[];
}
interface SimResult { ok: boolean; reason?: string; logs?: string[] }

export function OrdersPanel({ version }: { version: number }) {
  const { publicKey, signTransaction } = useWallet();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sims, setSims] = useState<Record<string, SimResult>>({});

  const load = useCallback(async () => {
    if (!publicKey) return setOrders([]);
    try { setOrders(await keeper<OrderRow[]>(`/orders?owner=${publicKey.toBase58()}`)); setError(null); }
    catch (e) { setError(`Keeper unreachable: ${errMsg(e)}`); }
  }, [publicKey]);
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load, version]);

  const simulate = async (id: string) => {
    setBusy(id);
    try { const r = await keeper<SimResult>(`/orders/${id}/simulate`, { method: "POST" }); setSims(s => ({ ...s, [id]: r })); }
    catch (e) { setSims(s => ({ ...s, [id]: { ok: false, reason: errMsg(e) } })); }
    finally { setBusy(null); }
  };

  const disarm = async (o: OrderRow) => {
    if (!publicKey || !signTransaction) return;
    setBusy(o.id);
    try { await signAndSend(mainnet, await buildDisarmTx(mainnet, publicKey, new PublicKey(o.nonceAccount)), signTransaction); await load(); }
    catch (e) { setError(errMsg(e)); }
    finally { setBusy(null); }
  };

  return (
    <section className="panel" style={{ marginTop: "var(--s6)" }} aria-labelledby="ord-h">
      <h2 id="ord-h">Armed orders</h2>
      {!publicKey && <p className="empty">Connect a wallet to see its orders.</p>}
      {publicKey && orders.length === 0 && !error && <p className="empty">Nothing armed yet.</p>}
      {error && <div className="notice bad" role="alert">{error}</div>}
      {orders.length > 0 && (
        <div className="scroll-x">
          <table>
            <thead><tr><th>Status</th><th>Position</th><th>Trigger</th><th>Now</th><th>Keeper</th><th /></tr></thead>
            <tbody>
              {orders.map(o => {
                const sim = sims[o.id];
                return (
                  <tr key={o.id}>
                    <td><span className={`tag ${o.status}`}>{o.status}</span></td>
                    <td><span className={`tag ${o.side}`}>{o.side}</span> <span className="mono">{short(o.position)}</span></td>
                    <td>{o.trigger.source.kind} <span className="mono">{o.trigger.source.id}</span><br />
                      <span className="hint">YES {o.trigger.direction === "above" ? "≥" : "≤"} {pct(o.trigger.line)}, hold {o.trigger.holdPolls}</span></td>
                    <td className="mono">{o.lastOdds ? `${pct(o.lastOdds.bid)} / ${pct(o.lastOdds.ask)}` : "—"}<br /><span className="hint">held {o.holdCount}/{o.trigger.holdPolls}</span></td>
                    <td style={{ maxWidth: 260 }}>
                      <span className="hint">{o.note ?? o.lastCheck ?? "waiting for first poll"}</span>
                      {o.fireSig && <><br /><a href={txLink(o.fireSig)} target="_blank" rel="noreferrer">fire transaction</a></>}
                      {sim && <div className={`notice ${sim.ok ? "ok" : "bad"}`}>{sim.ok ? "Simulated against mainnet now: the close would succeed." : `Would not fire: ${sim.reason}`}</div>}
                    </td>
                    <td>
                      <div className="row" style={{ flexWrap: "nowrap" }}>
                        <button className="btn" onClick={() => simulate(o.id)} disabled={busy === o.id} aria-label="Simulate this order now">
                          {busy === o.id ? <Loader2 size={14} aria-hidden /> : <FlaskConical size={14} aria-hidden />} Dry run
                        </button>
                        {o.status === "armed" && (
                          <button className="btn danger" onClick={() => disarm(o)} disabled={busy === o.id}>
                            <XCircle size={14} aria-hidden /> Disarm
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
