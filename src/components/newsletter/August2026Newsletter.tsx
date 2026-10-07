import {
  ArrowRight,
  CalendarDays,
  CircleCheck,
  Fish,
  HandCoins,
  Leaf,
  Mail,
  Search,
  Sprout,
  Users,
} from "lucide-react";

import {
  NewsletterCallout,
  NewsletterFooter,
  NewsletterMasthead,
  NewsletterMetrics,
  NewsletterPhoto,
  NewsletterQuote,
  NewsletterSection,
} from "./components";

/**
 * Partner Update — August 2026.
 * Historical editorial content transcribed from the launch PDF.
 * Figures are frozen as published; they are not live portfolio data.
 */
export function August2026Newsletter() {
  return (
    <article aria-labelledby="nl-august-2026-title" className="nl-article">
      <NewsletterMasthead
        title="Partner Update — August 2026"
        issueMonth="August 2026"
      />
      <div className="nl-body">
        <span id="nl-august-2026-title" className="visually-hidden">
          Partner Update August 2026
        </span>

        <div className="nl-two-col">
          <NewsletterSection id="partner-note" title="A Note to Our Partners">
            <p>Dear Partners,</p>
            <p>
              It has been a while since our last Partner Update, and I apologise
              for the silence. At the beginning of 2026, we set ourselves four
              major goals: develop a digital Partner platform, diversify our
              investment opportunities, grow the fund to UGX 1.5 billion and
              100 Partners, and strengthen the OURMU team and governance.
            </p>
            <p>
              The year has brought both challenges and progress. Stocking
              difficulties resulted in several months without harvests at Nsena
              Ku Jengo and Kyazi. In response, we are developing our own
              hatchery to improve the reliability and quality of our fingerling
              supply.
            </p>
            <p>
              By June, Partner investment had reached more than UGX 900
              million, and 11 new Partners had joined the community, bringing
              us to 73 active Partners. Our Partner platform is also now in
              testing, with rollout targeted for the end of October.
            </p>
            <p>
              Thank you for continuing to walk with us as we grow OURMU and
              expand opportunities in Ugandan agribusiness.
            </p>
            <p>— Bwooji Elijah</p>
          </NewsletterSection>
          <NewsletterPhoto
            caption="Bwooji Elijah shares the August partner note."
            description="Photograph of Bwooji Elijah reading papers outdoors among banana trees."
            placeholderLabel="Photo: Bwooji Elijah"
          />
        </div>

        <NewsletterSection id="by-numbers" title="By the Numbers">
          <NewsletterMetrics
            ariaLabel="Partner investment figures, January to June 2026"
            items={[
              {
                label: "Reinvestment",
                value: "UGX 589.4M",
                sub: "Jan–Jun 2026",
              },
              {
                label: "Existing Partner Investment",
                value: "UGX 321.0M",
                sub: "New money",
              },
              {
                label: "New Partner Investment",
                value: "UGX 46.3M",
                sub: "Jan–Jun 2026",
              },
              {
                label: "Total Partner Investment",
                value: "UGX 956.6M",
                sub: "Jan–Jun 2026",
              },
              {
                label: "Paid Out to Partners",
                value: "UGX 111.3M",
                sub: "Jan–Jun 2026",
              },
            ]}
          />
          <p className="nl-metric-strip">
            <strong>73</strong> active Partners • <strong>11</strong> new
            Partners in 2026
          </p>
        </NewsletterSection>

        <div className="nl-two-col">
          <NewsletterSection
            id="understanding-business"
            title="Understanding the Business"
          >
            <h3>Why Fingerling Supply Matters</h3>
            <p>
              Uganda&apos;s fish-farming sector is growing, but reliable
              fingerling supply remains a constraint. OURMU can currently wait
              nearly three months to assemble 200,000 fingerlings, sometimes
              sourcing them from several different hatcheries. That makes
              regular stocking more difficult and can disrupt planned harvest
              cycles.
            </p>
            <p>
              OURMU is therefore developing a hatchery at Buyege with a planned
              capacity of 500,000 fingerlings per month: 300,000 for Nsena Ku
              Jengo and Kyazi, and 200,000 for other fish farmers. A reliable
              in-house supply should improve fingerling quality, make stocking
              more predictable, and support more consistent harvest cycles.
            </p>
            <ol className="nl-process">
              <li>Broodstock</li>
              <li aria-hidden="true">
                <ArrowRight width={16} height={16} />
              </li>
              <li>Hatchery</li>
              <li aria-hidden="true">
                <ArrowRight width={16} height={16} />
              </li>
              <li>Fingerlings</li>
              <li aria-hidden="true">
                <ArrowRight width={16} height={16} />
              </li>
              <li>Grow-out Farms</li>
              <li aria-hidden="true">
                <ArrowRight width={16} height={16} />
              </li>
              <li>Harvest</li>
            </ol>
          </NewsletterSection>
          <NewsletterPhoto
            caption="Preparatory work at the Buyege hatchery site."
            description="Photograph of people preparing the Buyege hatchery site beside a pond and palm trees."
            placeholderLabel="Photo: Buyege hatchery site"
          />
        </div>

        <div className="nl-two-col">
          <NewsletterSection
            id="working-next"
            icon={CircleCheck}
            title="What We're Working on Next"
          >
            <ol>
              <li>
                Develop the Buyege hatchery — planned capacity of 500,000
                fingerlings per month.
              </li>
              <li>
                Complete pond rehabilitation and introduce broodstock for
                hatchery production.
              </li>
              <li>Prepare the site for reliable year-round operations.</li>
            </ol>
          </NewsletterSection>
          <NewsletterCallout
            icon={Sprout}
            title="Growing across the value chain"
            tone="orange"
          >
            <p>
              Fish farming spans hatchery operations, feed, grow-out production,
              cage fabrication, and distribution. OURMU began with grow-out
              farming and is now expanding into hatchery operations.
            </p>
          </NewsletterCallout>
        </div>

        <div className="nl-two-col">
          <div>
            <NewsletterSection id="featured-partner" title="Featured Partner">
              <NewsletterPhoto
                caption="Left to right: Migishas + Tushabes"
                description="Group photograph of Migisha and Tushabe family members smiling outdoors."
                placeholderLabel="Photo: Migishas and Tushabes"
              />
            </NewsletterSection>
          </div>
          <NewsletterSection id="meet-tushabes" title="Meet the Tushabes">
            <p>
              <CalendarDays
                aria-hidden="true"
                width={16}
                height={16}
                style={{ verticalAlign: "text-bottom" }}
              />{" "}
              Partners since December 2025
            </p>
            <h3>What drew them to OURMU</h3>
            <p>
              The Tushabes enjoy exploring investments together, and after
              moving to Garuga, Entebbe in 2024 and living close to the lake,
              their interest in fishing naturally grew. They first experienced
              a harvest day at Nsena Ku Jengo after an invitation from founding
              Partners, the Migishas, and soon felt that OURMU offered a
              meaningful way to explore fish farming with a trusted community.
            </p>
            <h3>Their OURMU Journey</h3>
            <p>
              They began with a single investment and have since reinvested and
              added new contributions regularly. They also helped introduce
              another small investment club to the community. What stands out
              most to them is the simplicity of OURMU&apos;s purpose: creating
              a way for friends and family to earn together from a real,
              productive venture.
            </p>
            <NewsletterQuote>
              Everything is better in community. Investing carries risk, so
              finding people you trust and can grow with is a healthy way to
              approach it.
            </NewsletterQuote>
            <h3>Outside OURMU</h3>
            <p>
              Outside OURMU, the Tushabes are community-oriented and live in
              Garuga. They fellowship at Watoto Church Entebbe and participate
              in other community and marriage fellowships. Kirabo is an
              economist, Aaron spends much of his time building ventures
              including Nearly Free Energy, and together they are raising their
              young son.
            </p>
            <h3>Advice to fellow partners</h3>
            <p>Don&apos;t go at it alone — come and let&apos;s grow together.</p>
          </NewsletterSection>
        </div>

        <div className="nl-two-col">
          <NewsletterSection
            id="community-update"
            icon={Users}
            title="Partner & Community Update"
          >
            <NewsletterMetrics
              ariaLabel="Partner activity, January to June 2026"
              items={[
                { label: "Reinvestments", value: "106" },
                { label: "Partners who added new money", value: "44" },
                { label: "New Partners", value: "11" },
                { label: "Investment clubs", value: "1" },
              ]}
            />
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              Partner activity shown is for January–June 2026.
            </p>
          </NewsletterSection>
          <NewsletterCallout
            icon={Users}
            title="Welcome, Aaron"
            tone="orange"
          >
            <p>
              Effective 15 August 2026, Aaron Tushabe joined Elijah and Ibra to
              help build a stronger and more engaged Partner community. He will
              serve as a primary point of contact for current and prospective
              Partners and will help coordinate Partner communication,
              community activities, and events.
            </p>
            <p>
              <Mail
                aria-hidden="true"
                width={16}
                height={16}
                style={{ verticalAlign: "text-bottom" }}
              />{" "}
              Contact:{" "}
              <a href="mailto:tushabe@ourmu.co">tushabe@ourmu.co</a>
            </p>
          </NewsletterCallout>
        </div>

        <div className="nl-two-col">
          <NewsletterSection
            id="looking-ahead"
            icon={CalendarDays}
            title="Looking Ahead"
          >
            <h3>Buyege Hatchery Opening</h3>
            <p>
              <strong>End of October 2026.</strong> Target opening for the new
              hatchery, subject to completion of pond rehabilitation and
              introduction of broodstock. Partners will be invited once the
              date is confirmed.
            </p>
          </NewsletterSection>
          <NewsletterCallout
            icon={Fish}
            title="Have a Question? We're here to help."
            tone="orange"
          >
            <p>
              If you have questions, need clarification, or want to share
              feedback, reach out to us.
            </p>
            <p>
              <Mail
                aria-hidden="true"
                width={16}
                height={16}
                style={{ verticalAlign: "text-bottom" }}
              />{" "}
              Email us:{" "}
              <a href="mailto:hello@ourmu.co">hello@ourmu.co</a>
            </p>
            <p>
              <HandCoins aria-hidden="true" width={16} height={16} />{" "}
              <Leaf aria-hidden="true" width={16} height={16} />{" "}
              <Search aria-hidden="true" width={16} height={16} /> Value-chain
              note: hatchery, feed, grow-out, and distribution.
            </p>
          </NewsletterCallout>
        </div>
      </div>
      <NewsletterFooter />
    </article>
  );
}
