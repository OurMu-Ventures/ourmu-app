import { getReceiptDownloadUrl } from "@/actions/receipts";
import { requireInvestor } from "@/lib/auth";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireInvestor();
  const { id } = await params;
  const url = await getReceiptDownloadUrl(id);
  return (
    <>
      <p className="eyebrow">Investment receipt</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Receipt</h1>
      {url ? (
        <>
          <p>
            Your receipt is ready. The download link expires after 60 seconds.
          </p>
          <a className="button" href={url} rel="noreferrer">
            Download receipt PDF
          </a>
        </>
      ) : (
        <p className="notice">
          The receipt PDF is generating or generation failed. If it failed,
          OURMU staff can retry it without reversing your investment — check
          back shortly.
        </p>
      )}
    </>
  );
}
