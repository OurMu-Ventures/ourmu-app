import Link from "next/link";
import { ArrowRight, CalendarDays, ChartNoAxesCombined, Fish, Laptop, Pencil, Star, TrendingUp } from "lucide-react";

import {
  NewsletterCallout,
  NewsletterFooter,
  NewsletterMasthead,
  NewsletterMetrics,
  NewsletterPhoto,
  NewsletterQuote,
  NewsletterSection,
} from "./components";

/** October partner update. Farm review figures cover January–June 2026. */
export function October2026Newsletter() {
  return (
    <article aria-label="Partner Update — October 2026" className="nl-article">
      <NewsletterMasthead
        title="Partner Update — October 2026"
        issueMonth="October 2026"
        issueNote="Farm figures cover January–June 2026; updates are for October 2026."
      />
      <div className="nl-body">
        <div className="nl-two-col">
          <NewsletterSection id="october-partner-note" icon={Pencil} title="A Note to Our Partners">
            <p>Dear Partners,</p>
            <p>Thank you for continuing to journey with us.</p>
            <p>
              This month, we are pleased to share a number of important developments across OURMU.
              We have continued learning from our farm operations, and the first-six-month performance
              review has given us clearer insight into what is working well and where we need to improve
              — especially around cage conditions, feed efficiency, and farm productivity. The review
              shows total sales of 65,182 kg of fish and revenue of UGX 544.2 million for January–June 2026.
            </p>
            <p>
              We are also excited to share progress at Buyege, where broodstock has now arrived and
              been introduced into the ponds — 3,000 female and 1,000 male parent fish. This is an important
              step toward establishing our hatchery and strengthening fingerling supply for the future.
            </p>
            <p>
              In addition, the OURMU Partner Portal is now live at partners.ourmu.org. To help Partners
              understand what to expect from the platform, we will host an online Q&amp;A webinar on
              Saturday, 31 October 2026.
            </p>
            <p>Thank you for growing with us and for being part of the OURMU community.</p>
            <p><strong>— Aaron Tushabe, Community Manager</strong></p>
          </NewsletterSection>
          <NewsletterPhoto
            src="/newsletters/october-2026/aaron.webp"
            width={1200}
            height={900}
            description="Aaron looking through binoculars over a lake and green hills."
            caption="Aaron Tushabe, Community Manager"
          />
        </div>

        <NewsletterSection id="october-numbers" icon={ChartNoAxesCombined} title="By the Numbers">
          <p>Nsena Ku Jengo — January–June 2026 farm performance, six cages.</p>
          <NewsletterMetrics
            ariaLabel="Nsena Ku Jengo farm performance, January to June 2026"
            items={[
              { label: "Fish Sold", value: "65,182 kg", sub: "Jan–Jun 2026" },
              { label: "Revenue", value: "UGX 544.2M", sub: "Jan–Jun 2026" },
              { label: "Average Selling Price", value: "UGX 8,349", sub: "per kg" },
              { label: "Feed Used", value: "104,942 kg", sub: "Jan–Jun 2026" },
              { label: "Recorded Mortality", value: "16.7%", sub: "51,070 of 305,448 stocked fish" },
            ]}
          />
          <p className="nl-metric-strip">
            September harvest: <strong>9,035 kg.</strong> Revenue less feed for January–June was
            <strong> UGX 218.9M.</strong> This is not profit; fingerlings, nets, labour, transport and other
            overhead costs are excluded.
          </p>
        </NewsletterSection>

        <div className="nl-two-col">
          <NewsletterSection id="october-feed-efficiency" icon={Fish} title="Understanding the Business: Why Feed Efficiency Matters">
            <p>
              Feed is one of the most important inputs in fish farming — and one of the biggest costs.
              Between January and June, Nsena Ku Jengo used 104,942 kg of feed costing UGX 325.3 million,
              equivalent to about 60% of farm revenue during the period.
            </p>
            <p>
              Fish farmers commonly track Feed Conversion Ratio (FCR): how many kilograms of feed are
              required to produce one kilogram of fish growth. Generally, the lower the FCR, the more
              efficiently fish are converting feed into body weight.
            </p>
            <p>
              Our current farm report uses a related measure — feed consumed per kilogram of fish sold.
              P3 performed best at 1.18 kg of feed per kg sold, while Q3 and Q2 recorded 3.23 kg and
              3.79 kg respectively.
            </p>
            <p>
              This figure should not be treated as formal FCR. The farm report divides total feed by
              kilograms sold so far, while formal FCR uses biomass weight gain. Fish still remaining in
              cages can therefore inflate this measure.
            </p>
            <p>
              But feeding is only part of the story. Poor nets can allow fish to escape or increase
              losses, meaning feed may be consumed without producing fish that can eventually be sold.
              Strong record-keeping, good nets and disciplined feeding therefore work together.
            </p>
            <ol className="nl-process">
              <li>Feed</li><li aria-hidden="true"><ArrowRight width={16} height={16} /></li>
              <li>Fish Growth</li><li aria-hidden="true"><ArrowRight width={16} height={16} /></li>
              <li>Harvest</li><li aria-hidden="true"><ArrowRight width={16} height={16} /></li>
              <li>Revenue</li>
            </ol>
            <p>Better feed efficiency = more fish produced from each kilogram of feed.</p>
          </NewsletterSection>
          <div className="nl-section-body">
            <NewsletterSection id="october-nets" title="What We Learned: Nets Matter">
              <p>
                Net condition was the biggest performance driver in the six-cage review. The four
                old-net cages held 64% of stocked fish but produced only 39% of revenue.
              </p>
              <NewsletterMetrics
                compact
                ariaLabel="Recorded mortality by net condition"
                items={[
                  { label: "Old-net cages", value: "24.5%", sub: "recorded mortality" },
                  { label: "P2 & P3", value: "3.2%", sub: "recorded mortality" },
                ]}
              />
              <p>P3 was the strongest cage overall, including the lowest feed-per-kg-sold measure.</p>
            </NewsletterSection>
            <NewsletterSection id="october-next" icon={TrendingUp} title="What We're Working on Next">
              <ol>
                <li><strong>Buyege hatchery ramp-up:</strong> support the newly introduced broodstock
                  through the October breeding period and prepare for egg laying and hatching.</li>
                <li><strong>Nsena Ku Jengo operating improvements:</strong> replace old nets before
                  restocking, replicate the stronger P2/P3 practices across cages, and improve
                  recording of escapes versus deaths.</li>
                <li><strong>Partner experience:</strong> support adoption of the new Partner Portal
                  and help Partners use it confidently for investment visibility, reinvestment or
                  withdrawal requests, and receipt downloads.</li>
              </ol>
            </NewsletterSection>
          </div>
        </div>

        <div className="nl-two-col">
          <NewsletterSection id="october-featured" icon={Star} title="Featured Partner">
            <NewsletterPhoto
              src="/newsletters/october-2026/jonathan.webp"
              width={1200}
              height={1800}
              description="Jonathan smiling while seated outdoors beside a pool."
              caption="Jonathan Amwesiga — Partner since June 2024"
            />
          </NewsletterSection>
          <NewsletterSection id="october-jonathan" title="Meet Jonathan Amwesiga">
            <p>Partner since June 2024</p>
            <p>
              Jonathan’s journey to OURMU began through a colleague who was already a Partner. An
              introduction led to a visit to Nsena Ku Jengo, where seeing the farm and experiencing
              the community’s warm welcome helped him take the next step.
            </p>
            <p>
              Asked what drew him to OURMU, his answer is simple: <strong>“The community and mission
              to grow together.”</strong> He became a Partner in June 2024, and OURMU’s ambition and
              strong sense of community have continued to stand out for him.
            </p>
            <p>
              For Jonathan, the partnership has been a chance to take part in something meaningful,
              learn along the way, and grow with purpose. His encouragement to others reflects that
              experience:
            </p>
            <NewsletterQuote>
              “OURMU has been about being part of something meaningful, learning along the way, and
              growing with purpose. I’d encourage anyone considering the journey to take that first step.”
            </NewsletterQuote>
            <p>
              Outside OURMU, Jonathan shares a cheerful expression of his faith: <strong>“Jesus loves
              you all 😁”</strong> His personal motto carries that same warmth and energy:
            </p>
            <NewsletterQuote>“Don’t just live. Make it count 💪🏾”</NewsletterQuote>
          </NewsletterSection>
        </div>

        <NewsletterCallout icon={Laptop} title="Partner Portal is Live" tone="orange">
          <p>
            All Partners can now log in at partners.ourmu.org. From the portal, Partners can view
            their current investments, request reinvestment or withdrawal of matured investments,
            and download receipts.
          </p>
          <p><Link href="/dashboard">Open your partner overview →</Link></p>
        </NewsletterCallout>

        <div className="nl-two-col">
          <NewsletterPhoto
            src="/newsletters/october-2026/broodstock.webp"
            width={1200}
            height={675}
            description="People offloading broodstock beside fishing boats at the lakeshore."
            caption="Broodstock being offloaded at the shore before transfer to the Buyege ponds."
          />
          <NewsletterSection id="october-broodstock" icon={Fish} title="Buyege Hatchery: Broodstock is In">
            <p>
              Our parent fish have arrived and are now in the ponds at Buyege, moving the hatchery
              from preparation into the breeding phase.
            </p>
            <NewsletterMetrics
              compact
              ariaLabel="Broodstock introduced at Buyege"
              items={[
                { label: "Female broodstock", value: "3,000" },
                { label: "Male broodstock", value: "1,000" },
              ]}
            />
            <p>
              October is breeding season. The next milestone is egg laying and hatching as we work
              toward a reliable, year-round source of fingerlings for OURMU farms and other farmers.
            </p>
          </NewsletterSection>
        </div>

        <NewsletterSection id="october-looking-ahead" icon={CalendarDays} title="Looking Ahead">
          <div className="nl-two-col">
            <NewsletterCallout title="Buyege Hatchery — Breeding Phase Begins">
              <p><strong>October 2026</strong></p>
              <p>
                The 3,000 female and 1,000 male broodstock are now in the ponds. With October marking
                the breeding period, the next milestone is egg laying and hatching as the hatchery
                moves into active production.
              </p>
            </NewsletterCallout>
            <NewsletterCallout title="Partner Portal Q&A Webinar" tone="orange">
              <p><strong>Saturday, 31 October 2026 · 10:00 AM EAT</strong></p>
              <p>
                Join us via Google Meet for a practical walkthrough of partners.ourmu.org and an
                open Q&amp;A. The meeting link will be shared by email and WhatsApp.
              </p>
            </NewsletterCallout>
          </div>
        </NewsletterSection>
      </div>
      <NewsletterFooter />
    </article>
  );
}
