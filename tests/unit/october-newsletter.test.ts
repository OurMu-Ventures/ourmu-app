import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { October2026Newsletter } from "@/components/newsletter/October2026Newsletter";

const html = renderToStaticMarkup(createElement(October2026Newsletter));

describe("October newsletter publication", () => {
  it("keeps farm figures and their financial qualifications together", () => {
    for (const text of ["65,182 kg", "UGX 544.2M", "9,035 kg", "UGX 218.9M", "This is not profit", "51,070 of 305,448 stocked fish", "24.5%", "3.2%", "not be treated as formal FCR"]) {
      expect(html).toContain(text);
    }
  });

  it("publishes the partner profile, hatchery milestone and webinar details", () => {
    for (const text of ["Jonathan Amwesiga", "3,000", "1,000", "Saturday, 31 October 2026 · 10:00 AM EAT", "Google Meet", "community@ourmu.org"]) {
      expect(html).toContain(text);
    }
    expect((html.match(/class="nl-photo-image"/g) ?? []).length).toBe(3);
  });

  it("omits content-collection instructions and the old domain", () => {
    for (const text of ["FINAL EDITORIAL CHECK", "HOW TO USE THIS DOCUMENT", "Submission deadline", "Assigned to", "ourmu.co", "PAGE 1 OF 2", "PAGE 2 OF 2"]) {
      expect(html).not.toContain(text);
    }
  });
});
