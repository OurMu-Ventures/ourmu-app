import { AppShell } from "@/components/AppShell";
import { requireInvestor } from "@/lib/auth";

export default async function PartnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireInvestor();
  return (
    <AppShell>
      <div className="page-head">
        <div>
          <p className="eyebrow">Partner portal</p>
          <strong>{profile.legal_name}</strong>
        </div>
      </div>
      {children}
    </AppShell>
  );
}
