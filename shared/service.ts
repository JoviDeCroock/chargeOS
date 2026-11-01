/** Commercial accounts are separate from the physical owner/edge authority. */
export type OrganizationRole = "admin" | "finance" | "driver";
export interface ServiceOrganization {
  id: string;
  name: string;
  role: OrganizationRole;
}
export interface ServiceAccount {
  mode: "local-development";
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    twoFactorEnabled: boolean;
  };
  organizations: ServiceOrganization[];
}
export interface OrganizationMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: OrganizationRole;
}
export interface OrganizationInvitation {
  id: string;
  email: string;
  role: "finance" | "driver";
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
}
export interface OrganizationWorkspace {
  organization: ServiceOrganization;
  members: OrganizationMember[];
  invitations: OrganizationInvitation[];
}
export interface ServiceError {
  error: string;
}
export interface ServiceHealth {
  mode: "local-development";
  delivery: "operator-only-local-outbox" | "smtp-queue";
  chargerControl: false;
}
export interface ServiceAuditEvent {
  id: string;
  actorId: string | null;
  recoveryReleaseId: string | null;
  action: string;
  subjectId: string;
  createdAt: number;
}
