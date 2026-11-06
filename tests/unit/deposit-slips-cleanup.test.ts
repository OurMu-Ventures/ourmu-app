import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanupDepositSlips } from "@/lib/deposit-slips";
describe("batched deposit slip cleanup", () => {
  const remove = vi.fn(),
    rpc = vi.fn(),
    update = vi.fn();
  const rows = Array.from({ length: 20 }, (_, i) => ({
    id: `id-${i}`,
    path: `path-${i}`,
  }));
  beforeEach(() => {
    remove.mockReset().mockResolvedValue({ error: null });
    rpc
      .mockReset()
      .mockImplementation(async (name: string) => ({
        data: name === "deposit_slip_cleanup_candidates" ? rows : [],
        error: null,
      }));
    update.mockReset();
    const query = {
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
    update.mockReturnValue(query);
    vi.mocked(createAdminClient).mockReturnValue({
      rpc,
      from: () => ({ update }),
      storage: { from: () => ({ remove }) },
    } as unknown as ReturnType<typeof createAdminClient>);
  });
  it("deletes 20 files in one Storage call and one metadata update", async () => {
    expect(await cleanupDepositSlips()).toEqual({ deleted: 20, failed: 0 });
    expect(remove).toHaveBeenCalledExactlyOnceWith(rows.map((r) => r.path));
    expect(update).toHaveBeenCalledExactlyOnceWith({ state: "deleted" });
  });
  it("keeps claimed metadata for retry when Storage fails", async () => {
    remove.mockResolvedValue({ error: { message: "outage" } });
    expect(await cleanupDepositSlips()).toEqual({ deleted: 0, failed: 20 });
    expect(update).not.toHaveBeenCalled();
  });
  it("reconciles orphan objects in a separate bounded batch", async () => {
    rpc.mockImplementation(async (name: string) => ({
      data: name === "deposit_slip_orphan_paths" ? [{ path: "orphan" }] : [],
      error: null,
    }));
    expect(await cleanupDepositSlips()).toEqual({ deleted: 1, failed: 0 });
    expect(remove).toHaveBeenCalledWith(["orphan"]);
  });
});
