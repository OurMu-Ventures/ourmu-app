import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LinkStatus } from "@/components/ui/link-status";
export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" href="/">
        <Image
          src="/logos/ourmu-mark-white.jpg"
          alt=""
          width={29}
          height={40}
          priority
          className="brand-mark"
        />
        <span>OURMU</span>
        <LinkStatus label="Loading homepage" />
      </Link>
      <nav className="top-nav" aria-label="Main navigation">
        <Link className="optional" href="/risk-disclosure">
          Risk <LinkStatus label="Opening risk disclosure" />
        </Link>
        <Link className="optional" href="/privacy">
          Privacy <LinkStatus label="Opening privacy notice" />
        </Link>
        <Button asChild variant="secondary">
          <Link href="/login">
            Investor login <LinkStatus label="Opening login" />
          </Link>
        </Button>
      </nav>
    </header>
  );
}
