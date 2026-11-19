import Link from "next/link";
export default function NewsletterNotFound() {
  return (
    <div className="card">
      <h1>Newsletter not found</h1>
      <p>
        This issue has not been published, or the link is incorrect.
      </p>
      <Link className="button" href="/admin/newsletters">
        Back to newsletters
      </Link>
    </div>
  );
}
