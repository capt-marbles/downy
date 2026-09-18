import { describe, expect, it } from "vitest";
import { CreateScheduledTaskInputSchema, nextDueFromSchedule } from "./types";

const due = (now: string, timeOfDay = "09:00", dayOfWeek?: number) =>
  new Date(
    nextDueFromSchedule(
      {
        scheduleType: dayOfWeek == null ? "daily" : "weekly",
        timezone: "America/Chicago",
        timeOfDay,
        dayOfWeek,
      },
      Date.parse(now),
    ),
  ).toISOString();

describe("zoned schedules", () => {
  it("leaves intervals unaffected by zone", () => {
    for (const timezone of ["UTC", "America/Chicago", "Asia/Tokyo"]) {
      expect(
        nextDueFromSchedule(
          { scheduleType: "interval", intervalMinutes: 60, timezone },
          1000,
        ),
      ).toBe(3601000);
    }
  });
  it("keeps daily wall time across spring DST", () => {
    expect(due("2026-03-07T16:00:00Z")).toBe("2026-03-08T14:00:00.000Z");
  });
  it("keeps daily wall time across fall DST", () => {
    expect(due("2026-10-31T15:00:00Z")).toBe("2026-11-01T15:00:00.000Z");
  });
  it("shifts nonexistent 02:30 forward to 03:30", () => {
    expect(due("2026-03-07T10:00:00Z", "02:30")).toBe(
      "2026-03-08T08:30:00.000Z",
    );
  });
  it("runs only the earlier occurrence of a repeated time", () => {
    expect(due("2026-11-01T05:00:00Z", "01:30")).toBe(
      "2026-11-01T06:30:00.000Z",
    );
    expect(due("2026-11-01T06:30:00Z", "01:30")).toBe(
      "2026-11-02T07:30:00.000Z",
    );
  });
  it("resolves weekly dates in local time across DST", () => {
    expect(due("2026-10-26T16:00:00Z", "09:00", 1)).toBe(
      "2026-11-02T15:00:00.000Z",
    );
  });
  it("rejects an invalid timezone and defaults new tasks to Chicago", () => {
    const input = {
      title: "Test",
      kind: "test",
      brief: "A recurring task",
      scheduleType: "daily",
    };
    expect(
      CreateScheduledTaskInputSchema.safeParse({
        ...input,
        timezone: "No/Such_Zone",
      }).success,
    ).toBe(false);
    expect(CreateScheduledTaskInputSchema.parse(input).timezone).toBe(
      "America/Chicago",
    );
  });
});
