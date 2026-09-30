import { describe, expect, it } from "vitest";
import {
  getEffectiveProjectHealth,
  isProjectReviewDue,
  isProjectReviewFuture,
} from "./projects";

describe("getEffectiveProjectHealth", () => {
  it("uses a valid stored health value", () => {
    expect(
      getEffectiveProjectHealth({
        health: "At risk",
        status: "In Progress",
      }),
    ).toBe("At risk");
  });

  it("falls back to Blocked when status is blocked", () => {
    expect(
      getEffectiveProjectHealth({
        status: "Blocked",
      }),
    ).toBe("Blocked");
  });

  it("otherwise falls back to On track", () => {
    expect(
      getEffectiveProjectHealth({
        status: "In Progress",
      }),
    ).toBe("On track");
  });
});

describe("project review timing", () => {
  const todayNoon = new Date("2026-09-30T12:00:00").getTime();

  it("treats a later review date as future", () => {
    expect(
      isProjectReviewFuture(
        { nextReviewDate: "2026-10-01" },
        todayNoon,
      ),
    ).toBe(true);

    expect(
      isProjectReviewDue(
        { nextReviewDate: "2026-10-01" },
        todayNoon,
      ),
    ).toBe(false);
  });

  it("treats today and earlier dates as due", () => {
    expect(
      isProjectReviewDue(
        { nextReviewDate: "2026-09-30" },
        todayNoon,
      ),
    ).toBe(true);

    expect(
      isProjectReviewDue(
        { nextReviewDate: "2026-09-29" },
        todayNoon,
      ),
    ).toBe(true);
  });

  it("returns false when no review date exists", () => {
    expect(
      isProjectReviewFuture({}, todayNoon),
    ).toBe(false);

    expect(
      isProjectReviewDue({}, todayNoon),
    ).toBe(false);
  });
});
