"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function PartnerPortfolioError({
  retry,
}: {
  retry: () => void;
}) {
  return (
    <div className="card" role="alert">
      <h1>Portfolio unavailable</h1>
      <p>We couldn’t load this portfolio. Please try again.</p>
      <p className="admin-investment-filter-actions">
        <Button type="button" onClick={() => retry()}>
          Try again
        </Button>
        <Link className="text-link" href="/admin/partners">
          Find a partner
        </Link>
      </p>
    </div>
  );
}
