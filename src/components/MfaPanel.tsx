"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export function MfaPanel({ target }: { target: string }) {
  const router = useRouter();
  const [factorId, setFactorId] = useState("");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("Loading MFA status…");
  useEffect(() => {
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp.find(
        (factor: { status: string; id: string }) =>
          factor.status === "verified",
      );
      if (verified) {
        setFactorId(verified.id);
        setMessage("Enter the current six-digit code.");
        return;
      }
      const enrolled = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "OURMU admin",
      });
      if (enrolled.data) {
        setFactorId(enrolled.data.id);
        setQr(enrolled.data.totp.qr_code);
        setMessage(
          "Scan this QR code with your authenticator app, then enter the code.",
        );
      } else setMessage("MFA enrollment could not be started.");
    })();
  }, []);
  async function verify() {
    const supabase = createClient();
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (!challenge.data) {
      setMessage("Could not create MFA challenge.");
      return;
    }
    const result = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code,
    });
    if (result.error) setMessage("That code was not accepted.");
    else {
      // Replace so the MFA page leaves no history entry, then refresh so
      // the verified session is reflected immediately.
      router.replace(target);
      router.refresh();
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
      <p>{message}</p>
      <label>
        Six-digit code
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(event) =>
            setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
          }
        />
      </label>
      <button
        className="button"
        type="button"
        disabled={!factorId || code.length !== 6}
        onClick={verify}
      >
        Verify administrator MFA
      </button>
    </div>
  );
}
