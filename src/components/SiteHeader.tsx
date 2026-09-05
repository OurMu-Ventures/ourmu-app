import Image from "next/image";
import Link from "next/link";
export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" href="/">
        <Image
          src="/logos/ourmu-color.png"
          alt="OURMU"
          width={46}
          height={46}
          priority
        />
        <span>OURMU</span>
      </Link>
      <nav className="top-nav" aria-label="Main navigation">
        <Link className="optional" href="/risk-disclosure">
          Risk
        </Link>
        <Link className="optional" href="/privacy">
          Privacy
        </Link>
        <Link className="button-secondary" href="/login">
          Investor login
        </Link>
      </nav>
    </header>
  );
}
