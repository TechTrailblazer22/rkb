import { describe, expect, it } from "vitest";
import { csvCell, leadsToCsv } from "@/lib/leads/csv";
import { parseEnquiry, parseIndianDateTime } from "@/lib/leads/input";
import {
  LEAD_STATUSES,
  buyerStatusLabel,
  leadStatusLabel,
  parseLeadStatus,
  parseVisitStatus,
} from "@/lib/leads/status";

const NOW = new Date("2026-11-01T06:00:00.000Z"); // 11:30 in India

const valid = {
  name: "Asha Kumar",
  mobile: "98765 43210",
  message: "Is plot A-12 still available?",
  preferredPlot: "A-12",
  visitAt: "",
  consent: "on",
  website: "",
};

describe("lead statuses", () => {
  it("has the six pipeline stages, in order, each with a builder and a buyer word", () => {
    expect(LEAD_STATUSES).toEqual([
      "NEW",
      "CONTACTED",
      "SITE_VISIT",
      "NEGOTIATION",
      "BOOKED",
      "LOST",
    ]);
    for (const status of LEAD_STATUSES) {
      expect(leadStatusLabel[status]).toBeTruthy();
      expect(buyerStatusLabel[status]).toBeTruthy();
    }
  });

  it("never shows the buyer the word Lost", () => {
    expect(buyerStatusLabel.LOST).toBe("Closed");
  });

  it("accepts only real statuses", () => {
    expect(parseLeadStatus("BOOKED")).toBe("BOOKED");
    expect(parseLeadStatus(["LOST", "NEW"])).toBe("LOST");
    for (const bad of ["booked", "DONE", "", "__proto__", null, undefined, 3])
      expect(parseLeadStatus(bad)).toBeNull();
    expect(parseVisitStatus("CONFIRMED")).toBe("CONFIRMED");
    expect(parseVisitStatus("NEW")).toBeNull();
  });
});

describe("parseIndianDateTime", () => {
  it("reads a wall-clock time as Indian time", () => {
    expect(parseIndianDateTime("2026-11-03T10:30")?.toISOString()).toBe("2026-11-03T05:00:00.000Z");
  });

  it.each([
    "",
    "2026-11-03",
    "2026-11-03 10:30",
    "2026-13-03T10:30",
    "2026-02-31T10:30",
    "2026-11-03T25:00",
    "tomorrow",
  ])("rejects %s", (value) => {
    expect(parseIndianDateTime(value)).toBeNull();
  });
});

describe("parseEnquiry", () => {
  it("accepts a good enquiry and tidies it", () => {
    const result = parseEnquiry(
      { ...valid, name: "  Asha   Kumar ", mobile: "+91 98765-43210" },
      NOW,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        name: "Asha Kumar",
        mobile: "9876543210",
        message: "Is plot A-12 still available?",
        preferredPlot: "A-12",
        visitAt: null,
      },
    });
  });

  it("treats the message, plot and visit as optional", () => {
    const result = parseEnquiry({ ...valid, message: "", preferredPlot: "" }, NOW);
    expect(result.ok && result.value).toMatchObject({
      message: null,
      preferredPlot: null,
      visitAt: null,
    });
  });

  it("insists on the consent tick", () => {
    const result = parseEnquiry({ ...valid, consent: "" }, NOW);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.consent).toBeTruthy();
  });

  it("rejects a bad name and a bad mobile, saying which", () => {
    const result = parseEnquiry({ ...valid, name: "A", mobile: "12345" }, NOW);
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(["mobile", "name"]);
  });

  it("limits the message and the plot", () => {
    const long = parseEnquiry(
      { ...valid, message: "x".repeat(1001), preferredPlot: "y".repeat(41) },
      NOW,
    );
    expect(!long.ok && Object.keys(long.errors).sort()).toEqual(["message", "preferredPlot"]);
    expect(parseEnquiry({ ...valid, message: "x".repeat(1000) }, NOW).ok).toBe(true);
  });

  it("strips control characters but keeps line breaks in the message", () => {
    const result = parseEnquiry({ ...valid, message: "Hello\u0000 there\nSecond line\u0007" }, NOW);
    expect(result.ok && result.value.message).toBe("Hello there\nSecond line");
  });

  it("treats a filled-in hidden field as a bot, without saying why", () => {
    const result = parseEnquiry({ ...valid, website: "http://spam.example" }, NOW);
    expect(result).toEqual({ ok: false, errors: {}, spam: true });
  });

  describe("the site visit", () => {
    it("accepts a time a day ahead", () => {
      const result = parseEnquiry({ ...valid, visitAt: "2026-11-02T10:00" }, NOW);
      expect(result.ok && result.value.visitAt?.toISOString()).toBe("2026-11-02T04:30:00.000Z");
    });

    it("rejects the past, and the next hour", () => {
      expect(parseEnquiry({ ...valid, visitAt: "2026-10-31T10:00" }, NOW).ok).toBe(false);
      expect(parseEnquiry({ ...valid, visitAt: "2026-11-01T12:00" }, NOW).ok).toBe(false);
      expect(parseEnquiry({ ...valid, visitAt: "2026-11-01T13:00" }, NOW).ok).toBe(true);
    });

    it("rejects a date more than 90 days away, and nonsense", () => {
      expect(parseEnquiry({ ...valid, visitAt: "2027-03-01T10:00" }, NOW).ok).toBe(false);
      const bad = parseEnquiry({ ...valid, visitAt: "next week" }, NOW);
      expect(!bad.ok && bad.errors.visitAt).toBeTruthy();
    });
  });
});

describe("csv", () => {
  it("quotes cells that need it", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(5)).toBe("5");
  });

  it.each(["=SUM(A1)", "+91 98765", "-1", "@cmd", "\tx", "\rx"])(
    "defuses a cell that a spreadsheet would run as a formula: %j",
    (value) => {
      expect(csvCell(value).replace(/^"/, "").startsWith("'")).toBe(true);
    },
  );

  it("does not touch a minus sign in the middle", () => {
    expect(csvCell("A-12")).toBe("A-12");
  });

  it("builds a file with a header, one row per lead and a byte order mark", () => {
    const file = leadsToCsv([
      {
        createdAt: new Date("2026-11-01T06:00:00.000Z"),
        name: '=HYPERLINK("http://evil.example")',
        mobile: "9876543210",
        mobileVerified: false,
        email: "a@b.example",
        projectName: "Green Valley, Phase 2",
        preferredPlot: null,
        message: "Hello\nthere",
        status: "NEW",
        followUpAt: null,
      },
    ]);
    const lines = file.replace("﻿", "").split("\r\n");
    expect(file.startsWith("﻿")).toBe(true);
    expect(lines[0]).toBe(
      "Received,Name,Mobile,Mobile verified,Email,Project,Plot,Message,Status,Follow up",
    );
    expect(file).toContain('"\'=HYPERLINK(""http://evil.example"")"');
    expect(file).toContain('"Green Valley, Phase 2"');
    expect(file).toContain(",No,");
    expect(file).toContain(",New,");
  });
});
