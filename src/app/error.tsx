"use client";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" className="narrow">
      <h1>Something went wrong</h1>
      <p>No sensitive details have been displayed. You can safely try again.</p>
      <button className="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
