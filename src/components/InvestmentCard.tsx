import Link from "next/link";

import { InfoHint } from "@/components/InfoHint";
import { InvestmentAlias } from "@/components/InvestmentAlias";
import { buttonVariants } from "@/components/ui/button";
import { LinkStatus } from "@/components/ui/link-status";
import type { ReturnBasis } from "@/lib/actual-returns";
import { date, ugx } from "@/lib/format";
import { maturityProgress } from "@/lib/investments";

export type InvestmentCardData = {
  investmentId: string;
  alias: string | null;
  defaultTitle: string;
  name: string;
  status: string;
  statusLabel: string;
  principalUgx: number | string;
  isPaid?: boolean;
  // Defaults to "paid" when isPaid, otherwise "projected".
  returnBasis?: ReturnBasis;
  // Matured without a recorded cycle return.
  returnPending?: boolean;
  // Actual return published before maturity; may still be revised.
  returnRevisable?: boolean;
  profitUgx: number | string;
  payoutUgx: number | string;
  maturityDate: string | null;
  startIso: string | null;
  detailHref: string;
  detailLabel: string;
  detailStatus: string;
  detailAction?: boolean;
};

// Investor cycle card with status, three-stat grid, time progress, and detail link.
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
  const basis: ReturnBasis =
    item.returnBasis ?? (isPaid ? "paid" : "projected");
  const basisNote =
    basis === "actual"
      ? item.returnRevisable
        ? "Actual · may be revised until maturity"
        : "Actual return"
      : basis === "projected"
        ? item.returnPending
          ? "Actual return pending"
          : "Projected"
        : null;
  const detailAction = Boolean(item.detailAction) && !isPaid;
  return (
    <article className="card invest-card">
      <div className="invest-head">
        <div>
          <InvestmentAlias
            investmentId={item.investmentId}
            alias={item.alias}
            defaultTitle={item.defaultTitle}
          />
          <p className="invest-amount">
            <span>
              {ugx(item.principalUgx)}{" "}
              <InfoHint
                label="How principal is calculated"
                text="Amount you contributed to this placement."
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
                basis === "paid"
                  ? "Total payout minus principal, using the recorded paid amount."
                  : basis === "actual"
                    ? "Principal multiplied by the actual return recorded for this cycle."
                    : "Total payout minus principal, using this placement's projected rate. This is a projection, not a guarantee."
              }
            />
          </span>
          <strong className="invest-profit">{ugx(item.profitUgx)}</strong>
          {basisNote && <small className="muted">{basisNote}</small>}
        </p>
        <p>
          <span className="invest-stat-label">
            Total at Maturity
            <InfoHint
              label="How total at maturity is calculated"
              text={
                basis === "paid"
                  ? "The recorded payout for this paid placement."
                  : basis === "actual"
                    ? "Principal plus the actual profit recorded for this cycle."
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
        <Link
          href={item.detailHref}
          className={
            detailAction ? `${buttonVariants()} maturity-action` : undefined
          }
        >
          {isPaid ? "View details" : item.detailLabel}{" "}
          <LinkStatus
            label={isPaid ? "Opening investment details" : item.detailStatus}
          />
        </Link>
        {actions}
      </div>
    </article>
  );
}
