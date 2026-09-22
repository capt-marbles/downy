import { expect, it, vi } from "vitest";
import { airtableReadFailure } from "./airtable-read-failure";

const read = {
  action: "list_records" as const,
  baseId: "appExample",
  tableId: "tblLeads",
  fields: ["Lead Name", "Game"],
  limit: 20,
};
const schema = JSON.stringify({
  account: "owner",
  data: {
    tables: [
      {
        id: "tblLeads",
        name: "Leads",
        fields: [{ name: "Lead Name" }, { name: "Games" }, { name: "Tier" }],
      },
    ],
  },
});

it("names the rejected field and lists the table's real fields", async () => {
  const readSchema = vi.fn(async () => schema);
  const result = await airtableReadFailure(
    new Error(
      "Airtable action failed: unknown_field [records_read] field=Game",
    ),
    read,
    readSchema,
  );
  expect(result.code).toBe("unknown_field");
  expect(result.error).toContain('field "Game" does not exist in table Leads');
  expect(result.error).toContain("Lead Name, Games, Tier");
  expect(readSchema).toHaveBeenCalledWith("appExample");
});

it("still names the field when the schema cannot be read, and keeps other failures generic", async () => {
  const failing = await airtableReadFailure(
    new Error(
      "Airtable action failed: unknown_field [records_read] field=Game",
    ),
    read,
    async () => {
      throw new Error("schema down");
    },
  );
  expect(failing.error).toContain(
    'field "Game" does not exist. Call get_schema',
  );
  const generic = await airtableReadFailure(
    new Error("Airtable action failed: provider_failure [records_read]"),
    { ...read, fields: undefined, filterByFormula: "{Fit Score} >= 80" },
    async () => schema,
  );
  expect(generic.code).toBe("provider_failure");
  expect(generic.error).toContain("did not return a verified result");
  expect(generic.error).toContain("keep limit at 25 or fewer");
  const timeout = await airtableReadFailure(
    new Error("Airtable action failed: timeout [records_read]"),
    read,
    async () => schema,
  );
  expect(timeout.error).toContain("temporarily unavailable");
});
