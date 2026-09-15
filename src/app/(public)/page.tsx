import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { FishExperience } from "@/components/FishExperience";
import { Button } from "@/components/ui/button";
import { LinkStatus } from "@/components/ui/link-status";
import { createClient } from "@/lib/supabase/server";
import { getHomeDestination } from "@/lib/redirect";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let destination: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role,access_status,is_test")
      .eq("id", user.id)
      .maybeSingle();

    if (profile) {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const aal2 = aal?.currentLevel === "aal2";
      destination = getHomeDestination(profile, aal2);
    }
  }

  if (destination) redirect(destination);

  return (
    <main id="main">
      <section className="container hero">
        <div>
          <Image
            src="/logos/ourmu-white.jpg"
            alt="OURMU logo"
            width={240}
            height={162}
            preload
            className="hero-logo"
          />
          <p className="eyebrow">Private partner access</p>
          <h1>Grow with Uganda&apos;s aquaculture future.</h1>
          <div className="hero-actions">
            <Button asChild>
              <Link href="/login">
                Partner login <LinkStatus label="Opening login" />
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/risk-disclosure">
                Read the risk disclosure{" "}
                <LinkStatus label="Opening risk disclosure" />
              </Link>
            </Button>
          </div>
        </div>
        <FishExperience />
      </section>
    </main>
  );
}
