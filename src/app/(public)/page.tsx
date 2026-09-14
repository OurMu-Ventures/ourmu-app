import Image from "next/image";
import Link from "next/link";
import { FishExperience } from "@/components/FishExperience";
import { Button } from "@/components/ui/button";
import { LinkStatus } from "@/components/ui/link-status";

export default function HomePage() {
  return (
    <main id="main">
      <section className="container hero">
        <div>
          <Image
            src="/logos/ourmu-white.jpg"
            alt="OURMU logo"
            width={240}
            height={162}
            priority
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
