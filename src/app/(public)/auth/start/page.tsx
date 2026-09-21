import type { Metadata } from "next";

import { FishExperience } from "@/components/FishExperience";
import { AuthStartClient } from "@/components/AuthStartClient";

export const metadata: Metadata = {
  title: "Continue securely",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function AuthStartPage() {
  return (
    <main id="main">
      <section className="container hero">
        <div>
          <p className="eyebrow">Secure sign-in</p>
          <h1>Almost there, Partner.</h1>
          <AuthStartClient />
        </div>
        <FishExperience />
      </section>
    </main>
  );
}
