import { expect, it, vi } from "vitest";
import {
  verifyAirtableRecords,
  verifyAirtableTable,
  verifySlackChannel,
} from "./staged-verification";

it("passes only when every target record is re-read from the table", async () => {
  const read = vi.fn(
    async (action: { action: string; filterByFormula?: string }) => {
      expect(action.action).toBe("list_records");
      expect(action.filterByFormula).toBe(
        "OR(RECORD_ID()='recAAAAAAAAAAAAA1',RECORD_ID()='recBBBBBBBBBBBBB2')",
      );
      return {
        account: "a",
        data: { records: [{ id: "recAAAAAAAAAAAAA1" }] },
      };
    },
  );
  const args = {
    baseId: "appZgInlaiE12FCu7",
    tableId: "tblqqYLjWgLj87m25",
    recordIds: ["recAAAAAAAAAAAAA1", "recBBBBBBBBBBBBB2", "recAAAAAAAAAAAAA1"],
  };
  const result = await verifyAirtableRecords(read, args);
  expect(result).toEqual({
    ok: false,
    reason:
      "1 of 2 target records no longer exists in that table (recBBBBBBBBBBBBB2)",
  });
  read.mockResolvedValueOnce({
    account: "a",
    data: {
      records: [{ id: "recAAAAAAAAAAAAA1" }, { id: "recBBBBBBBBBBBBB2" }],
    },
  });
  expect(await verifyAirtableRecords(read, args)).toEqual({ ok: true });
  read.mockRejectedValueOnce(new Error("timeout"));
  expect((await verifyAirtableRecords(read, args)).ok).toBe(false);
  // A quote in an id can never reach the formula.
  read.mockResolvedValueOnce({ account: "a", data: { records: [] } });
  await verifyAirtableRecords(read, { ...args, recordIds: ["rec'OR'1'='1"] });
  expect(read.mock.calls.at(-1)?.[0].filterByFormula).toBe(
    "OR(RECORD_ID()='recOR1=1')",
  );
});

it("requires the target table to still be in the base schema", async () => {
  const read = vi.fn(
    async (): Promise<{ account: string; data: unknown }> => ({
      account: "a",
      data: { tables: [{ id: "tblqqYLjWgLj87m25" }] },
    }),
  );
  expect(
    await verifyAirtableTable(read, {
      baseId: "app1",
      tableId: "tblqqYLjWgLj87m25",
    }),
  ).toEqual({ ok: true });
  expect(
    (await verifyAirtableTable(read, { baseId: "app1", tableId: "tblGone" }))
      .ok,
  ).toBe(false);
  read.mockResolvedValueOnce({ account: "a", data: { offloaded: true } });
  expect(
    (
      await verifyAirtableTable(read, {
        baseId: "app1",
        tableId: "tblqqYLjWgLj87m25",
      })
    ).ok,
  ).toBe(false);
});

it("resolves the channel by id or name across pages and requires membership", async () => {
  const pages = [
    {
      channels: [{ id: "C1", name: "general", member: true }],
      nextCursor: "p2",
    },
    {
      channels: [
        { id: "C0A1NHZ5QF2", name: "agent-leads", member: true },
        { id: "C3", name: "random", member: false },
      ],
      nextCursor: null,
    },
  ];
  const list = vi.fn(async (action: { cursor?: string }) =>
    action.cursor === "p2" ? pages[1] : pages[0],
  );
  expect(await verifySlackChannel(list, "#Agent-Leads")).toEqual({ ok: true });
  expect(await verifySlackChannel(list, "C0A1NHZ5QF2")).toEqual({ ok: true });
  expect((await verifySlackChannel(list, "random")).ok).toBe(false);
  expect((await verifySlackChannel(list, "random")).ok).toBe(false);
  expect((await verifySlackChannel(list, "#missing")).ok).toBe(false);
  list.mockRejectedValueOnce(new Error("down"));
  expect((await verifySlackChannel(list, "general")).ok).toBe(false);
});
