// UploadJob states and transitions (docs/UPLOADS.md "UploadJob states"). Tested like the status machine.

export const UPLOAD_MODES = ['attach', 'new'] as const;
export type UploadMode = (typeof UPLOAD_MODES)[number];

export const UPLOAD_STATUSES = ['received', 'validating', 'extracting', 'comparing', 'done', 'failed', 'rejected'] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export const UPLOAD_SIDES = ['expiring', 'renewal'] as const;
export type UploadSide = (typeof UPLOAD_SIDES)[number];

/** Everything not listed is forbidden. done, failed and rejected are terminal. */
export const UPLOAD_TRANSITIONS: Readonly<Record<UploadStatus, readonly UploadStatus[]>> = {
  received: ['validating', 'rejected', 'failed'],
  validating: ['extracting', 'rejected', 'failed'],
  extracting: ['comparing', 'failed'],
  comparing: ['done', 'failed'],
  done: [],
  failed: [],
  rejected: [],
};

/** States in which work is still going on (used for "busy" and startup recovery). */
export const RUNNING_UPLOAD_STATUSES: readonly UploadStatus[] = ['received', 'validating', 'extracting', 'comparing'];
export const TERMINAL_UPLOAD_STATUSES: readonly UploadStatus[] = ['done', 'failed', 'rejected'];

export class InvalidUploadTransitionError extends Error {
  readonly code = 'invalid_upload_transition';

  constructor(
    readonly uploadId: number,
    readonly from: UploadStatus,
    readonly to: UploadStatus,
  ) {
    super(`Upload job ${uploadId}: ${from} -> ${to} is not allowed`);
    this.name = 'InvalidUploadTransitionError';
  }
}

export function canUploadTransition(from: UploadStatus, to: UploadStatus): boolean {
  return UPLOAD_TRANSITIONS[from].includes(to);
}

export function assertUploadTransition(uploadId: number, from: UploadStatus, to: UploadStatus): void {
  if (!canUploadTransition(from, to)) throw new InvalidUploadTransitionError(uploadId, from, to);
}
