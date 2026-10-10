import type {Bot, SendMessageParams} from 'node-telegram-bot-api';
import {setTimeout as wait} from 'node:timers/promises';
import {getTelegramErrorBody, isBlockedError} from '../tools/passTgEx';

export interface BroadcastRecipient {
  id: string;
  languageCode?: string | null;
}

export interface BroadcastTexts {
  ru: string;
  en: string;
}

export function getBroadcastText(texts: BroadcastTexts, languageCode?: string | null) {
  return languageCode?.toLowerCase().split('-')[0] === 'ru' ? texts.ru : texts.en;
}

export function isBroadcastText(text: string) {
  return text.trim().length > 0 && text.length <= 4096;
}

export default class Broadcast {
  private controller?: AbortController;

  constructor(
    private api: Pick<Bot['api'], 'sendMessage'>,
    private getRecipients: (afterId: string, limit: number) => Promise<BroadcastRecipient[]>,
  ) {}

  get isRunning() {
    return Boolean(this.controller);
  }

  stop = () => {
    this.controller?.abort();
  };

  private async sendMessage(params: SendMessageParams, signal: AbortSignal) {
    // The injected bot API applies the same global limiter as regular notifications.
    try {
      await this.api.sendMessage(params, signal);
    } catch (error) {
      const body = getTelegramErrorBody(error);
      if (body?.error_code !== 429 || !body.parameters?.retry_after) throw error;
      await wait(body.parameters.retry_after * 1000, undefined, {signal});
      await this.api.sendMessage(params, signal);
    }
  }

  async send(texts: BroadcastTexts) {
    if (this.isRunning) throw new Error('Broadcast is already running');
    if (!isBroadcastText(texts.ru) || !isBroadcastText(texts.en)) {
      throw new Error('Both broadcast texts must contain 1–4096 characters');
    }
    const controller = new AbortController();
    this.controller = controller;
    const result = {sent: 0, blocked: 0, failed: 0, stopped: false};
    let afterId = '';
    try {
      while (!controller.signal.aborted) {
        const recipients = await this.getRecipients(afterId, 100);
        if (!recipients.length) break;
        for (const recipient of recipients) {
          if (controller.signal.aborted) break;
          const params = {
            chat_id: recipient.id,
            text: getBroadcastText(texts, recipient.languageCode),
          };
          try {
            await this.sendMessage(params, controller.signal);
            result.sent++;
          } catch (error) {
            if (controller.signal.aborted) break;
            if (isBlockedError(error)) result.blocked++;
            else result.failed++;
          }
        }
        afterId = recipients[recipients.length - 1].id;
      }
      result.stopped = controller.signal.aborted;
      return result;
    } finally {
      this.controller = undefined;
    }
  }
}
