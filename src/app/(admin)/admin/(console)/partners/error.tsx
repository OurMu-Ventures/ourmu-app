"use client";
import { Button } from "@/components/ui/button";
export default function PartnersError({ retry }: { retry: () => void }) {
  return (
    <div className="card" role="alert">
      <h1>Partners unavailable</h1>
      <p>We couldn’t load partner records. Please try again.</p>
      <Button type="button" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
