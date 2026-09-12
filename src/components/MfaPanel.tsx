"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/browser";

// Log only stable provider codes/statuses, never whole Auth error objects
// and never the one-time code.
function logCode(context: string, error: unknown) {
  const code =
    typeof error === "object" && error !== null
      ? ((error as { code?: unknown }).code ??
        (error as { status?: unknown }).status)
      : undefined;
  console.error(context, code ?? "unknown");
}

export function MfaPanel({ target }: { target: string }) {
  const [factorId, setFactorId] = useState("");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading MFA status…");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const supabase = createClient();
        const { data, error: listError } =
          await supabase.auth.mfa.listFactors();
        if (listError) {
          logCode("MFA listFactors failed", listError);
          if (!cancelled)
            setMessage("MFA status could not be loaded. Reload to retry.");
          return;
        }
        const factors = Array.isArray(data?.totp) ? data.totp : [];
        const verified = factors.find(
          (factor: { status: string; id: string }) =>
            factor.status === "verified",
        );
        if (verified) {
          if (!cancelled) {
            setFactorId(verified.id);
            setMessage("Enter the current six-digit code.");
          }
          return;
        }
        const enrolled = await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "OURMU admin",
        });
        if (enrolled.error || !enrolled.data) {
          logCode("MFA enroll failed", enrolled.error);
          if (!cancelled)
            setMessage("MFA enrollment could not be started. Reload to retry.");
          return;
        }
        if (!cancelled) {
          setFactorId(enrolled.data.id);
          setQr(enrolled.data.totp.qr_code);
          setMessage(
            "Scan this QR code with your authenticator app, then enter the code.",
          );
        }
      } catch (error) {
        logCode("MFA status failed", error);
        if (!cancelled)
          setMessage("MFA status could not be loaded. Reload to retry.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  async function verify() {
    if (busy) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (!challenge.data) {
        logCode("MFA challenge failed", challenge.error);
        setMessage("Could not create MFA challenge. Try again.");
        return;
      }
      const result = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code,
      });
      if (result.error) {
        logCode("MFA verify rejected", result.error);
        setMessage("That code was not accepted. Check the code and try again.");
        return;
      }
      // One deterministic full navigation so the server reads the newly
      // written AAL2 cookie. No client-side refresh: racing it against the
      // navigation replays the pre-verification session.
      window.location.replace(target);
    } catch (error) {
      logCode("MFA verify failed", error);
      setMessage("Something went wrong while verifying. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card form">
      {qr && (
        <Image
          unoptimized
          src={qr}
          alt="TOTP enrollment QR code"
          width={220}
          height={220}
        />
      )}
      <p role="status">{message}</p>
      <label>
        Six-digit code
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          disabled={busy}
          onChange={(event) =>
            setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
          }
        />
      </label>
      <button
        className="button"
        type="button"
        disabled={!factorId || code.length !== 6 || busy}
        onClick={verify}
      >
        {busy ? "Checking…" : "Verify administrator MFA"}
      </button>
    </div>
  );
}
