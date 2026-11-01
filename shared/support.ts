import type { OrganizationRole } from "./service.js";

export const supportTopics = [
  "statement-amount",
  "missing-session",
  "eligibility",
  "account",
  "other",
] as const;
export type SupportTopic = (typeof supportTopics)[number];
export type SupportStatus = "open" | "waiting-for-reporter" | "resolved" | "closed";
export type SupportAction =
  | "created"
  | "reply"
  | "assign"
  | "request-information"
  | "resolve"
  | "close"
  | "reopen";
export type SupportResolution =
  | "answer-provided"
  | "record-reviewed"
  | "external-follow-up-complete";
export const SUPPORT_CLOSE_CONFIRMATION = "I checked the answer and confirm this issue is resolved";
export interface SupportCaseSummary {
  id: string;
  subject: string;
  topic: SupportTopic;
  status: SupportStatus;
  revision: number;
  reporter: { id: string; name: string };
  assignee: { id: string; name: string; available: boolean };
  statement: { id: string; snapshotSha256: string } | null;
  createdAt: string;
  updatedAt: string;
}
export interface SupportEvent {
  id: string;
  revision: number;
  action: SupportAction;
  actor: { id: string; name: string; role: OrganizationRole };
  message: string | null;
  assigneeId: string | null;
  resolution: SupportResolution | null;
  createdAt: string;
}
export interface SupportCaseDetail {
  case: SupportCaseSummary;
  events: SupportEvent[];
  olderBefore: number | null;
}
export interface SupportWorkspaceData {
  cases: SupportCaseSummary[];
  nextBefore: { createdAt: number; id: string } | null;
  assignees: { id: string; name: string }[];
}
