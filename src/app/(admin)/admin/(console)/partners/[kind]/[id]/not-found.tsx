import Link from "next/link";
export default function PartnerPortfolioNotFound() {
  return (
    <div className="card">
      <h1>Partner not found</h1>
      <p>
        This portfolio link is invalid, or the partner record no longer exists.
      </p>
      <Link className="button" href="/admin/partners">
        Find a partner
      </Link>
    </div>
  );
}
