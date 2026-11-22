import { useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { ArmFlow } from "./ArmFlow";
import { WalletTest } from "./WalletTest";
import { OrdersPanel } from "./OrdersPanel";

type Mode = "arm" | "test";

export function App() {
  const [mode, setModeState] = useState<Mode>(() => (location.hash === "#test" ? "test" : "arm"));
  const setMode = (m: Mode) => { setModeState(m); history.replaceState(null, "", m === "test" ? "#test" : "#"); };
  const [ordersVersion, setOrdersVersion] = useState(0);
  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <h1>Sutli<span className="fuse" aria-hidden /></h1>
          <p>Your perp closes itself when the odds turn, not when the price does.</p>
        </div>
        <div className="row" style={{ alignItems: "center" }}>
          <div className="tabs" role="group" aria-label="Mode">
            <button aria-pressed={mode === "arm"} onClick={() => setMode("arm")}>Arm a position</button>
            <button aria-pressed={mode === "test"} onClick={() => setMode("test")}>Wallet test (devnet)</button>
          </div>
          <WalletMultiButton />
        </div>
      </header>
      {mode === "arm" ? (
        <>
          <ArmFlow onArmed={() => setOrdersVersion(v => v + 1)} />
          <OrdersPanel version={ordersVersion} />
        </>
      ) : (
        <WalletTest />
      )}
    </div>
  );
}
