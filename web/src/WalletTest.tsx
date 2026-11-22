// Free check on devnet: does this wallet sign a durable-nonce transaction without changing it,
// and does that signed transaction still land later?
import { useEffect, useState } from "react";

const NONCE_KEY = "sutli.devnetNonce";
import { useWallet } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { CheckCircle2, Circle, KeyRound, Loader2, PenLine, Send } from "lucide-react";
import { buildCreateNonceTx, buildPinnedTx, diffTx, guardMemo, readNonce, verifySigned } from "../../src/core/order";
import { config } from "../../src/core/config";
import { accountLink, devnet, errMsg, short, signAndSend, txLink, waitForSignature } from "./lib";

export function WalletTest() {
  const { publicKey, signTransaction, wallet } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [nonce, setNonceState] = useState<{ account: string; value: string } | null>(null);
  const setNonce = (n: { account: string; value: string } | null) => {
    setNonceState(n);
    try { n ? localStorage.setItem(NONCE_KEY, n.account) : localStorage.removeItem(NONCE_KEY); } catch { /* storage unavailable */ }
  };
  // Reuse the devnet nonce account across reloads (its current value is re-read from chain).
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(NONCE_KEY); } catch { /* storage unavailable */ }
    if (!saved || !publicKey) return;
    readNonce(devnet, new PublicKey(saved)).then(n => {
      if (n && n.authority === publicKey.toBase58()) setNonceState({ account: saved!, value: n.value });
    }).catch(() => {});
  }, [publicKey?.toBase58()]);
  const [signed, setSigned] = useState<{ tx: Transaction; signedAt: number } | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [landed, setLanded] = useState<{ sig: string; waitedSec: number } | null>(null);

  const run = async (b: string, fn: () => Promise<void>) => {
    setBusy(b); setError(null);
    try { await fn(); } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  };

  const checkBalance = () => run("bal", async () => { if (publicKey) setBalance((await devnet.getBalance(publicKey)) / 1e9); });

  const createNonce = () => run("nonce", async () => {
    if (!publicKey || !signTransaction) throw new Error("Connect a wallet first.");
    const { tx, nonce: kp } = await buildCreateNonceTx(devnet, publicKey);
    await signAndSend(devnet, tx, signTransaction, [kp]);
    const n = await readNonce(devnet, kp.publicKey);
    if (!n) throw new Error("Nonce account was not created.");
    setNonce({ account: kp.publicKey.toBase58(), value: n.value });
    setSigned(null); setVerdict(null); setLanded(null);
  });

  const preSign = (coSign: boolean) => run("sign", async () => {
    if (!publicKey || !signTransaction || !nonce) return;
    const memo = new TransactionInstruction({
      programId: new PublicKey(config.walletTest.memoProgramId),
      keys: [{ pubkey: publicKey, isSigner: true, isWritable: false }],
      data: Buffer.from(`sutli wallet test ${new Date().toISOString()}`),
    });
    const body = [memo];
    const guard = coSign ? Keypair.generate() : null;
    if (guard) body.push(guardMemo(new PublicKey(config.walletTest.memoProgramId), guard.publicKey, "sutli guard"));
    const tx = buildPinnedTx(publicKey, new PublicKey(nonce.account), nonce.value, body);
    if (guard) tx.partialSign(guard); // signs the final message first, so the wallet cannot change it
    const expected = Transaction.populate(tx.compileMessage());
    const out = await signTransaction(tx);
    const v = verifySigned(expected, out);
    const name = wallet?.adapter.name ?? "Wallet";
    setVerdict(v.ok
      ? `${name} signed the nonce transaction${guard ? " (with a co-signer)" : ""} and returned it unchanged.`
      : `Problem${guard ? " (with a co-signer)" : ""}: ${v.reason} ${diffTx(expected, out).join("; ")}`);
    if (v.ok) setSigned({ tx: out, signedAt: Date.now() });
  });

  const sendLater = () => run("send", async () => {
    if (!signed || !nonce) return;
    const sig = await devnet.sendRawTransaction(signed.tx.serialize());
    await waitForSignature(devnet, sig);
    setLanded({ sig, waitedSec: Math.round((Date.now() - signed.signedAt) / 1000) });
  });

  const steps = [
    { done: !!nonce, icon: KeyRound, label: "Create a devnet nonce account", act: createNonce, key: "nonce", can: !!publicKey && !nonce },
    { done: !!signed, icon: PenLine, label: "Pre-sign a memo with that nonce", act: () => preSign(false), key: "sign", can: !!nonce && !signed },
    { done: !!signed, icon: PenLine, label: "Pre-sign again with a co-signer (if the plain one was changed)", act: () => preSign(true), key: "sign2", can: !!nonce && !signed },
    { done: !!landed, icon: Send, label: "Wait a few minutes, then send it", act: sendLater, key: "send", can: !!signed && !landed },
  ];

  return (
    <div className="grid">
      <section className="panel" aria-labelledby="wt-h">
        <h2 id="wt-h">Wallet test on devnet</h2>
        <p className="hint">
          Free, and no Jupiter involved. This checks the one thing Sutli depends on: your wallet signs a durable-nonce transaction without changing it, and the signed transaction still lands minutes later. You need about 0.01 devnet SOL from <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a>.
        </p>
        <div className="row" style={{ alignItems: "center", marginBottom: "var(--s4)" }}>
          <button className="btn" onClick={checkBalance} disabled={!publicKey || busy !== null}>Check devnet balance</button>
          {balance !== null && <span className="mono">{balance.toFixed(4)} SOL</span>}
        </div>
        <ol className="checklist">
          {steps.map(s => (
            <li key={s.key}>
              <span className={`state ${s.done ? "done" : ""}`}>{s.done ? <CheckCircle2 size={18} aria-hidden /> : <Circle size={18} aria-hidden />}</span>
              <div className="title">{s.label}</div>
              <button className="btn" onClick={s.act} disabled={!s.can || busy !== null}>{busy === s.key ? <Loader2 size={14} aria-hidden /> : <s.icon size={14} aria-hidden />} Go</button>
            </li>
          ))}
        </ol>
        {error && <div className="notice bad" role="alert">{error}</div>}
      </section>
      <section className="panel" aria-labelledby="wr-h">
        <h2 id="wr-h">Result</h2>
        {!nonce && !verdict && <p className="empty">Run the three steps on the left.</p>}
        {nonce && <p className="hint">Nonce account <a className="mono" href={accountLink(nonce.account, "devnet")} target="_blank" rel="noreferrer">{short(nonce.account)}</a></p>}
        {verdict && <div className={`notice ${verdict.startsWith("Problem") ? "bad" : "ok"}`}>{verdict}</div>}
        {landed && <div className="notice ok">Landed {landed.waitedSec}s after signing: <a href={txLink(landed.sig, "devnet")} target="_blank" rel="noreferrer">view on Solscan</a>. Pre-signing works with this wallet.</div>}
      </section>
    </div>
  );
}
