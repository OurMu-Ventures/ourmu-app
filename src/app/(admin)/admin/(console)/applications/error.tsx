"use client";
import { Button } from "@/components/ui/button";
export default function ApplicationsError({ reset }: { reset: () => void }) {
  return (
    <div className="card" role="alert">
      <h1>Applications unavailable</h1>
      <p>We couldn’t complete the request. Please try again.</p>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
