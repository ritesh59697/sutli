import { useEffect, useRef, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { ArmFlow } from "./ArmFlow";
import { WalletTest } from "./WalletTest";
import { OrdersPanel } from "./OrdersPanel";
import { TryIt } from "./TryIt";
import { Landing } from "./Landing";
import { Code2 } from "lucide-react";
import { config } from "../../src/core/config";

type Mode = "try" | "arm" | "test";
const MODES: Mode[] = ["try", "arm", "test"];
const fromHash = (): Mode => {
  const h = location.hash.slice(1) as Mode;
  return MODES.includes(h) ? h : "try";
};

export function App() {
  const [mode, setModeState] = useState<Mode>(fromHash);
  const setMode = (m: Mode) => { setModeState(m); history.replaceState(null, "", `#${m}`); };
  const [ordersVersion, setOrdersVersion] = useState(0);
  const appRef = useRef<HTMLElement>(null);
  // A link that names a tab (#try, #arm, #test) opens straight at the app.
  useEffect(() => { if (location.hash.length > 1) appRef.current?.scrollIntoView(); }, []);
  const goTry = () => {
    setModeState("try");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    appRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
    // Updating the URL mid-scroll cancels a smooth scroll in Chrome, so do it once the scroll ends.
    const setHash = () => history.replaceState(null, "", "#try");
    if (reduce || !("onscrollend" in window)) setHash();
    else window.addEventListener("scrollend", setHash, { once: true });
  };
  return (
    <>
      <a className="skip" href="#app">Skip to the app</a>
      <div className="shell">
        <header className="top">
          <div className="brand">
            <h1>Sutli<span className="fuse" aria-hidden /></h1>
            <p>Close your perp when the odds turn.</p>
          </div>
          <div className="row" style={{ alignItems: "center" }}>
            <a className="btn" href={config.repoUrl} target="_blank" rel="noreferrer" ><Code2 size={16} aria-hidden /> Code</a>
            <button className="btn" onClick={goTry}>Try it</button>
          </div>
        </header>
        <main>
          <Landing onTry={goTry} />
          <section id="app" ref={appRef} className="app-anchor" aria-label="Sutli app">
            <div className="top" style={{ borderBottom: 0, paddingBottom: 0, marginTop: "var(--s12)" }}>
              <div className="tabs" role="group" aria-label="Mode">
                <button aria-pressed={mode === "try"} onClick={() => setMode("try")}>Try it</button>
                <button aria-pressed={mode === "arm"} onClick={() => setMode("arm")}>Arm a position</button>
                <button aria-pressed={mode === "test"} onClick={() => setMode("test")}>Wallet test</button>
              </div>
              {mode !== "try" && <WalletMultiButton />}
            </div>
            {mode === "try" && <TryIt />}
            {mode === "arm" && (
              <>
                <ArmFlow onArmed={() => setOrdersVersion(v => v + 1)} />
                <OrdersPanel version={ordersVersion} />
              </>
            )}
            {mode === "test" && <WalletTest />}
          </section>
        </main>
        <footer className="foot">
          <span>Sutli. Built for the Solana Perps and Prediction Markets hackathon. <a href={config.repoUrl} target="_blank" rel="noreferrer">Source on GitHub</a></span>
          <span className="hint" style={{ margin: 0 }}>Not financial advice. Trading perps can lose you money.</span>
        </footer>
      </div>
    </>
  );
}
