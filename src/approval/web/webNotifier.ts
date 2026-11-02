// The web channel as a Notifier. Cards are rendered from the database by the page itself,
// so "sending" only records that the card is available. markResolved is a no-op: the page
// always shows the current state.

import type { ActionHandler, MessageRef, NoticeCard, Notifier, PackCard } from '../notifier.js';
import type { WebApprovalServer } from './server.js';

export class WebNotifier implements Notifier {
  readonly channel = 'web' as const;

  /** server is null for one-off CLI runs (no page is served; cards appear when serve runs). */
  constructor(private readonly server: WebApprovalServer | null) {}

  async start(handler: ActionHandler): Promise<void> {
    await this.server?.start(handler);
  }

  async stop(): Promise<void> {
    await this.server?.stop();
  }

  async sendPack(card: PackCard) {
    return { externalMessageId: `web:pack:${card.packId}` };
  }

  async sendNotice(card: NoticeCard) {
    return { externalMessageId: `web:notice:${card.caseId}` };
  }

  async markResolved(_ref: MessageRef, _text: string): Promise<void> {}

  async sendReminder(card: PackCard) {
    return { externalMessageId: `web:reminder:${card.packId}` };
  }
}
