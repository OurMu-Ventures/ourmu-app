import type { Metadata } from "next";

import { TestAccountLoginForm } from "@/components/forms";

export const metadata: Metadata = {
  title: "Test account login",
  robots: { index: false, follow: false },
};

export default async function TestLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  // The action validates and resolves this opaque destination after login.
  const next = typeof params.next === "string" ? params.next : undefined;

  return (
    <main id="main">
      <section className="container hero">
        <div>
          <p className="eyebrow">Test accounts only</p>
          <h1>Open the test portal.</h1>
          <p className="lead">
            This private testing entry point accepts only accounts explicitly
            marked as test data.
          </p>
          <div className="card">
            <TestAccountLoginForm next={next} />
          </div>
        </div>
      </section>
    </main>
  );
}
