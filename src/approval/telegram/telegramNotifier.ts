// OPTIONAL Telegram channel (D-E), via grammY (D-079). Active only when APPROVAL_CHANNELS includes
// telegram AND TELEGRAM_BOT_TOKEN is set. Long polling (no public URL). Messages are PLAIN TEXT:
// no parse_mode, so document-derived text cannot inject markup. Only allowed chat ids can act.
// Bot API names used here were read from the installed grammy / @grammyjs/types definitions;
// VERIFY them (and the callback_data limit, "1-64 bytes" in those types) in the official docs.

import { Bot, InlineKeyboard, InputFile } from 'grammy';
import type { AuditLog } from '../../state/audit.js';
import type { ActionHandler, ApprovalAction, MessageRef, NoticeCard, Notifier, PackCard } from '../notifier.js';

const CODES: Record<ApprovalAction, string> = { approve: 'a', open: 'o', skip: 's' };

/** Short opaque callback data, e.g. 'a:12' (well under the 64-byte limit). */
export function encodeCallback(action: ApprovalAction, packId: number): string {
  return `${CODES[action]}:${packId}`;
}

export function decodeCallback(data: string): { action: ApprovalAction; packId: number } | null {
  const match = /^([aos]):(\d{1,9})$/.exec(data);
  if (!match) return null;
  const action = (Object.entries(CODES).find(([, code]) => code === match[1])?.[0] ?? 'open') as ApprovalAction;
  return { action, packId: Number(match[2]) };
}

export function keyboardFor(packId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('Approve', encodeCallback('approve', packId))
    .text('Open', encodeCallback('open', packId))
    .text('Skip', encodeCallback('skip', packId));
}

/** "chatId:messageId" pairs, comma separated, for every allowed chat that received the card. */
function joinRefs(refs: Array<[string, number]>): string {
  return refs.map(([chat, message]) => `${chat}:${message}`).join(',');
}

function splitRefs(value: string): Array<[string, number]> {
  return value
    .split(',')
    .map((pair) => pair.split(':'))
    .filter((parts): parts is [string, string] => parts.length === 2)
    .map(([chat, message]) => [chat, Number(message)]);
}

export interface TelegramNotifierOptions {
  /** From the validated env only. Never logged. */
  token: string;
  allowedChatIds: readonly string[];
  audit?: AuditLog;
  /** Injectable for tests. */
  bot?: Bot;
}

export class TelegramNotifier implements Notifier {
  readonly channel = 'telegram' as const;
  private readonly bot: Bot;

  constructor(private readonly options: TelegramNotifierOptions) {
    this.bot = options.bot ?? new Bot(options.token);
  }

  isAllowedChat(chatId: number | string | undefined): boolean {
    return chatId !== undefined && this.options.allowedChatIds.includes(String(chatId));
  }

  async start(handler: ActionHandler): Promise<void> {
    this.bot.on('callback_query:data', async (ctx) => {
      const chatId = ctx.callbackQuery.message?.chat.id;
      if (!this.isAllowedChat(chatId)) {
        this.options.audit?.recordAudit({ type: 'unauthorised_attempt', actor: 'system', details: { reason: 'telegram chat not allowed', channel: 'telegram' } });
        await ctx.answerCallbackQuery({ text: 'Not allowed.' });
        return;
      }
      const parsed = decodeCallback(ctx.callbackQuery.data);
      if (!parsed) {
        await ctx.answerCallbackQuery({ text: 'Unknown button.' });
        return;
      }
      const result = await handler({ ...parsed, actor: `broker:telegram:${chatId}`, channel: 'telegram' });
      await ctx.answerCallbackQuery({ text: result.message.slice(0, 190) });
      const messageId = ctx.callbackQuery.message?.message_id;
      if (result.kind === 'ok' && result.action === 'open' && result.xlsxPath) {
        await this.bot.api.sendDocument(String(chatId), new InputFile(result.xlsxPath));
      } else if (result.kind === 'ok' && messageId !== undefined) {
        const original = ctx.callbackQuery.message?.text ?? '';
        // No reply_markup: the edited message has no buttons.
        await this.bot.api.editMessageText(String(chatId), messageId, `${original}\n\n${result.action === 'approve' ? 'APPROVED' : 'SKIPPED'}: ${result.message}`);
      }
    });
    this.bot.catch(() => {
      this.options.audit?.recordAudit({ type: 'notification_failed', actor: 'system', details: { channel: 'telegram', stage: 'polling' } });
    });
    // Long polling in the background; bot.stop() ends it.
    void this.bot.start();
  }

  async stop(): Promise<void> {
    if (this.bot.isRunning()) await this.bot.stop();
  }

  private async sendToAll(text: string, withButtonsFor?: number): Promise<{ externalMessageId: string }> {
    const refs: Array<[string, number]> = [];
    for (const chatId of this.options.allowedChatIds) {
      const message = await this.bot.api.sendMessage(chatId, text, withButtonsFor === undefined ? {} : { reply_markup: keyboardFor(withButtonsFor) });
      refs.push([chatId, message.message_id]);
    }
    return { externalMessageId: joinRefs(refs) };
  }

  sendPack(card: PackCard) {
    return this.sendToAll(card.text, card.packId);
  }

  sendNotice(card: NoticeCard) {
    return this.sendToAll(card.text);
  }

  sendReminder(card: PackCard) {
    return this.sendToAll(card.text, card.packId);
  }

  async markResolved(ref: MessageRef, text: string): Promise<void> {
    for (const [chatId, messageId] of splitRefs(ref.externalMessageId)) {
      await this.bot.api.editMessageText(chatId, messageId, text);
    }
  }

  /** Readiness check: does the token authenticate? Returns the bot username (never the token). */
  async checkConnection(): Promise<string> {
    const me = await this.bot.api.getMe();
    return me.username;
  }
}
