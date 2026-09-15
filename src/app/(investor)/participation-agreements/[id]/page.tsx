import { notFound } from "next/navigation";

import { AgreementDocument } from "@/components/AgreementDocument";
import { requireInvestor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function ParticipationAgreementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireInvestor();
  const { id } = await params;
  const supabase = await createClient();
  const { data: agreement } = await supabase
    .from("agreement_versions")
    .select("title,version,template_markdown")
    .eq("id", id)
    .eq("is_legally_approved", true)
    .not("published_at", "is", null)
    .maybeSingle();

  if (!agreement) notFound();

  return (
    <>
      <p className="eyebrow">Agreement version {agreement.version}</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>
        {agreement.title}
      </h1>
      <p className="notice">
        Review this agreement before accepting it. Details shown in double
        braces are filled from your investment request in the final agreement.
      </p>
      <AgreementDocument markdown={agreement.template_markdown} />
    </>
  );
}
