import Link from "next/link";

import { InfoHint } from "@/components/InfoHint";
import { LinkStatus } from "@/components/ui/link-status";
import { date, ugx, units } from "@/lib/format";
import { maturityProgress } from "@/lib/investments";

export type InvestmentCardData = {
  name: string;
  status: string;
  statusLabel: string;
  principalUgx: number | string;
  unitsValue: number | string;
  profitUgx: number | string;
  payoutUgx: number | string;
  maturityDate: string | null;
  startIso: string | null;
  detailHref: string;
  detailLabel: string;
  detailStatus: string;
};

// Investor cycle card adopting the legacy portfolio layout: header with
// status, three-stat grid with explainers, time progress toward maturity,
// and a detail link. Matured-state Withdraw/Reinvest actions are
// intentionally omitted until those flows exist.
export function InvestmentCard({
  item,
  actions,
}: {
  item: InvestmentCardData;
  actions?: React.ReactNode;
}) {
  const progress = maturityProgress(
    item.startIso,
    item.maturityDate,
    item.status,
  );
  return (
    <article className="card invest-card">
      <div className="invest-head">
        <div>
          <h3>{item.name}</h3>
          <p className="invest-amount">
            {ugx(item.principalUgx)}{" "}
            <span className="muted">· {units(item.unitsValue)} units</span>
          </p>
        </div>
        <span className="badge">{item.statusLabel}</span>
      </div>
      <div className="invest-stats">
        <p>
          <span className="invest-stat-label">
            Profit
            <InfoHint
              label="About profit"
              text="Fixed return on your investment, paid at the end of the cycle."
            />
          </span>
          <strong className="invest-profit">{ugx(item.profitUgx)}</strong>
        </p>
        <p>
          <span className="invest-stat-label">
            Total at Maturity
            <InfoHint
              label="About total at maturity"
              text="Your investment plus profit, paid out on the maturity date."
            />
          </span>
          <strong>{ugx(item.payoutUgx)}</strong>
        </p>
        <p>
          <span className="invest-stat-label">Maturity Date</span>
          <strong>
            {item.maturityDate ? date(item.maturityDate) : "Not set"}
          </strong>
        </p>
      </div>
      <div>
        <div className="invest-progress-row">
          <span>Progress</span>
          <span>{progress}%</span>
        </div>
        <div
          className="invest-progress-track"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progress toward maturity for ${item.name}`}
        >
          <div
            className="invest-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      <div className="invest-foot">
        <Link href={item.detailHref}>
          {item.detailLabel} <LinkStatus label={item.detailStatus} />
        </Link>
        {actions}
      </div>
    </article>
  );
}
