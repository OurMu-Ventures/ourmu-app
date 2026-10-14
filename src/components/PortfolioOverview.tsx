import { InfoHint } from "@/components/InfoHint";
import { bpsToPercent, ugx } from "@/lib/format";

export function PortfolioSummary({
  principal,
  projected,
  activeCount,
  maturedCount,
  actualCount = 0,
}: {
  principal: number;
  // Value at maturity: actual where a cycle return is recorded, else projected.
  projected: number;
  activeCount: number;
  maturedCount: number;
  // Active placements whose cycle has a recorded actual return.
  actualCount?: number;
}) {
  const returnLabel =
    actualCount === 0
      ? "Projected return"
      : actualCount === activeCount
        ? "Actual return"
        : "Return (actual where recorded)";
  const returnHint =
    actualCount === 0
      ? "Portfolio value at maturity minus principal, using each placement's projected rate. This is a projection, not a guarantee."
      : actualCount === activeCount
        ? "Portfolio value at maturity minus principal, using the actual return recorded for each placement's cycle. Returns published before maturity may still be revised until maturity."
        : "Portfolio value at maturity minus principal. Uses the actual return where a cycle's return is recorded and the projected rate otherwise. Projections are not guaranteed.";
  return (
    <div className="portfolio-summary">
      <article className="card portfolio-hero-card">
        <p className="muted">
          Active portfolio value at maturity{" "}
          <InfoHint
            label="How active portfolio value is calculated"
            text={
              actualCount === 0
                ? "Sum of principal plus projected returns across your reserved and active placements. Projected amounts are estimates, not guaranteed."
                : "Sum of principal plus returns across your reserved and active placements, using the actual return where a cycle's return is recorded and the projection otherwise."
            }
          />
        </p>
        <p className="stat">{ugx(projected)}</p>
        <div className="portfolio-hero-breakdown">
          <p>
            <span>
              Principal{" "}
              <InfoHint
                label="How principal is calculated"
                text="Total amount you contributed across reserved and active placements."
              />
            </span>
            <strong>{ugx(principal)}</strong>
          </p>
          <p>
            <span>
              {returnLabel}{" "}
              <InfoHint
                label={`How ${returnLabel.toLowerCase()} is calculated`}
                text={returnHint}
              />
            </span>
            <strong>{ugx(projected - principal)}</strong>
          </p>
        </div>
      </article>
      <article className="card">
        <p className="muted">
          Active placements{" "}
          <InfoHint
            label="How active placements are counted"
            text="Number of placements currently reserved or active."
          />
        </p>
        <p className="stat">{activeCount}</p>
      </article>
      <article className="card">
        <p className="muted">
          Past placements{" "}
          <InfoHint
            label="How past placements are counted"
            text="Number of placements recorded as matured."
          />
        </p>
        <p className="stat">{maturedCount}</p>
        <p className="muted">Reported paid records</p>
      </article>
    </div>
  );
}

export function CurrentOpportunityRate({
  projectedReturnBps,
}: {
  projectedReturnBps: number;
}) {
  return (
    <>
      <strong>{bpsToPercent(projectedReturnBps)}%</strong>{" "}
      <InfoHint
        label="How the projected return rate works"
        text="The rate applied to principal to estimate the payout. This is a projection, not a guarantee."
      />
    </>
  );
}
