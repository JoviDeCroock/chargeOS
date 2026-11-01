export interface RecoveryEnrollmentStatus {
  mode: "recovery-enrollment";
  user: { name: string; email: string };
  phase: "set-authenticator" | "verify-authenticator" | "ready";
  expiresAt: string;
  reopeningAllowed: false;
}
export interface RecoveryEnrollmentAuthentication {
  challengeRequired: boolean;
  reopeningAllowed: false;
}
export interface RecoveryEnrollmentAuthenticator {
  totpURI: string;
  backupCodes: string[];
}
