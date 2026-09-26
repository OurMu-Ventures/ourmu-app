"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  releasePartnerPortalWelcomeCampaign,
  sendPartnerPortalWelcomeTest,
} from "@/actions/admin";

type Props = {
  status: string;
  expectedCount: number;
  complete: boolean;
};

type WorkerResult = {
  ok: boolean;
  jobs?: { processed: number; succeeded: number; failed: number };
  pending?: number;
  failed?: number;
  dead?: number;
  running?: number;
  sent?: number;
  error?: string;
};

export function PartnerPortalCampaignControls({
  status,
  expectedCount,
  complete,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function sendTest() {
    setBusy(true);
    setMessage("Sending the test email to your verified admin address…");
    try {
      const result = await sendPartnerPortalWelcomeTest();
      setMessage(result.message);
      router.refresh();
    } catch {
      setMessage("The test email could not be sent. Refresh and check the Resend setup.");
    } finally {
      setBusy(false);
    }
  }

  async function processBatches() {
    setBusy(true);
    setMessage("Sending emails in batches of 10…");
    let lastSent = 0;
    try {
      while (true) {
        const response = await fetch("/api/admin/announcements/welcome/process", {
          method: "POST",
          cache: "no-store",
        });
        const result = (await response.json()) as WorkerResult;
        if (!response.ok || !result.ok) {
          setMessage(result.error ?? "The email queue could not be processed.");
          break;
        }
        lastSent = result.sent ?? lastSent;
        if ((result.pending ?? 0) === 0 && (result.failed ?? 0) === 0 && (result.dead ?? 0) === 0 && (result.running ?? 0) === 0) {
          setMessage(`Complete: Resend accepted ${lastSent} of ${expectedCount} emails.`);
          break;
        }
        setMessage(`Sent ${lastSent} of ${expectedCount}; continuing with the next batch…`);
        if ((result.dead ?? 0) > 0 || (result.jobs?.processed ?? 0) === 0) {
          setMessage(`Paused after ${lastSent} of ${expectedCount}. Some messages need a retry; the queued jobs are still saved.`);
          break;
        }
      }
    } catch {
      setMessage(`Paused after ${lastSent} of ${expectedCount}. Your queued jobs are saved; you can resume here.`);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function releaseAndSend() {
    setBusy(true);
    setMessage("Queueing the reviewed audience…");
    try {
      const result = await releasePartnerPortalWelcomeCampaign(expectedCount);
      if (!result.ok) {
        setMessage(result.message);
        setBusy(false);
        router.refresh();
        return;
      }
      setMessage(`Campaign queued for ${expectedCount} accounts. Sending batches of 10…`);
      await processBatches();
    } catch {
      setMessage("The campaign could not be queued. Refresh to check its current status.");
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="card" aria-live="polite">
      {status === "draft" && (
        <button className="button" disabled={busy} onClick={sendTest}>
          {busy ? "Working…" : "Send test to my admin email"}
        </button>
      )}
      {status === "test_sent" && (
        <button className="button" disabled={busy} onClick={releaseAndSend}>
          {busy ? "Working…" : `Release and send to ${expectedCount} accounts`}
        </button>
      )}
      {status === "released" && !complete && (
        <button className="button" disabled={busy} onClick={processBatches}>
          {busy ? "Sending batch…" : "Continue sending queued batches"}
        </button>
      )}
      {status === "released" && complete && <p>All campaign emails are processed.</p>}
      {message && <p className="muted" role="status">{message}</p>}
    </div>
  );
}
