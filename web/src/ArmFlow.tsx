import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { CheckCircle2, Circle, Flame, KeyRound, Loader2, PenLine, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { listPositions, type PositionView } from "../../src/core/jupiter";
import { buildArmTx, buildCreateNonceTx, describeTx, readNonce, toB64, verifySigned, type DecodedIx } from "../../src/core/order";
import type { Odds, OddsSource } from "../../src/core/odds";
import { conditionMet, type Trigger } from "../../src/core/trigger";
import { config } from "../../src/core/config";
import { accountLink, errMsg, keeper, mainnet, mintLabel, pct, short, signAndSend, txLink, usd } from "./lib";

type Busy = null | "positions" | "nonce" | "sign" | "submit" | "odds";

export function ArmFlow({ onArmed }: { onArmed: () => void }) {
  const { publicKey, signTransaction } = useWallet();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const [positions, setPositions] = useState<PositionView[] | null>(null);
  const [picked, setPicked] = useState<PositionView | null>(null);

  const [kind, setKind] = useState<OddsSource["kind"]>("kalshi");
  const [marketId, setMarketId] = useState("");
  const [direction, setDirection] = useState<Trigger["direction"]>("above");
  const [linePct, setLinePct] = useState(60);
  const [holdPolls, setHoldPolls] = useState(config.trigger.defaultHoldPolls);
  const [minLiq, setMinLiq] = useState(config.trigger.defaultMinLiquidityUsd);
  const [odds, setOdds] = useState<Odds | null>(null);

  const [nonce, setNonce] = useState<{ account: string; value: string; sig: string } | null>(null);
  const [signed, setSigned] = useState<{ tx: Transaction; decoded: DecodedIx[] } | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);

  const trigger: Trigger | null = marketId
    ? { source: { kind, id: marketId.trim() }, direction, line: linePct / 100, holdPolls, minLiquidityUsd: minLiq }
    : null;
  const preview = useMemo(() => (odds && trigger ? conditionMet(odds, trigger) : null), [odds, trigger]);

  const run = async (b: Busy, fn: () => Promise<void>) => {
    setBusy(b); setError(null);
    try { await fn(); } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  };

  const loadPositions = () => run("positions", async () => {
    if (!publicKey) return;
    const list = await listPositions(mainnet, publicKey);
    setPositions(list);
    setPicked(p => list.find(x => x.address === p?.address) ?? list[0] ?? null);
  });
  useEffect(() => { setPositions(null); setPicked(null); setNonce(null); setSigned(null); setArmedId(null); if (publicKey) loadPositions(); }, [publicKey?.toBase58()]);
  useEffect(() => { setSigned(null); setArmedId(null); }, [picked?.address]);

  const loadOdds = () => run("odds", async () => {
    setOdds(await keeper<Odds>(`/odds?kind=${kind}&id=${encodeURIComponent(marketId.trim())}`));
  });

  const createNonce = () => run("nonce", async () => {
    if (!publicKey || !signTransaction) throw new Error("Connect a wallet first.");
    const { tx, nonce: kp } = await buildCreateNonceTx(mainnet, publicKey);
    const sig = await signAndSend(mainnet, tx, signTransaction, [kp]);
    const n = await readNonce(mainnet, kp.publicKey);
    if (!n) throw new Error("Nonce account was not created.");
    setNonce({ account: kp.publicKey.toBase58(), value: n.value, sig });
    setSigned(null);
  });

  const preSign = () => run("sign", async () => {
    if (!picked || !nonce || !signTransaction) return;
    const fresh = await readNonce(mainnet, new PublicKey(nonce.account));
    if (!fresh || fresh.value !== nonce.value) throw new Error("This nonce was already used. Create a new one.");
    const tx = await buildArmTx(mainnet, picked, new PublicKey(nonce.account), nonce.value);
    const expected = Transaction.populate(tx.compileMessage());
    const out = await signTransaction(tx); // sign only: nothing is broadcast here
    const v = verifySigned(expected, out);
    if (!v.ok) throw new Error(v.reason);
    setSigned({ tx: out, decoded: describeTx(out) });
  });

  const submit = () => run("submit", async () => {
    if (!signed || !picked || !nonce || !trigger) return;
    const r = await keeper<{ id: string }>("/orders", {
      method: "POST",
      body: JSON.stringify({ txB64: toB64(signed.tx), trigger, position: picked.address, nonceAccount: nonce.account }),
    });
    setArmedId(r.id);
    setNonce(null); // one nonce per armed order
    onArmed();
  });

  const steps = [
    { done: !!nonce || !!armedId, icon: KeyRound, title: "Create a nonce account", sub: "One per order. Rent (~0.0015 SOL) comes back when you close it." },
    { done: !!signed, icon: PenLine, title: "Pre-sign the close", sub: "Your wallet signs. Nothing is sent." },
    { done: !!armedId, icon: Send, title: "Hand it to the keeper", sub: "The keeper checks it closes this position, simulates it, and stores the bytes." },
  ];

  return (
    <div className="grid">
      <div>
        <section className="panel" aria-labelledby="pos-h">
          <h2 id="pos-h"><span className="step">1</span> Pick a Jupiter position
            <button className="btn" style={{ marginLeft: "auto" }} onClick={loadPositions} disabled={!publicKey || busy === "positions"} aria-label="Refresh positions">
              {busy === "positions" ? <Loader2 size={14} className="spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />}
            </button>
          </h2>
          {!publicKey && <p className="empty">Connect the wallet that holds your Jupiter Perps position.</p>}
          {publicKey && positions?.length === 0 && <p className="empty">No open Jupiter Perps positions on this wallet.</p>}
          {positions && positions.length > 0 && (
            <div className="scroll-x">
              <table>
                <thead><tr><th>Market</th><th>Side</th><th className="num">Size</th><th className="num">Collateral</th><th className="num">Entry</th></tr></thead>
                <tbody>
                  {positions.map(p => (
                    <tr key={p.address} className="pick" aria-selected={picked?.address === p.address} tabIndex={0}
                      onClick={() => setPicked(p)} onKeyDown={e => (e.key === "Enter" || e.key === " ") && setPicked(p)}>
                      <td>{mintLabel(p.marketMint)}-PERP</td>
                      <td><span className={`tag ${p.side}`}>{p.side}</span></td>
                      <td className="num">{usd(p.sizeUsd)}</td>
                      <td className="num">{usd(p.collateralUsd)} {mintLabel(p.collateralMint)}</td>
                      <td className="num">{usd(p.entryPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="trig-h">
          <h2 id="trig-h"><span className="step">2</span> Set the line</h2>
          <p className="hint">Pick a live prediction market. Sutli watches the side you could actually trade at, and ignores thin books.</p>
          <div className="row">
            <div className="field" style={{ flex: "0 1 140px" }}>
              <label htmlFor="src">Source</label>
              <select id="src" value={kind} onChange={e => { setKind(e.target.value as OddsSource["kind"]); setOdds(null); }}>
                <option value="kalshi">Kalshi</option>
                <option value="polymarket">Polymarket</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="mid">{kind === "kalshi" ? "Market ticker" : "Market id"}</label>
              <input id="mid" value={marketId} onChange={e => { setMarketId(e.target.value); setOdds(null); }} placeholder={kind === "kalshi" ? "e.g. KXFEDDECISION-…" : "e.g. 516710"} />
            </div>
            <div className="field" style={{ flex: "0 0 auto" }}>
              <button className="btn" onClick={loadOdds} disabled={!marketId || busy === "odds"}>
                {busy === "odds" ? <Loader2 size={14} aria-hidden /> : <RefreshCw size={14} aria-hidden />} Load odds
              </button>
            </div>
          </div>
          {odds && (
            <div className="odds" aria-live="polite">
              <div><div className="hint" style={{ margin: 0 }}>YES bid / ask</div><span className="big">{pct(odds.bid)} / {pct(odds.ask)}</span></div>
              <div style={{ minWidth: 0 }}><div className="hint" style={{ margin: 0 }}>{odds.label}</div><span className="mono">depth {usd(odds.liquidityUsd)}</span></div>
            </div>
          )}
          <div className="row">
            <div className="field">
              <label htmlFor="dir">Close my position when YES</label>
              <select id="dir" value={direction} onChange={e => setDirection(e.target.value as Trigger["direction"])}>
                <option value="above">rises to or above</option>
                <option value="below">falls to or below</option>
              </select>
            </div>
            <div className="field" style={{ flex: "0 1 110px" }}>
              <label htmlFor="line">Line (%)</label>
              <input id="line" type="number" min={1} max={99} value={linePct} onChange={e => setLinePct(Number(e.target.value))} />
            </div>
            <div className="field" style={{ flex: "0 1 110px" }}>
              <label htmlFor="hold">Hold (polls)</label>
              <input id="hold" type="number" min={1} max={20} value={holdPolls} onChange={e => setHoldPolls(Number(e.target.value))} />
            </div>
            <div className="field" style={{ flex: "0 1 130px" }}>
              <label htmlFor="liq">Min depth ($)</label>
              <input id="liq" type="number" min={0} value={minLiq} onChange={e => setMinLiq(Number(e.target.value))} />
            </div>
          </div>
          {preview && <p className="hint" style={{ margin: 0 }}>Right now: {preview.why} → {preview.met ? "would fire" : "would wait"}.</p>}
        </section>
      </div>

      <section className="panel" aria-labelledby="arm-h">
        <h2 id="arm-h"><span className="step">3</span> Arm it</h2>
        <p className="hint">
          You sign one close order in advance. The keeper may send that exact order and nothing else. To cancel, you advance the nonce and the stored order is dead.
        </p>
        <ol className="checklist">
          {steps.map((s, i) => (
            <li key={s.title}>
              <span className={`state ${s.done ? "done" : ""}`}>{s.done ? <CheckCircle2 size={18} aria-hidden /> : <Circle size={18} aria-hidden />}</span>
              <div><div className="title">{s.title}</div><div className="sub">{s.sub}</div></div>
              <div>
                {i === 0 && <button className="btn" onClick={createNonce} disabled={!publicKey || !picked || !!nonce || busy !== null}>{busy === "nonce" ? <Loader2 size={14} aria-hidden /> : <s.icon size={14} aria-hidden />} Create</button>}
                {i === 1 && <button className="btn" onClick={preSign} disabled={!nonce || !picked || !!signed || busy !== null}>{busy === "sign" ? <Loader2 size={14} aria-hidden /> : <s.icon size={14} aria-hidden />} Sign</button>}
                {i === 2 && <button className="btn primary" onClick={submit} disabled={!signed || !trigger || !!armedId || busy !== null}>{busy === "submit" ? <Loader2 size={14} aria-hidden /> : <Flame size={14} aria-hidden />} Arm</button>}
              </div>
            </li>
          ))}
        </ol>
        {nonce && <p className="hint" style={{ marginTop: "var(--s3)" }}>Nonce <a href={accountLink(nonce.account)} target="_blank" rel="noreferrer" className="mono">{short(nonce.account)}</a> created in <a href={txLink(nonce.sig)} target="_blank" rel="noreferrer">this transaction</a>.</p>}
        {signed && (
          <div className="signed">
            <h3><ShieldCheck size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> What you signed (the wallet returned it unchanged)</h3>
            <ol>
              {signed.decoded.map((d, i) => (
                <li key={i}><strong>{d.program}</strong>: {d.action}{d.detail && <> · <span className="mono">{short(d.detail)}</span></>}</li>
              ))}
            </ol>
          </div>
        )}
        {armedId && <div className="notice ok">Armed. The keeper is watching the odds. You can see it below.</div>}
        {error && <div className="notice bad" role="alert">{error}</div>}
      </section>
    </div>
  );
}
