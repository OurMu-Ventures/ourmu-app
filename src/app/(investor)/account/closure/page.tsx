import { ClosureForm } from "@/components/forms";
export default function ClosurePage() {
  return (
    <>
      <p className="eyebrow">Privacy and access</p>
      <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>
        Close portal account
      </h1>
      <p className="lead">
        This request removes access promptly. It does not erase records OURMU
        must retain for agreements, investment administration, audit, or legal
        obligations.
      </p>
      <div className="card">
        <ClosureForm />
      </div>
    </>
  );
}
