// Time progress of an investment toward maturity, 0–100.
// Unlike the legacy app's hardcoded 180-day window, this uses each
// placement's real start and maturity dates. Matured placements and any
// placement past maturity read 100; missing or invalid dates read 0.
export function maturityProgress(
  startIso: string | null | undefined,
  maturityIso: string | null | undefined,
  status: string,
  nowMs = Date.now(),
): number {
  if (status === "matured") return 100;
  const start = startIso ? Date.parse(startIso) : NaN;
  const maturity = maturityIso ? Date.parse(maturityIso) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(maturity)) return 0;
  if (maturity <= start) return nowMs >= maturity ? 100 : 0;
  if (nowMs <= start) return 0;
  if (nowMs >= maturity) return 100;
  return Math.round(((nowMs - start) / (maturity - start)) * 100);
}
