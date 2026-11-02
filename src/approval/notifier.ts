// The approval channel interface (D-E). The rest of the code talks ONLY to this interface;
// it never imports the web server or Telegram directly. Adapters translate a button press into
// a call to the shared core (handleAction) and display the result.

import type { AuditActor } from '../state/audit.js';

export type ApprovalAction = 'approve' | 'open' | 'skip';
export type NotifierChannel = 'web' | 'telegram';
export type ActionChannel = NotifierChannel | 'cli';

export interface ActionRequest {
  action: ApprovalAction;
  packId: number;
  actor: AuditActor;
  channel: ActionChannel;
}

export type ActionResult =
  | {
      kind: 'ok';
      action: ApprovalAction;
      packId: number;
      message: string;
      /** Open only: absolute path of the xlsx, taken from the database (never from the request). */
      xlsxPath?: string;
      /** Open only: short list of flagged items. */
      flagged?: string[];
    }
  | { kind: 'already_done'; packId: number; decision: 'approved' | 'skipped'; message: string }
  | { kind: 'superseded'; packId: number; currentVersion: number; message: string }
  | { kind: 'not_found'; packId: number; message: string }
  | { kind: 'not_allowed'; packId: number; message: string }
  | { kind: 'wrong_state'; packId: number; status: string; message: string };

export type ActionHandler = (request: ActionRequest) => Promise<ActionResult>;

/** A pack card: plain text (no markup), short enough for a phone. */
export interface PackCard {
  packId: number;
  caseId: number;
  policyId: string;
  version: number;
  title: string;
  lines: string[];
  /** title + lines joined, as sent to text channels. */
  text: string;
}

/** A needs_attention notice: reason in plain words, NO buttons. */
export interface NoticeCard {
  caseId: number;
  policyId: string;
  cause: string;
  text: string;
}

export interface MessageRef {
  channel: NotifierChannel;
  externalMessageId: string;
}

export interface Notifier {
  readonly channel: NotifierChannel;
  /** Begin accepting button presses; every press goes to handler. */
  start(handler: ActionHandler): Promise<void>;
  stop(): Promise<void>;
  sendPack(card: PackCard): Promise<{ externalMessageId: string }>;
  sendNotice(card: NoticeCard): Promise<{ externalMessageId: string }>;
  /** Replace a card's buttons with a final line (e.g. "Replaced by version 2"). */
  markResolved(ref: MessageRef, text: string): Promise<void>;
  sendReminder(card: PackCard): Promise<{ externalMessageId: string }>;
}

export interface FakeNotifierRecord {
  kind: 'pack' | 'notice' | 'reminder' | 'resolved';
  id: string;
  text: string;
  packId?: number;
}

/** Test double: records everything; can be told to fail. */
export class FakeNotifier implements Notifier {
  readonly records: FakeNotifierRecord[] = [];
  handler: ActionHandler | null = null;
  started = false;
  /** Number of upcoming calls that should fail (Infinity = always). */
  failures = 0;
  attempts = 0;
  private seq = 0;

  constructor(readonly channel: NotifierChannel = 'web') {}

  private maybeFail(): void {
    this.attempts++;
    if (this.failures > 0) {
      this.failures--;
      throw new Error(`FakeNotifier (${this.channel}) was told to fail`);
    }
  }

  private record(kind: FakeNotifierRecord['kind'], text: string, packId?: number): { externalMessageId: string } {
    const id = `fake-${this.channel}-${++this.seq}`;
    this.records.push({ kind, id, text, ...(packId === undefined ? {} : { packId }) });
    return { externalMessageId: id };
  }

  async start(handler: ActionHandler): Promise<void> {
    this.handler = handler;
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
    this.handler = null;
  }

  async sendPack(card: PackCard) {
    this.maybeFail();
    return this.record('pack', card.text, card.packId);
  }

  async sendNotice(card: NoticeCard) {
    this.maybeFail();
    return this.record('notice', card.text);
  }

  async markResolved(ref: MessageRef, text: string): Promise<void> {
    this.maybeFail();
    this.records.push({ kind: 'resolved', id: ref.externalMessageId, text });
  }

  async sendReminder(card: PackCard) {
    this.maybeFail();
    return this.record('reminder', card.text, card.packId);
  }
}
