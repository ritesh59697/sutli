// Landing section above the app. One action: try the no-wallet sandbox.
// Copy stays factual: the demo market is on devnet, the dry run is a mainnet simulation, no users yet.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowRight, Ban, CheckCircle2, Gauge, KeyRound, Lock, ShieldCheck, Timer, XCircle } from "lucide-react";
import { config } from "../../src/core/config";
import { accountLink, keeper, pct } from "./lib";

const maxFeeSol = config.priorityFee.maxPriorityLamports / 1e9;

interface ProofOdds { id: string; label: string; bid: number | null; ask: number | null; liquidityUsd: number }
interface Proof { fed: ProofOdds | null; demo: ProofOdds | null; lastDryRun: { at: number; ok: boolean; unitsConsumed: number | null } | null; at: number }

function useProof() {
  const [proof, setProof] = useState<Proof | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => keeper<Proof>("/proof").then(p => { if (alive) { setProof(p); setFailed(false); } }).catch(() => alive && setFailed(true));
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return { proof, failed };
}

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Fade up once when scrolled into view (IntersectionObserver, no scroll listener). */
function Reveal({ children, as: Tag = "div", className = "" }: { children: ReactNode; as?: "div" | "section"; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { el.dataset.shown = "true"; io.disconnect(); } }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref as any} className={`reveal ${className}`}>{children}</Tag>;
}

/** Each word lights up in reading order as it crosses a line near the middle of the screen. */
function TaglineReveal({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const words = ref.current?.querySelectorAll<HTMLSpanElement>(".w");
    if (!words?.length) return;
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) (e.target as HTMLElement).dataset.lit = "true"; }),
      { rootMargin: "0px 0px -45% 0px" },
    );
    words.forEach(w => io.observe(w));
    return () => io.disconnect();
  }, []);
  return <p ref={ref} className="tagline">{text.split(" ").map((w, i) => <span key={i} className="w">{w} </span>)}</p>;
}

/**
 * Hero product shot: a styled rendition of the Try it panel playing the core moment on a loop.
 * It is labelled as an illustration; the live panel sits further down the page.
 */
function HeroShot({ units }: { units: number | null }) {
  const LINE = 60;
  const frames = [
    { bid: 48.2, state: "waiting" as const },
    { bid: 55.4, state: "waiting" as const },
    { bid: 64.3, state: "fire" as const },
    { bid: 64.3, state: "sent" as const },
    { bid: 64.3, state: "done" as const },
  ];
  const [i, setI] = useState(() => (prefersReducedMotion() ? frames.length - 1 : 0));
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t = setInterval(() => setI(x => (x + 1) % (frames.length + 1)), 1600);
    return () => clearInterval(t);
  }, []);
  const f = frames[Math.min(i, frames.length - 1)];
  const over = f.bid >= LINE;
  return (
    <figure className="shot" aria-label="Illustration of Sutli closing a position when the odds cross the line">
      <div className="shot-bar"><span /><span /><span /><em>sutli-app.vercel.app</em></div>
      <div className="shot-body">
        <div className="shot-row">
          <div>
            <div className="shot-k">Fed hikes by more than 25bp on Dec 9?</div>
            <div className="shot-v mono">{f.bid.toFixed(1)}%</div>
          </div>
          <span className={`tag ${over ? "fired" : "armed"}`}>{over ? "line crossed" : "watching"}</span>
        </div>
        <div className="meter" aria-hidden>
          <div className="meter-fill" style={{ width: `${f.bid}%` }} data-over={over} />
          <div className="meter-line" style={{ left: `${LINE}%` }}><span>your line {LINE}%</span></div>
        </div>
        <div className="shot-pos">
          <span>SOL-PERP <span className="tag long">long 5x</span></span>
          <span className="mono">$1,240.00</span>
        </div>
        <div className={`shot-status s-${f.state}`} aria-live="off">
          {f.state === "waiting" && <>Holding. The keeper is watching the odds.</>}
          {f.state === "fire" && <>Line held for 3 polls. Simulating your signed order…</>}
          {f.state === "sent" && <>Sending the exact order you signed…</>}
          {f.state === "done" && <><CheckCircle2 size={14} aria-hidden /> Position closed at Jupiter's oracle price{units ? <span className="mono"> · {units.toLocaleString()} CU</span> : null}</>}
        </div>
      </div>
      <figcaption className="hint">Illustration of the flow. The live sandbox is below.</figcaption>
    </figure>
  );
}

