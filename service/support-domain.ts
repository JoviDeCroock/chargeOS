import {
  SUPPORT_CLOSE_CONFIRMATION,
  supportTopics,
  type SupportAction,
  type SupportStatus,
} from "../shared/support.js";
import { hashBytes, HttpError, objectInput, textValue } from "./http.js";

export function supportFingerprint(
  org: string,
  actorId: string,
  caseId: string,
  action: SupportAction,
  expected: number,
  payload: Record<string, string | null>,
): Promise<string> {
  return hashBytes(
    new TextEncoder().encode(
      JSON.stringify({
        org,
        actorId,
        caseId: action === "created" ? null : caseId,
        action,
        expected,
        payload:
          action === "created"
            ? {
                subject: payload.subject,
                topic: payload.topic,
                statementId: payload.statementId,
                message: payload.message,
              }
            : payload,
      }),
    ),
  );
}

export const supportId = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    throw new HttpError(400, "Invalid case reference");
  return value;
};
export function supportMessage(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "Describe the issue or next action");
  const message = value.replaceAll("\r\n", "\n").trim();
  if (
    !message ||
    message.length > 2000 ||
    new TextEncoder().encode(message).length > 8000 ||
    Array.from(message).some((char) => {
      const code = char.charCodeAt(0);
      return (code < 32 && code !== 9 && code !== 10) || code === 127;
    })
  )
    throw new HttpError(400, "Use a message of up to 2,000 characters without control characters");
  return message;
}
export function supportPayload(action: SupportAction, raw: unknown): Record<string, string | null> {
  const keys =
    action === "created"
      ? ["subject", "topic", "statementId", "statementSha256", "assigneeId", "message"]
      : action === "assign"
        ? ["assigneeId"]
        : action === "resolve"
          ? ["message", "resolution"]
          : action === "close"
            ? ["confirmation"]
            : ["message"];
  const body = objectInput(raw, keys);
  if (Object.keys(body).length !== keys.length)
    throw new HttpError(400, "Complete all case fields");
  if (action === "created") {
    if (!supportTopics.includes(body.topic as (typeof supportTopics)[number]))
      throw new HttpError(400, "Choose an issue type");
    if (
      body.statementId === null
        ? body.statementSha256 !== null
        : typeof body.statementSha256 !== "string" || !/^[a-f0-9]{64}$/.test(body.statementSha256)
    )
      throw new HttpError(400, "Invalid statement context");
    return {
      subject: textValue(body.subject, 120),
      topic: body.topic as string,
      statementId: body.statementId === null ? null : supportId(body.statementId),
      statementSha256: body.statementSha256 as string | null,
      assigneeId: supportId(body.assigneeId),
      message: supportMessage(body.message),
    };
  }
  if (action === "assign") return { assigneeId: supportId(body.assigneeId) };
  if (action === "close") {
    if (body.confirmation !== SUPPORT_CLOSE_CONFIRMATION)
      throw new HttpError(400, "Confirm that you checked the resolution");
    return { confirmation: SUPPORT_CLOSE_CONFIRMATION };
  }
  if (action === "resolve") {
    if (
      !["answer-provided", "record-reviewed", "external-follow-up-complete"].includes(
        body.resolution as string,
      )
    )
      throw new HttpError(400, "Choose a resolution");
    return { message: supportMessage(body.message), resolution: body.resolution as string };
  }
  return { message: supportMessage(body.message) };
}
export interface SupportState {
  status: SupportStatus;
  assigneeId: string;
  reporterId: string;
}
export function supportTransition(
  state: SupportState,
  action: SupportAction,
  actor: string,
  role: string,
  payload: Record<string, string | null>,
): SupportState {
  const reporter = actor === state.reporterId,
    staff = ["admin", "finance"].includes(role),
    responsible = staff && (role === "admin" || actor === state.assigneeId);
  if (action === "created") throw new HttpError(409, "This case already exists");
  if (action === "reopen") {
    if (!reporter) throw new HttpError(403, "Only the reporter can reopen this case");
    if (!["resolved", "closed"].includes(state.status))
      throw new HttpError(409, "This case is already open");
    return { ...state, status: "open" };
  }
  if (state.status === "closed")
    throw new HttpError(409, "The reporter must reopen this case before another update");
  if (action === "close") {
    if (!reporter) throw new HttpError(403, "Only the reporter can confirm closure");
    if (state.status !== "resolved")
      throw new HttpError(409, "Check the current resolution before closing this case");
    return { ...state, status: "closed" };
  }
  if (action === "assign") {
    if (!staff) throw new HttpError(403, "Finance or administrator access required");
    return { ...state, assigneeId: payload.assigneeId! };
  }
  if (action === "reply") {
    if (!reporter && !staff) throw new HttpError(403, "Case access required");
    return {
      ...state,
      status: reporter ? "open" : state.status === "resolved" ? "open" : state.status,
    };
  }
  if (!responsible)
    throw new HttpError(403, "The assigned person or an administrator must handle this action");
  return { ...state, status: action === "resolve" ? "resolved" : "waiting-for-reporter" };
}
