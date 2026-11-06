/* eslint-disable @next/next/no-img-element -- Private previews avoid paid image transformations. */
"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import {
  listDepositSlips,
  reserveDepositSlip,
  finalizeDepositSlip,
  removeDepositSlip,
  viewDepositSlip,
} from "@/actions/deposit-slips";
import type { DepositSlip } from "@/lib/deposit-slips";
async function prepare(file: File): Promise<Blob> {
  if (file.type === "application/pdf") return file;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error(
      "Use JPEG, PNG, WebP or PDF. For HEIC, export a JPEG or take a screenshot.",
    );
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare photo.");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let blob: Blob | null = null;
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (blob && blob.size <= 1048576) break;
  }
  if (!blob || blob.size > 1048576)
    throw new Error("Please crop the photo or choose a smaller image.");
  return blob;
}
export function DepositSlips({
  investmentId,
  admin = false,
  uploadsEnabled = false,
  initialFiles,
}: {
  investmentId: string;
  admin?: boolean;
  uploadsEnabled?: boolean;
  initialFiles?: DepositSlip[];
}) {
  const [files, setFiles] = useState<DepositSlip[]>(initialFiles ?? []);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState<{ url: string; mime: string } | null>(
    null,
  );
  async function refresh() {
    setFiles(await listDepositSlips(investmentId));
  }
  useEffect(() => {
    if (initialFiles !== undefined) return;
    let current = true;
    listDepositSlips(investmentId)
      .then((d) => {
        if (current) setFiles(d);
      })
      .catch(() => {
        if (current) setMessage("Attachments are temporarily unavailable.");
      });
    return () => {
      current = false;
    };
  }, [investmentId, initialFiles]);
  async function upload(file: File) {
    setBusy(true);
    setMessage("");
    setProgress(0);
    let slot: DepositSlip | undefined;
    try {
      const blob = await prepare(file);
      if (blob.size > 2097152) throw new Error("Choose a file up to 2 MiB.");
      slot = await reserveDepositSlip(investmentId, blob.type, blob.size);
      const client = createClient();
      const {
        data: { session },
      } = await client.auth.getSession();
      if (!session) throw new Error("Please sign in again.");
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(
          "POST",
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/deposit-slips/${slot!.path}`,
        );
        xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
        xhr.setRequestHeader(
          "apikey",
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        );
        xhr.setRequestHeader("Content-Type", blob.type);
        xhr.timeout = 120000;
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(
                new Error("Upload failed. Please select the file to retry."),
              );
        xhr.onerror = () =>
          reject(
            new Error("Connection lost. Please select the file to retry."),
          );
        xhr.ontimeout = () =>
          reject(
            new Error("Upload timed out. Please select the file to retry."),
          );
        xhr.send(blob);
      });
      await finalizeDepositSlip(investmentId, slot.id);
      await refresh();
      setMessage("Deposit slip saved to this reservation.");
    } catch (error) {
      if (slot) await removeDepositSlip(investmentId, slot.id).catch(() => {});
      setMessage(
        error instanceof Error ? error.message : "Upload failed. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card" id="deposit-slips" style={{ marginTop: "1rem" }}>
      <h2>
        {admin ? "Deposit slips" : "Deposit slip (optional)"} · {files.length}/3
      </h2>
      {!admin && uploadsEnabled && (
        <>
          <p>
            Already made your bank deposit? You can share your slip here instead
            of sending it by WhatsApp or email. Uploading is optional and does
            not confirm payment. Files are removed when your reservation is
            resolved or after 30 days. Keep your own copy.
          </p>
          <p>
            Up to three photos or PDFs, 2 MiB per file. Photos are compressed
            before upload. For HEIC, export a JPEG or take a screenshot.
          </p>
          <label className="button-secondary">
            Choose photo or PDF
            <input
              aria-label="Choose deposit slip"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              disabled={busy || files.length >= 3}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void upload(f);
              }}
            />
          </label>
        </>
      )}
      {busy && (
        <progress aria-label="Upload progress" max={100} value={progress} />
      )}
      <p role="status">{message}</p>
      {files.map((file, index) => (
        <div key={file.id}>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              try {
                setPreview({
                  url: await viewDepositSlip(investmentId, file.id),
                  mime: file.mime,
                });
              } catch {
                setMessage("Attachment unavailable. Refresh and try again.");
              }
            }}
          >
            View {file.mime === "application/pdf" ? "PDF" : "photo"} {index + 1}
          </button>
          {!admin && uploadsEnabled && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await removeDepositSlip(investmentId, file.id);
                  setPreview(null);
                  await refresh();
                  setMessage("Attachment removed.");
                } catch {
                  setMessage("Could not remove attachment.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Remove attachment {index + 1}
            </button>
          )}
        </div>
      ))}
      {preview && (
        <div>
          <button type="button" onClick={() => setPreview(null)}>
            Close preview
          </button>
          {preview.mime === "application/pdf" ? (
            <iframe
              title="Deposit slip PDF"
              src={preview.url}
              style={{ width: "100%", height: 500 }}
            />
          ) : (
            <img
              alt="Uploaded deposit slip"
              src={preview.url}
              style={{ maxWidth: "100%", maxHeight: 600 }}
            />
          )}
          <p>
            Preview links expire after one minute. Open the attachment again if
            needed.
          </p>
        </div>
      )}
    </section>
  );
}
