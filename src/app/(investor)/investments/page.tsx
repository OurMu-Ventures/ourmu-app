import Link from "next/link";
import { cancelInvestment } from "@/actions/investments";
import { requireInvestor } from "@/lib/auth";
import { date, dateTime, ugx } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function InvestmentsPage() {
  const profile = await requireInvestor();
  const supabase = await createClient();
  const { data } = await supabase
    .from("investments")
    .select("*")
    .eq("investor_id", profile.id)
    .order("requested_at", { ascending: false });
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Portfolio records</p>
          <h1 style={{ fontSize: "clamp(2.2rem,5vw,4rem)" }}>Investments</h1>
        </div>
        <Link className="button" href="/investments/new">
          Request units
        </Link>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Units</th>
              <th>Principal</th>
              <th>Projected value</th>
              <th>Maturity / expiry</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((item) => (
              <tr key={item.id}>
                <td>
                  <span className="badge">{item.status}</span>
                </td>
                <td>{item.units}</td>
                <td>{ugx(item.principal_ugx)}</td>
                <td>{ugx(item.projected_value_ugx)}</td>
                <td>
                  {item.status === "reserved"
                    ? dateTime(item.reservation_expires_at)
                    : date(item.maturity_date)}
                </td>
                <td>
                  <Link href={`/investments/${item.id}`}>View</Link>
                  {item.status === "reserved" && (
                    <form
                      action={cancelInvestment}
                      style={{ display: "inline", marginLeft: "1rem" }}
                    >
                      <input
                        type="hidden"
                        name="investmentId"
                        value={item.id}
                      />
                      <button type="submit">Cancel</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {!data?.length && (
              <tr>
                <td colSpan={6}>No investment records yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
