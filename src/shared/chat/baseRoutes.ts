import type {Bot, Chat as TelegramChat} from 'node-telegram-bot-api';
import type QuickLRU from 'quick-lru';
import LogFile from '../logFile';
import Router from '../router';
import {getDebug} from '../tools/getDebug';

const debug = getDebug('app:Chat');

export interface BaseRoutesContext {
  bot: Pick<Bot, 'api'>;
  db: {
    changeChatId(sourceChatId: string, targetChatId: string): Promise<unknown>;
  };
}

export interface CommandTracker {
  track(chatId: string | number, params: {[key: string]: string | number}): void;
}

export default function registerBaseRoutes(
  main: BaseRoutesContext,
  router: Router,
  log: LogFile,
  chatIdAdminIdsCache: QuickLRU<number, number[]>,
  tracker: CommandTracker,
) {
  router.message(async (req, res, next) => {
    const {migrate_to_chat_id: targetChatId, migrate_from_chat_id: sourceChatId} = req.message;
    if (targetChatId || sourceChatId) {
      try {
        if (targetChatId) {
          await main.db.changeChatId('' + req.chatId, '' + targetChatId);
          log.write(`[migrate msg] ${req.chatId} > ${targetChatId}`);
        }
        if (sourceChatId) {
          await main.db.changeChatId('' + sourceChatId, '' + req.chatId);
          log.write(`[migrate msg] ${req.chatId} < ${sourceChatId}`);
        }
        await next();
      } catch (err) {
        debug('Process message %s %j error %o', req.chatId, req.message, err);
      }
    } else {
      await next();
    }
  });

  router.callback_query(async (req, res, next) => {
    await main.bot.api.answerCallbackQuery({callback_query_id: req.callback_query.id});
    await next();
  });

  router.textOrCallbackQuery(async (req, res, next) => {
    if (['group', 'supergroup'].includes(req.chatType)) {
      const message = req.message || req.callback_query.message;
      if (
        message &&
        (message.chat as TelegramChat & {all_members_are_administrators?: boolean})
          .all_members_are_administrators
      ) {
        return next();
      }

      try {
        let adminIds = chatIdAdminIdsCache.get(req.chatId);
        if (!adminIds) {
          const chatMembers = await main.bot.api.getChatAdministrators({
            chat_id: req.chatId,
          });
          adminIds = chatMembers.map((chatMember) => chatMember.user.id);
          chatIdAdminIdsCache.set(req.chatId, adminIds);
        }
        if (req.fromId && adminIds.includes(req.fromId)) {
          await next();
        }
      } catch (err) {
        debug('getChatAdministrators error %s %j error %o', req.chatId, req.message, err);
      }
    } else {
      await next();
    }
  });

  router.textOrCallbackQuery(/(.+)/, (req, res, next) => {
    const nextPromise = next();
    if (req.message) {
      tracker.track(req.chatId, {
        ec: 'command',
        ea: req.command,
        el: req.message.text,
        t: 'event',
      });
    } else if (req.callback_query) {
      const data = req.callback_query.data;
      let command = '';
      const m = /(\/[^?\s]+)/.exec(data);
      if (m) {
        command = m[1];
      }
      const msg = Object.assign({}, req.callback_query.message, {
        text: data,
        from: req.callback_query.from,
      });
      tracker.track(msg.chat.id, {
        ec: 'command',
        ea: command,
        el: msg.text,
        t: 'event',
      });
    }
    return nextPromise;
  });

  router.text(/\/ping/, async (req, res) => {
    try {
      await main.bot.api.sendMessage({chat_id: req.chatId, text: 'pong'});
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });
}
