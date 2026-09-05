import { getAgreementDownloadUrl } from "@/actions/investments";
import { requireInvestor } from "@/lib/auth";

export default async function AgreementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireInvestor();
  const { id } = await params;
  const url = await getAgreementDownloadUrl(id);
  return (
    <>
      <p className="eyebrow">Private document</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>
        Investment agreement
      </h1>
      {url ? (
        <>
          <p>
            Your activated agreement is ready. The download link expires after
            60 seconds.
          </p>
          <a className="button" href={url} rel="noreferrer">
            Download PDF
          </a>
        </>
      ) : (
        <p className="notice">
          The final PDF is generated after activation. If generation failed,
          OURMU staff can retry it without reversing your investment.
        </p>
      )}
    </>
  );
}
