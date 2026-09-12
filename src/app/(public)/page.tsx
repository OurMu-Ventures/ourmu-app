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
          <p className="lead">
            A focused portal for invited OURMU partners to apply, reserve units
            in an open cycle, record agreement acceptance, and follow an
            externally verified bank-transfer investment.
          </p>
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
      <section className="container">
        <div className="grid">
          <article className="card">
            <p className="eyebrow">01</p>
            <h2>Invite only</h2>
            <p className="muted">
              Applications begin with a one-use, email-bound link issued by
              OURMU staff.
            </p>
          </article>
          <article className="card">
            <p className="eyebrow">02</p>
            <h2>Bank transfer</h2>
            <p className="muted">
              The portal does not move money. Staff activate only after an exact
              bank transfer is verified offline.
            </p>
          </article>
          <article className="card">
            <p className="eyebrow">03</p>
            <h2>Clear records</h2>
            <p className="muted">
              Terms are snapshotted, acceptance is recorded, and the final
              agreement is stored privately.
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}
