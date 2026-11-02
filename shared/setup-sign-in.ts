/**
 * Proof that a console tab really belongs to the deployment the setup wizard just created, before
 * the wizard hands it the owner token. The wizard sends a fresh random challenge; the console asks
 * its own server for an HMAC of it keyed by the owner token; the wizard recomputes it with the
 * token it holds and only then sends the token. A page at a mistyped or stale hostname cannot
 * answer, so it never receives the token.
 */
export const SETUP_SIGN_IN_PROOF_PATH = "/api/v1/setup-sign-in/proof";
export const SETUP_SIGN_IN_PROOF_CONTEXT = "chargeos-setup-sign-in-v1\n";
export const SETUP_SIGN_IN_CHALLENGE = /^[a-f0-9]{64}$/u;
export const SETUP_SIGN_IN_PROOF = /^[a-f0-9]{64}$/u;

export interface SetupSignInProofInput {
  readonly challenge: string;
}

export interface SetupSignInProofResponse {
  readonly proof: string;
}