function Ago({ at }: { at: number }) {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60_000));
  return <>{mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`}</>;
}

function ProofStrip({ proof, failed, onTry }: { proof: Proof | null; failed: boolean; onTry: () => void }) {
  const loading = !proof && !failed;
  return (
    <section className="proof-strip" aria-label="Live numbers">
      <div className="proof-cell">
        <div className="proof-k"><span className="live-dot" aria-hidden /> Kalshi · Fed hikes &gt;25bp on Dec 9</div>
        {loading ? <div className="skel" /> : proof?.fed ? (
          <div className="proof-v mono">{pct(proof.fed.bid)} <span className="hint">bid</span> / {pct(proof.fed.ask)} <span className="hint">ask</span></div>
        ) : <div className="hint">Unavailable right now</div>}
        <div className="hint">The market our example arms against</div>
      </div>
      <div className="proof-cell">
        <div className="proof-k"><span className="live-dot" aria-hidden /> Our pm-AMM demo market · devnet</div>
        {loading ? <div className="skel" /> : proof?.demo ? (
          <div className="proof-v mono">{pct(proof.demo.bid)} <span className="hint">YES bid</span></div>
        ) : <div className="hint">Unavailable right now</div>}
        {proof?.demo ? <a className="hint" href={accountLink(proof.demo.id, "devnet")} target="_blank" rel="noreferrer">View on Solscan</a> : <div className="hint">&nbsp;</div>}
      </div>
      <div className="proof-cell">
        <div className="proof-k">Last mainnet dry run</div>
        {loading ? <div className="skel" /> : proof?.lastDryRun ? (
          <div className="proof-v">{proof.lastDryRun.ok ? <span className="ok-text">Accepted</span> : <span className="bad-text">Rejected</span>}
            {proof.lastDryRun.unitsConsumed ? <span className="hint mono"> · {proof.lastDryRun.unitsConsumed.toLocaleString()} CU</span> : null}</div>
        ) : <div className="proof-v">None yet</div>}
        {proof?.lastDryRun ? <div className="hint"><Ago at={proof.lastDryRun.at} /></div> : <button className="link-btn hint" onClick={onTry}>Run one in the sandbox</button>}
      </div>
      {failed && <p className="hint proof-note">The keeper may be waking up on its free host. Numbers appear within a minute.</p>}
    </section>
  );
}

function FedStory({ fed }: { fed: ProofOdds | null }) {
  return (
    <Reveal as="section" className="band">
      <p className="eyebrow">Worked example</p>
      <h2 className="section-h">A SOL long into the Fed's December decision</h2>
      <ol className="timeline">
        <li>
          <span className="when mono">Before</span>
          <div><h3>You hold a 5x SOL long</h3>
            <p>A 25bp hike is priced in. A bigger one is not. Kalshi has the odds of a hike above 25bp on Dec 9 at <strong className="mono">{fed ? pct(fed.bid) : "a few percent"}</strong> right now.</p></div>
        </li>
        <li>
          <span className="when mono">Arm</span>
          <div><h3>You set the line once</h3>
            <p>Close my long if that YES price reaches <strong>20%</strong>, holds for 3 polls, with at least $500 of depth. One signature, then you can sleep.</p></div>
        </li>
        <li>
          <span className="when mono">If</span>
          <div><h3>The surprise becomes likely</h3>
            <p>Say a hot inflation print pushes the odds past 20%. The keeper sees the line hold, simulates your order, and sends it. Jupiter closes the position at its oracle price.</p></div>
        </li>
        <li>
          <span className="when mono">Dec 9</span>
          <div><h3>The decision lands</h3>
            <p>If the odds never moved, nothing happened and your long rode through. If they did, you were already out.</p></div>
        </li>
      </ol>
      <p className="hint">Steps two to four are an example, not a record. The odds in step one are live from Kalshi.</p>
    </Reveal>
  );
}

const FAQ: [string, string][] = [
  ["Can Sutli take my money?", "No. The order you sign contains one action that moves value: closing your own Jupiter position, with the proceeds going back to your wallet. There is no transfer in it, and a guard signature means nobody can add one."],
  ["What is the worst a hacked keeper could do?", "Send your order early, which closes your position at Jupiter's oracle price. It cannot change the order, close a different position, or touch other funds."],
  ["How do I cancel?", "Click Disarm. You sign one small transaction that advances your nonce, and the stored order can never land after that."],
  ["How is this different from a stop loss?", "A stop loss reacts to the price after it has moved. Sutli reacts to the probability of an event you choose, so you can step aside as the risk rises."],
  ["Does Sutli predict anything?", "No. It follows the odds a prediction market sets and acts on a line you choose. Odds and prices often move together; Sutli lets you decide your exit in terms of the event, ahead of time."],
  ["What does it cost?", `Solana network fees, a priority fee capped at ${maxFeeSol} SOL, and Jupiter's usual close fee. Sutli adds no fee of its own.`],
  ["Is it live?", "Arming works on Solana mainnet with a real Jupiter position. The sandbox uses our own pm-AMM market on devnet and a mainnet simulation, so you can try it without a wallet. There are no outside users yet."],
];

