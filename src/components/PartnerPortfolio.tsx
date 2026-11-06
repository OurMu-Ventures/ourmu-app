import { AdminReceiptDownload } from "@/components/AdminReceiptDownload";
import { investmentCycleTitle } from "@/lib/investments";
import { date, ugx } from "@/lib/format";
import {
  basisMix,
  VALUE_BASIS_LABELS,
  type PortfolioRecord,
  type PortfolioSummary,
} from "@/lib/partner-portfolio";

function count(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function PortfolioTotals({ summary }: { summary: PortfolioSummary }) {
  const { active, reserved, awaiting } = summary;
  const activeBasis = basisMix(active.count, active.actualCount, "Projected");
  const awaitingBasis = basisMix(
    awaiting.count,
    awaiting.actualCount,
    "Estimated",
  );
  return (
    <section aria-labelledby="portfolio-totals">
      <div className="portfolio-section-head">
        <h2 id="portfolio-totals">Portfolio totals</h2>
        <p className="muted">All cycles · entire portfolio</p>
      </div>
      <div className="portfolio-totals">
        <article className="card">
          <h3 className="portfolio-total-label">Active principal</h3>
          <p className="stat">{ugx(active.principalUgx)}</p>
          <p>{count(active.count, "active investment")}</p>
          <p className="muted portfolio-total-note">
            Principal of active investments only. The partner&apos;s own
            dashboard adds pending reservations to this figure.
          </p>
        </article>
        <article className="card">
          <h3 className="portfolio-total-label">Active value at maturity</h3>
          <p className="stat">{ugx(active.valueUgx)}</p>
          <p>{activeBasis ?? "No active investments"}</p>
          <p className="muted portfolio-total-note">
            Principal plus return, using the cycle&apos;s actual return where
            recorded and the projection otherwise. Projections are not
            guaranteed.
          </p>
        </article>
        <article className="card">
          <h3 className="portfolio-total-label">Pending reservations</h3>
          <p className="stat">{ugx(reserved.principalUgx)}</p>
          <p>{count(reserved.count, "reservation")}</p>
          <p className="muted portfolio-total-note">
            Principal awaiting payment confirmation and activation. Not yet
            active capital.
          </p>
        </article>
        <article className="card">
          <h3 className="portfolio-total-label">Matured awaiting settlement</h3>
          <p className="stat">{ugx(awaiting.valueUgx)}</p>
          <p>
            {awaiting.count
              ? `${count(awaiting.count, "investment")} · ${awaitingBasis}`
              : "Nothing awaiting settlement"}
          </p>
          {awaiting.count > 0 && (
            <p className="muted">Principal {ugx(awaiting.principalUgx)}</p>
          )}
          <p className="muted portfolio-total-note">
            Value due on matured investments not yet paid out or reinvested.
            Estimated where the cycle&apos;s actual return is not recorded.
          </p>
        </article>
      </div>
    </section>
  );
}

function ValueAtMaturity({ record }: { record: PortfolioRecord }) {
  if (record.valueUgx == null || !record.valueBasis) return <>—</>;
  return (
    <>
      {ugx(record.valueUgx)}
      <small className="muted portfolio-cell-note">
        {VALUE_BASIS_LABELS[record.valueBasis]}
        {record.revisable ? " · may change until maturity" : ""}
      </small>
    </>
  );
}

function Receipt({ record }: { record: PortfolioRecord }) {
  const receipt = record.receipt;
  if (!receipt) return <span className="muted">None</span>;
  if (receipt.status !== "ready")
    return (
      <span className="muted">
        {receipt.number}: {receipt.status}
      </span>
    );
  return (
    <AdminReceiptDownload
      receiptId={receipt.id}
      receiptNumber={receipt.number}
    />
  );
}

function Placement({ record }: { record: PortfolioRecord }) {
  return (
    <>
      <strong>{record.title}</strong>
      <small className="muted portfolio-cell-note">
        {record.title !== investmentCycleTitle(record.cycleName) &&
          `${investmentCycleTitle(record.cycleName)} · `}
        {record.originLabel}
        {record.isTest ? " · Test record" : ""}
      </small>
    </>
  );
}

// A compact table on wide screens and stacked records on phones. Only one
// is displayed (and exposed to assistive technology) at a time.
export function PortfolioRecords({
  records,
  caption,
}: {
  records: PortfolioRecord[];
  caption: string;
}) {
  return (
    <>
      <div className="table-wrap portfolio-table">
        <table>
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Placement</th>
              <th scope="col" className="portfolio-amount">
                Principal
              </th>
              <th scope="col" className="portfolio-amount">
                Value at maturity
              </th>
              <th scope="col">Matures</th>
              <th scope="col">Status</th>
              <th scope="col">Settlement</th>
              <th scope="col">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                <th scope="row">
                  <Placement record={record} />
                </th>
                <td className="portfolio-amount">{ugx(record.principalUgx)}</td>
                <td className="portfolio-amount">
                  <ValueAtMaturity record={record} />
                </td>
                <td>{date(record.maturityDate)}</td>
                <td>
                  <span className="badge">{record.statusLabel}</span>
                </td>
                <td>{record.settlement}</td>
                <td>
                  <Receipt record={record} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="portfolio-records" aria-label={caption}>
        {records.map((record) => (
          <li className="card" key={record.id}>
            <div className="portfolio-record-head">
              <h3>
                <Placement record={record} />
              </h3>
              <span className="badge">{record.statusLabel}</span>
            </div>
            <dl>
              <dt>Principal</dt>
              <dd>{ugx(record.principalUgx)}</dd>
              <dt>Value at maturity</dt>
              <dd>
                <ValueAtMaturity record={record} />
              </dd>
              <dt>Matures</dt>
              <dd>{date(record.maturityDate)}</dd>
              <dt>Settlement</dt>
              <dd>{record.settlement}</dd>
              <dt>Receipt</dt>
              <dd>
                <Receipt record={record} />
              </dd>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
