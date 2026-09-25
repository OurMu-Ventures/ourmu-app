import { z } from "zod";

const cycleDate = z.iso.date();

export function cycleDayBounds(opensOn: string, closesOn: string) {
  if (!cycleDate.safeParse(opensOn).success || !cycleDate.safeParse(closesOn).success)
    return null;

  const opensAt = new Date(`${opensOn}T00:00:00+03:00`);
  const closesAt = new Date(`${closesOn}T23:59:59.999+03:00`);
  if (opensAt >= closesAt) return null;

  return {
    opensAt: opensAt.toISOString(),
    closesAt: closesAt.toISOString(),
  };
}
