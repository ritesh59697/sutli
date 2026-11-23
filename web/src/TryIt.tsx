// Judge sandbox: no wallet. Real devnet trades move our pm-AMM demo market; Sutli then builds the exact
// close it would pre-sign for a real open Jupiter position and simulates it on mainnet. Nothing is sent on mainnet.
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, FlaskConical, Loader2, XCircle } from "lucide-react";
import type { Odds } from "../../src/core/odds";
import type { PositionView } from "../../src/core/jupiter";
import type { DecodedIx } from "../../src/core/order";
import { accountLink, detailText, errMsg, keeper, mintLabel, pct, short, txLink, usd } from "./lib";

interface DryRun { at: number; fired: boolean; why: string; position: string; ok: boolean; err: unknown; unitsConsumed?: number; instructions: DecodedIx[]; logs: string[] }
interface Snapshot { ready: true; market: string; name: string; line: number; odds: Odds; condition: { met: boolean; why: string }; position: PositionView | null; lastDryRun: DryRun | null }
type Busy = null | "load" | "up" | "down" | "dry";

export function TryIt() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<{ sig: string; dir: "up" | "down" } | null>(null);
  const [dry, setDry] = useState<DryRun | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setBusy("load");
    try {
      const s = await keeper<Snapshot | { ready: false; reason: string }>("/demo");
      if (!s.ready) throw new Error(s.reason);
      setSnap(s);
      setError(null);
    } catch (e) { setError(errMsg(e)); }
    finally { if (!quiet) setBusy(null); }
  }, []);
  useEffect(() => { load(); const t = setInterval(() => load(true), 15_000); return () => clearInterval(t); }, [load]);

  const push = async (dir: "up" | "down") => {
    setBusy(dir); setError(null);
    try {
      const r = await keeper<{ sig: string; after: Snapshot }>(`/demo/push/${dir}`, { method: "POST" });
      setLastTx({ sig: r.sig, dir });
      setSnap(r.after);
      setDry(null);
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(null); }
  };

  const dryRun = async () => {
    setBusy("dry"); setError(null);
    try { setDry(await keeper<DryRun>("/demo/dryrun", { method: "POST" })); await load(true); }
    catch (e) { setError(errMsg(e)); }
    finally { setBusy(null); }
  };

  const o = snap?.odds;
  const bidPct = o?.bid != null ? o.bid * 100 : null;
  const linePct = snap ? snap.line * 100 : null;
  const pos = snap?.position;

  return (
    <div className="grid">
      <div>
        <section className="panel" aria-labelledby="ti-h">
          <h2 id="ti-h">Try it, no wallet needed</h2>
          <p className="hint">
            Our own prediction market on pm-AMM (Solana devnet) stands in for the news. Push the odds past the line with a real devnet trade,
            then watch Sutli build the exact close it would pre-sign for a real, open Jupiter position and simulate it on mainnet. Nothing is sent on mainnet.
          </p>
          {!snap && busy === "load" && <p className="empty"><Loader2 size={14} aria-hidden /> Loading the demo market…</p>}
          {snap && o && (
            <>
              <div className="hint" style={{ margin: 0 }}>
                <a href={accountLink(snap.market, "devnet")} target="_blank" rel="noreferrer">{snap.name}</a>
              </div>
              <div className="meter" aria-label={`YES bid ${pct(o.bid)}, line ${pct(snap.line)}`}>
                <div className="meter-fill" style={{ width: `${bidPct ?? 0}%` }} data-over={snap.condition.met} />
                <div className="meter-line" style={{ left: `${linePct}%` }}><span>line {pct(snap.line)}</span></div>
              </div>
              <div className="odds" aria-live="polite">
                <div><div className="hint" style={{ margin: 0 }}>YES bid / ask</div><span className="big">{pct(o.bid)} / {pct(o.ask)}</span></div>
                <div>
                  <div className="hint" style={{ margin: 0 }}>Trigger</div>
                  <span className={`tag ${snap.condition.met ? "fired" : "armed"}`}>{snap.condition.met ? "would fire" : "waiting"}</span>
                  <div className="hint" style={{ margin: 0 }}>{snap.condition.why} · depth {usd(o.liquidityUsd)}</div>
                </div>
              </div>
              <div className="row">
                <button className="btn primary" onClick={() => push("up")} disabled={busy !== null}>
                  {busy === "up" ? <Loader2 size={14} aria-hidden /> : <ArrowUp size={14} aria-hidden />} Push the odds up
                </button>
                <button className="btn" onClick={() => push("down")} disabled={busy !== null}>
                  {busy === "down" ? <Loader2 size={14} aria-hidden /> : <ArrowDown size={14} aria-hidden />} Reset
                </button>
              </div>
              {lastTx && (
                <p className="hint" style={{ marginTop: "var(--s3)" }}>
                  {lastTx.dir === "up" ? "Bought YES" : "Sold YES"} on pm-AMM: <a href={txLink(lastTx.sig, "devnet")} target="_blank" rel="noreferrer">devnet transaction</a>
                </p>
              )}
            </>
          )}
          {error && <div className="notice bad" role="alert">{error}</div>}
        </section>

        <section className="panel" aria-labelledby="tp-h">
          <h2 id="tp-h">The position it would close</h2>
          {!pos && <p className="empty">{busy === "load" ? "Finding an open Jupiter position…" : "No open position found right now."}</p>}
          {pos && (
            <>
              <p className="hint">A real, currently open Jupiter Perps position on mainnet, read-only. It belongs to someone else, so Sutli can only simulate.</p>
              <table>
                <tbody>
                  <tr><th>Market</th><td>{mintLabel(pos.marketMint)}-PERP <span className={`tag ${pos.side}`}>{pos.side}</span></td></tr>
                  <tr><th>Size</th><td className="mono">{usd(pos.sizeUsd)}</td></tr>
                  <tr><th>Entry</th><td className="mono">{usd(pos.entryPrice)}</td></tr>
                  <tr><th>Account</th><td><a className="mono" href={accountLink(pos.address)} target="_blank" rel="noreferrer">{short(pos.address)}</a></td></tr>
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>

      <section className="panel" aria-labelledby="dr-h">
        <h2 id="dr-h">Dry run on mainnet</h2>
        <p className="hint">
          Builds the exact order Sutli would have you pre-sign for that position and runs it through Solana mainnet's simulator.
          The advance-nonce step is left out because the position is not ours.
        </p>
        <button className="btn primary" onClick={dryRun} disabled={busy !== null || !pos}>
          {busy === "dry" ? <Loader2 size={14} aria-hidden /> : <FlaskConical size={14} aria-hidden />} Run the dry run
        </button>
        {dry && (
          <div className="signed">
            <h3>
              {dry.ok ? <CheckCircle2 size={14} aria-hidden style={{ verticalAlign: "-2px", color: "var(--ok)" }} /> : <XCircle size={14} aria-hidden style={{ verticalAlign: "-2px", color: "var(--destructive)" }} />}{" "}
              {dry.ok ? "Mainnet accepted the close" : "Mainnet rejected it"}
              {dry.unitsConsumed ? <span className="hint"> · {dry.unitsConsumed.toLocaleString()} compute units</span> : null}
            </h3>
            <p className="hint" style={{ margin: "0 0 var(--s2)" }}>
              Trigger at that moment: {dry.fired ? "fired" : "would still wait"} ({dry.why}). In a real arm, the keeper only sends when it fires.
            </p>
            <ol>
              {dry.instructions.map((d, i) => (
                <li key={i}><strong>{d.program}</strong>: {d.action}{d.detail && <> · <span className="mono">{detailText(d.detail)}</span></>}</li>
              ))}
            </ol>
            {!dry.ok && <p className="hint">Error: <span className="mono">{JSON.stringify(dry.err)}</span></p>}
            <details style={{ marginTop: "var(--s2)" }}>
              <summary className="hint">Program logs</summary>
              <pre className="mono logs">{dry.logs.join("\n")}</pre>
            </details>
          </div>
        )}
      </section>
    </div>
  );
}