export function Landing({ onTry }: { onTry: () => void }) {
  const { proof, failed } = useProof();
  return (
    <div className="landing">
      <section className="hero" aria-labelledby="hero-h">
        <div className="hero-copy">
          <p className="eyebrow">For Jupiter Perps traders</p>
          <h2 id="hero-h" className="hero-h">
            <span className="l">Close your perp</span>{" "}<span className="l">when the news turns,</span>{" "}<span className="l">not after the price does.</span>
          </h2>
          <p className="hero-sub">
            Pick a prediction market and a line. Sign one close order in advance.
            When the odds cross your line, Sutli sends exactly that order and nothing else.
          </p>
          <div className="row" style={{ alignItems: "center", gap: "var(--s4)" }}>
            <button className="btn primary btn-lg" onClick={onTry}>Try it without a wallet <ArrowDown size={16} aria-hidden /></button>
            <a className="text-link" href="#how">How it works <ArrowRight size={14} aria-hidden /></a>
          </div>
          <p className="proof"><ShieldCheck size={14} aria-hidden /> Every order is simulated on Solana mainnet before the keeper accepts it.</p>
        </div>
        <HeroShot units={proof?.lastDryRun?.ok ? proof.lastDryRun.unitsConsumed : null} />
      </section>

      <ProofStrip proof={proof} failed={failed} onTry={onTry} />

      <Reveal as="section" className="steps-wrap">
        <p className="eyebrow" id="how">How it works</p>
        <h2 className="section-h">Three steps, one signature</h2>
        <ol className="steps">
          <li><span className="n mono">1</span><h3>Pick the event</h3><p>Choose a Kalshi, Polymarket, or pm-AMM market and the odds that should get you out.</p></li>
          <li><span className="n mono">2</span><h3>Sign once</h3><p>Your wallet signs one close order with a durable nonce. Nothing is sent, and it stays valid until you cancel.</p></li>
          <li><span className="n mono">3</span><h3>Sutli waits</h3><p>When the odds hold past your line, the keeper simulates the order, sends it, and Jupiter closes your position.</p></li>
        </ol>
      </Reveal>

      <FedStory fed={proof?.fed ?? null} />

      <section className="tagline-wrap" aria-label="Why Sutli">
        <TaglineReveal text="A stop loss waits for the price to fall. Sutli acts on the event that makes it fall." />
      </section>

      <Reveal as="section">
        <p className="eyebrow">Safety</p>
        <h2 className="section-h">What the order can and cannot do</h2>
        <div className="facts">
          <div className="fact"><Lock size={18} aria-hidden /><h3>Closes one position</h3><p>A Lighthouse check pins the exact position you armed. Close it and open a new one, and the old order fails.</p></div>
          <div className="fact"><Ban size={18} aria-hidden /><h3>Cannot move funds</h3><p>No transfer inside, and a guard key signs first, so no wallet or keeper can edit the order.</p></div>
          <div className="fact"><XCircle size={18} aria-hidden /><h3>Cancel any time</h3><p>Advancing your nonce kills the stored order. One signature.</p></div>
          <div className="fact"><Gauge size={18} aria-hidden /><h3>Ignores thin markets</h3><p>It reads the price you could trade at, waits for the line to hold, and skips books too shallow to trust.</p></div>
          <div className="fact"><Timer size={18} aria-hidden /><h3>Capped fees</h3><p>Priority fee is set when you sign and never exceeds {maxFeeSol} SOL.</p></div>
          <div className="fact"><KeyRound size={18} aria-hidden /><h3>Your keys stay yours</h3><p>The keeper holds signed bytes, never a key. The RPC key lives on the server, not in this page.</p></div>
        </div>
      </Reveal>

      <Reveal as="section" className="two-col">
        <div>
          <p className="eyebrow">Why Solana</p>
          <h2 className="section-h">Only practical here</h2>
        </div>
        <ul className="why">
          <li><strong>Durable nonces</strong> let a signed order wait for days and still land.</li>
          <li><strong>Jupiter Perps</strong> fills at its oracle price, so a close cannot be sandwiched.</li>
          <li><strong>pm-AMM</strong> puts prediction market odds on chain, readable by anyone.</li>
          <li><strong>Lighthouse</strong> lets the order check the chain before it acts, so a stale order fails safely.</li>
        </ul>
      </Reveal>

      <Reveal as="section" className="two-col">
        <div>
          <p className="eyebrow">Questions</p>
          <h2 className="section-h">Straight answers</h2>
        </div>
        <div className="faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </Reveal>

      <section className="final-cta band">
        <h2 className="section-h">See it close a real position, in simulation</h2>
        <p className="hint" style={{ margin: 0 }}>Two minutes, no wallet. Real devnet trades and a real mainnet simulation.</p>
        <button className="btn primary btn-lg" onClick={onTry}>Try it without a wallet <ArrowDown size={16} aria-hidden /></button>
      </section>
    </div>
  );
}
