import { InfoHint } from "@/components/InfoHint";
import { bpsToPercent, ugx, units } from "@/lib/format";

export function PortfolioSummary({
  principal,
  projected,
  activeCount,
  totalUnits,
  maturedCount,
}: {
  principal: number;
  projected: number;
  activeCount: number;
  totalUnits: number;
  maturedCount: number;
}) {
  return (
    <div className="portfolio-summary">
      <article className="card portfolio-hero-card">
        <p className="muted">
          Active portfolio value at maturity{" "}
          <InfoHint
            label="How active portfolio value is calculated"
            text="Sum of principal plus projected returns across your reserved and active placements. Projected amounts are estimates, not guaranteed."
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
              Projected return{" "}
              <InfoHint
                label="How projected return is calculated"
                text="Portfolio value at maturity minus principal, using each placement's projected rate. This is a projection, not a guarantee."
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
        <p className="muted">
          {units(totalUnits)} units{" "}
          <InfoHint
            label="How units are calculated"
            text="Total units across reserved and active placements. Each placement's units equal its principal divided by its unit price."
          />
        </p>
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
