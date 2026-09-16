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
  unitPriceUgx?: number | string | null;
  isPaid?: boolean;
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
  const isPaid = item.isPaid ?? false;
  return (
    <article className="card invest-card">
      <div className="invest-head">
        <div>
          <h3>{item.name}</h3>
          <p className="invest-amount">
            <span>
              {ugx(item.principalUgx)}{" "}
              <InfoHint
                label="How principal is calculated"
                text="Amount you contributed to this placement."
              />
            </span>{" "}
            <span className="muted">
              · {units(item.unitsValue)} units{" "}
              <InfoHint
                label="How units are calculated"
                text="Your principal divided by this placement's unit price."
              />
            </span>
          </p>
        </div>
        <span className="badge">{item.statusLabel}</span>
      </div>
      <div className="invest-stats">
        <p>
          <span className="invest-stat-label">
            Profit
            <InfoHint
              label="How profit is calculated"
              text={
                isPaid
                  ? "Total payout minus principal, using the recorded paid amount."
                  : "Total payout minus principal, using this placement's projected rate. This is a projection, not a guarantee."
              }
            />
          </span>
          <strong className="invest-profit">{ugx(item.profitUgx)}</strong>
        </p>
        <p>
          <span className="invest-stat-label">
            Total at Maturity
            <InfoHint
              label="How total at maturity is calculated"
              text={
                isPaid
                  ? "The recorded payout for this paid placement."
                  : "Principal plus projected profit. This is a projection, not a guarantee."
              }
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
          <span>
            Progress{" "}
            <InfoHint
              label="How maturity progress is calculated"
              text="Time elapsed between placement creation and maturity. Matured or past-due placements show 100%."
            />
          </span>
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
