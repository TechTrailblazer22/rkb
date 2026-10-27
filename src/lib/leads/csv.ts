import type { LeadStatus } from "@/generated/prisma/enums";
import { leadStatusLabel } from "@/lib/leads/status";

// The builder's export of their leads. Buyers type these values, so each cell is made safe to open
// in a spreadsheet.

/**
 * One CSV cell. Quotes and commas are handled the standard way. A cell that starts with =, +, -, @,
 * a tab or a carriage return would be run as a formula by Excel or Sheets, so a buyer could plant
 * one in a builder's export; those get a leading apostrophe, which spreadsheets show as plain text.
 */
export function csvCell(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export type ExportLead = {
  createdAt: Date;
  name: string;
  mobile: string;
  mobileVerified: boolean;
  email: string;
  projectName: string;
  preferredPlot: string | null;
  message: string | null;
  status: LeadStatus;
  followUpAt: Date | null;
};

const HEADER = [
  "Received",
  "Name",
  "Mobile",
  "Mobile verified",
  "Email",
  "Project",
  "Plot",
  "Message",
  "Status",
  "Follow up",
];

export function leadsToCsv(leads: ExportLead[]): string {
  const rows = leads.map((lead) =>
    [
      lead.createdAt,
      lead.name,
      lead.mobile,
      lead.mobileVerified ? "Yes" : "No",
      lead.email,
      lead.projectName,
      lead.preferredPlot,
      lead.message,
      leadStatusLabel[lead.status],
      lead.followUpAt,
    ]
      .map(csvCell)
      .join(","),
  );
  // A byte order mark makes Excel read the file as UTF-8 (names and messages are not only ASCII).
  return `﻿${[HEADER.join(","), ...rows].join("\r\n")}\r\n`;
}
