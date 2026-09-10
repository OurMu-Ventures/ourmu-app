import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LinkStatus } from "@/components/ui/link-status";
export default function NotFound() {
  return (
    <main id="main" className="narrow">
      <h1>Not available</h1>
      <p>The link may be invalid, expired, already used, or revoked.</p>
      <Button asChild variant="secondary">
        <Link href="/">
          Return home <LinkStatus label="Loading homepage" />
        </Link>
      </Button>
    </main>
  );
}
