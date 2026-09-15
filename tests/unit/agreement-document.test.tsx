// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AgreementDocument } from "@/components/AgreementDocument";

afterEach(() => cleanup());

describe("AgreementDocument", () => {
  it("renders agreement headings and paragraphs as readable content", () => {
    render(
      <AgreementDocument markdown={"## Parties\n\nAgreement text.\n\n## Acceptance"} />,
    );

    expect(screen.getByRole("heading", { name: "Parties" })).toBeVisible();
    expect(screen.getByText("Agreement text.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Acceptance" })).toBeVisible();
  });
});
