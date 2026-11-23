// Landing section above the app. One action: try the no-wallet sandbox.
// Copy is kept factual: the demo market is on devnet, the dry run is a mainnet simulation, no users yet.
import { useEffect, useRef, type ReactNode } from "react";
import { ArrowDown, Ban, Gauge, KeyRound, Lock, ShieldCheck, Timer, XCircle } from "lucide-react";
import { config } from "../../src/core/config";

const maxFeeSol = config.priorityFee.maxPriorityLamports / 1e9;

/** Fade up once when scrolled into view (IntersectionObserver, no scroll listener). */
function Reveal({ children, as: Tag = "div", className = "" }: { children: ReactNode; as?: "div" | "section" | "li"; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { el.dataset.shown = "true"; io.disconnect(); } }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref as any} className={`reveal ${className}`}>{children}</Tag>;
}

/** Each word lights up in reading order as it crosses a trigger line near the middle of the screen. */
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
  return (
    <p ref={ref} className="tagline">
      {text.split(" ").map((w, i) => <span key={i} className="w">{w} </span>)}
    </p>
  );
}

const SIGNED = [
  ["System", "Advance nonce", "makes the order usable once, at any time"],
  ["Compute budget", "Set compute limit", "fixed in advance"],
  ["Compute budget", "Set priority fee", `capped at ${maxFeeSol} SOL`],
  ["Memo", "Guard signature", "a second key signs first, so nobody can edit it"],
  ["Lighthouse", "Only if this position is still open", "pinned to its opening time"],
  ["Jupiter Perps", "Close entire position", "at Jupiter's oracle price"],
] as const;

const FAQ: [string, string][] = [
  ["Can Sutli take my money?", "No. The order you sign contains one action that moves value: closing your own Jupiter position, with the proceeds going back to your wallet. There is no transfer in it, and a guard signature means nobody can add one."],
  ["What is the worst a hacked keeper could do?", "Send your order early, which closes your position at Jupiter's oracle price. It cannot change the order, close a different position, or touch other funds."],
  ["How do I cancel?", "Click Disarm. You sign one small transaction that advances your nonce, and the stored order can never land after that."],
  ["How is this different from a stop loss?", "A stop loss reacts to the price after it has moved. Sutli reacts to an event, measured by a prediction market you choose, so you can step aside on the news itself."],
  ["What does it cost?", `Solana network fees, a priority fee capped at ${maxFeeSol} SOL, and Jupiter's usual close fee. Sutli adds no fee of its own.`],
  ["Is it live?", "Arming works on Solana mainnet with a real Jupiter position. The sandbox on this page uses our own pm-AMM market on devnet and a mainnet simulation, so you can try it without a wallet. There are no outside users yet."],
  ["Which markets can trigger a close?", "Kalshi, Polymarket, and pm-AMM markets on Solana. Sutli reads the side of the book you could actually trade at and ignores markets too thin to trust."],
];

export function Landing({ onTry }: { onTry: () => void }) {
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
          <div className="row" style={{ alignItems: "center" }}>
            <button className="btn primary btn-lg" onClick={onTry}>Try it without a wallet <ArrowDown size={16} aria-hidden /></button>
          </div>
          <p className="proof"><ShieldCheck size={14} aria-hidden /> Every order is simulated on Solana mainnet before the keeper accepts it.</p>
        </div>
        {/* Above the fold: shown immediately, never animated in. */}
        <div className="hero-card panel">
          <div className="hint" style={{ margin: 0 }}>The one order you sign</div>
          <ol className="signed-list">
            {SIGNED.map(([prog, action, why], i) => (
              <li key={i}>
                <span className="n mono">{i + 1}</span>
                <div><strong>{action}</strong> <span className="hint">{prog}</span><div className="hint" style={{ margin: 0 }}>{why}</div></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <Reveal as="section" className="steps-wrap">
        <h2 className="section-h">How it works</h2>
        <ol className="steps">
          <li><span className="n mono">1</span><h3>Pick the event</h3><p>Choose a Kalshi, Polymarket, or pm-AMM market and the odds that should get you out.</p></li>
          <li><span className="n mono">2</span><h3>Sign once</h3><p>Your wallet signs one close order with a durable nonce. Nothing is sent, and it stays valid until you cancel.</p></li>
          <li><span className="n mono">3</span><h3>Sutli waits</h3><p>When the odds hold past your line, the keeper simulates the order, sends it, and Jupiter closes your position.</p></li>
        </ol>
      </Reveal>

      <section className="tagline-wrap" aria-label="Why Sutli">
        <TaglineReveal text="A stop loss waits for the price to fall. Sutli acts on the event that makes it fall." />
      </section>

      <Reveal as="section">
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

      <Reveal as="section">
        <h2 className="section-h">Why Solana</h2>
        <ul className="why">
          <li><strong>Durable nonces</strong> let a signed order wait for days and still land.</li>
          <li><strong>Jupiter Perps</strong> fills at its oracle price, so a close cannot be sandwiched.</li>
          <li><strong>pm-AMM</strong> puts prediction market odds on chain, readable by anyone.</li>
          <li><strong>Fast blocks</strong> mean the close lands seconds after the line is crossed.</li>
        </ul>
      </Reveal>

      <Reveal as="section">
        <h2 className="section-h">Questions</h2>
        <div className="faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </Reveal>

      <section className="final-cta">
        <h2 className="section-h">See it close a real position, in simulation</h2>
        <button className="btn primary btn-lg" onClick={onTry}>Try it without a wallet <ArrowDown size={16} aria-hidden /></button>
      </section>
    </div>
  );
}
