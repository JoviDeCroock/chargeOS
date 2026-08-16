export const OWNER_TAG_REVOCATION_CONFIRMATION =
  "I understand this tag may remain usable until the charger accepts the replacement owner list" as const;

export interface OwnerTagAddInput {
  readonly tag: string;
}

export interface OwnerTagRevokeInput {
  readonly confirmation: typeof OWNER_TAG_REVOCATION_CONFIRMATION;
}

export interface OwnerTagMutationResult {
  readonly stateVersion: number;
  readonly tagCount: number;
  readonly tagPseudonym: string;
}
