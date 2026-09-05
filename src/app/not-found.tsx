import Link from "next/link";
export default function NotFound() {
  return (
    <main id="main" className="narrow">
      <h1>Not available</h1>
      <p>The link may be invalid, expired, already used, or revoked.</p>
      <Link className="button-secondary" href="/">
        Return home
      </Link>
    </main>
  );
}
