import type {InlineKeyboardButton, ParseMode, SendMessageParams} from 'node-telegram-bot-api';
import {appConfig} from '../appConfig';
import {
  ChannelModel,
  ChatModel,
  ChatModelWithOptionalChannel,
  NewChat,
  StreamModelWithChannel,
} from '../db';
import ChatSender from '../chatSender';
import Main from '../main';
import LogFile from '../shared/logFile';
import Locale from '../shared/locale';
import createEditOrSendNewMessage from '../shared/chat/editOrSendNewMessage';
import createUserMiddlewares from '../shared/chat/userMiddlewares';
import Router, {
  RouterCallbackQueryReq,
  RouterReq,
  RouterRes,
  RouterTextReq,
} from '../shared/router';
import arrayByPart from '../shared/tools/arrayByPart';
import ensureMap from '../shared/tools/ensureMap';
import ErrorWithCode from '../shared/tools/errorWithCode';
import {getDebug} from '../shared/tools/getDebug';
import htmlSanitize from '../shared/tools/htmlSanitize';
import parallel from '../shared/tools/parallel';
import {ErrEnum, errHandler, passEx} from '../shared/tools/passTgEx';
import splitTextByPages from '../shared/tools/splitTextByPages';
import pageBtnList from '../tools/pageBtnList';
import {getStreamAsButtonText, getStreamAsText} from '../tools/streamToString';
import {tracker} from '../tracker';

const debug = getDebug('app:Chat');

export default function registerUserRoutes(main: Main, router: Router, log: LogFile) {
  const {provideChat, provideChannels, withChannels} = createUserMiddlewares({
    router,
    api: main.bot.api,
    ensureChat: (chatId) => main.db.ensureChat(chatId),
    getChannels: (chatId) => main.db.getChannelsByChatId(chatId),
    getUnknownErrorText: (locale) => locale.m('alert_unknown-error'),
    getEmptyChannelsText: (locale) => locale.m('alert_empty-channel-list'),
  });
  const editOrSendNewMessage = createEditOrSendNewMessage(main.bot.api);

  router.callback_query(/\/cancel\/(?<command>[^\s]+)/, async (req, res) => {
    const {locale} = res;
    const command = req.params.command;

    try {
      const cancelText = locale.m('alert_command-canceled', {command: command});
      await main.bot.api.editMessageText({
        text: cancelText,
        chat_id: req.chatId,
        message_id: req.messageId,
      });
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.textOrCallbackQuery(/\/add(?:\s+(?<query>.+$))?/, provideChat, async (req, res) => {
    const {locale} = res;

    let requestedData: string | undefined;
    let requestedService: string | undefined;
    try {
      const {value: query, messageId: qMessageId} = await askParam({
        locale,
        req,
        value: req.params.query,
        messageText: locale.m('context_enter-channel-name', {
          example: appConfig.defaultChannelName,
        }),
      });
      requestedData = query;

      const options = main.services.map((service) => {
        return {
          name: service.name,
          value: service.id,
        };
      });

      const {value: serviceId, messageId} = await askChoose({
        locale,
        req,
        messageId: qMessageId,
        messageText: locale.m('context_enter-service'),
        options,
        value: main.services.find((service) => service.match(query))?.id,
      });
      requestedService = serviceId;
      const service = main.services.find(({id}) => serviceId === id);
      if (!service) {
        throw new Error('Service is not found');
      }

      let channel: ChannelModel;
      let created: boolean;
      try {
        const count = await main.db.getChannelCountByChatId('' + req.chatId);
        if (count >= 100) {
          throw new ErrorWithCode('Channels limit exceeded', 'CHANNELS_LIMIT');
        }

        const serviceChannel = await service.findChannel(query);

        channel = await main.db.ensureChannel(service, serviceChannel);

        created = await main.db.putChatIdChannelId('' + req.chatId, channel.id);
      } catch (error) {
        const err = error as ErrorWithCode;
        let isResolved = false;
        let message = null;
        if (['CHANNEL_BROADCASTS_IS_NOT_FOUND'].includes(err.code)) {
          isResolved = true;
          message = locale.m('alert_channel-broadcasts-not-found', {
            channelName: query,
            serviceName: service.name,
          });
        } else if (
          [
            'INCORRECT_CHANNEL_ID',
            'CHANNEL_BY_VIDEO_ID_IS_NOT_FOUND',
            'INCORRECT_USERNAME',
            'CHANNEL_BY_USER_IS_NOT_FOUND',
            'QUERY_IS_EMPTY',
            'CHANNEL_BY_QUERY_IS_NOT_FOUND',
            'CHANNEL_BY_ID_IS_NOT_FOUND',
          ].includes(err.code)
        ) {
          isResolved = true;
          message = locale.m('alert_channel-not-found', {
            channelName: query,
            serviceName: service.name,
          });
        } else if (['CHANNEL_IN_BLACK_LIST', 'CHANNELS_LIMIT'].includes(err.code)) {
          isResolved = true;
          if (err.code === 'CHANNEL_IN_BLACK_LIST') {
            message = locale.m('alert_channel-in_blacklist');
          } else if (err.code === 'CHANNELS_LIMIT') {
            message = locale.m('alert_channel-limit-exceeded');
          } else {
            message = err.message;
          }
        } else {
          message = locale.m('alert_unexpected-error');
        }
        await editOrSendNewMessage(req.chatId, messageId, message, {
          link_preview_options: {is_disabled: true},
        });
        if (!isResolved) {
          throw err;
        }
        return;
      }

      let message;
      if (!created) {
        message = locale.m('alert_channel-exists');
      } else {
        const {title, url} = channel;
        message = locale.m('alert_channel-added', {
          channelName: htmlSanitize('a', title, url),
          serviceName: htmlSanitize('', service.name),
        });
      }

      await editOrSendNewMessage(req.chatId, messageId, message, {
        link_preview_options: {is_disabled: true},
        parse_mode: 'HTML',
      });

      const streams = await main.db.getStreamsWithChannelByChannelIds([channel.id]);

      const chatSender = new ChatSender(main, req.chat);
      await parallel(1, streams, (stream) => {
        if (!stream.isOffline && !stream.isTimeout) {
          return chatSender.sendStream(stream);
        }
      });
    } catch (error) {
      const err = error as ErrorWithCode;
      if (['RESPONSE_COMMAND', 'RESPONSE_TIMEOUT', 'RESPONSE_CANCEL'].includes(err.code)) {
        // pass
      } else {
        debug('%j %j %j error %o', req.command, requestedData, requestedService, err);
      }
    }
  });

  router.callback_query(/\/clear\/confirmed/, async (req, res) => {
    const {locale} = res;

    try {
      await main.db.deleteChatById('' + req.chatId);
      log.write(`[deleted] ${req.chatId}, cause: /clear`);

      await main.bot.api.editMessageText({
        text: locale.m('alert_cleared'),
        chat_id: req.chatId,
        message_id: req.messageId,
      });
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.textOrCallbackQuery(/\/clear/, async (req, res) => {
    const {locale} = res;

    try {
      await main.bot.api.sendMessage({
        chat_id: req.chatId,
        text: locale.m('confirm_clear'),
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: locale.m('action_yes'),
                callback_data: '/clear/confirmed',
              },
              {
                text: locale.m('action_no'),
                callback_data: '/cancel/clear',
              },
            ],
          ],
        },
      });
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.callback_query(/\/delete\/(?<channelId>.+)/, async (req, res) => {
    const {locale} = res;
    const channelId = req.params.channelId;

    try {
      let channel: ChannelModel;

      try {
        channel = await main.db.getChannelById(channelId);
        await main.db.deleteChatIdChannelId('' + req.chatId, channelId);
      } catch (error) {
        const err = error as ErrorWithCode;
        let isResolved = false;
        let message;
        if (err.code === 'CHANNEL_IS_NOT_FOUND') {
          isResolved = true;
          message = locale.m('alert_channel-not-exists');
        } else {
          message = locale.m('alert_unexpected-error');
        }
        await main.bot.api.editMessageText({
          text: message,
          chat_id: req.chatId,
          message_id: req.messageId,
        });
        if (!isResolved) {
          throw err;
        }
        return;
      }

      const serviceId = channel.service;
      const service = main.getServiceById(serviceId);
      await main.bot.api.editMessageText({
        text: locale.m('alert_channel-deleted', {
          channelName: channel.title,
          serviceName: service?.name ?? serviceId,
        }),
        chat_id: req.chatId,
        message_id: req.messageId,
      });
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.textOrCallbackQuery(/\/delete/, provideChannels, withChannels, async (req, res) => {
    const {locale} = res;

    const channels = req.channels.map((channel) => {
      const serviceId = channel.service;
      const service = main.getServiceById(serviceId);
      return [
        {
          text: `${channel.title} (${service?.name ?? serviceId})`,
          callback_data: `/delete/${channel.id}`,
        },
      ];
    });

    const page = pageBtnList(req.query, channels, '/delete', {
      text: 'Cancel',
      callback_data: '/cancel/delete',
    });

    try {
      if (req.callback_query && !req.query.rel) {
        await passEx(
          () =>
            main.bot.api.editMessageReplyMarkup({
              reply_markup: {
                inline_keyboard: page,
              },
              chat_id: req.chatId,
              message_id: req.messageId,
            }),
          [ErrEnum.MessageNotModified],
        );
      } else {
        await main.bot.api.sendMessage({
          chat_id: req.chatId,
          text: locale.m('context_select-delete-channel'),
          reply_markup: {
            inline_keyboard: page,
          },
        });
      }
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.callback_query(/\/unsetChannel/, provideChat, async (req, res) => {
    const {locale} = res;

    try {
      if (!req.chat.channelId) {
        throw new Error('ChannelId is not set');
      }
      await main.db.deleteChatById(req.chat.channelId);

      await passEx(
        () =>
          main.bot.api.editMessageReplyMarkup({
            reply_markup: {
              inline_keyboard: getOptions(locale, req.chat),
            },
            chat_id: req.chatId,
            message_id: req.messageId,
          }),
        [ErrEnum.MessageNotModified],
      );
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.textOrCallbackQuery(
    /\/setChannel(?:\s+(?<channelId>.+))?/,
    provideChat,
    async (req, res) => {
      const {locale} = res;

      let requestedData: string | undefined;

      try {
        const {value: rawChannelId, messageId} = await askParam({
          locale,
          req,
          value: req.params.channelId,
          messageText: locale.m('context_enter-telegram-channel-name'),
        });

        let channelId;
        try {
          if (!/^@\w+$/.test(rawChannelId)) {
            throw new ErrorWithCode('Incorrect channel name', 'INCORRECT_CHANNEL_NAME');
          }

          try {
            await main.db.getChatById(rawChannelId);
            throw new ErrorWithCode('Channel already used', 'CHANNEL_ALREADY_USED');
          } catch (error) {
            const err = error as ErrorWithCode;
            if (err.code === 'CHAT_IS_NOT_FOUND') {
              // pass
            } else {
              throw err;
            }
          }

          await main.bot.api.sendChatAction({chat_id: rawChannelId, action: 'typing'});

          const chat = await main.bot.api.getChat({chat_id: rawChannelId});
          if (chat.type !== 'channel') {
            throw new ErrorWithCode('This chat type is not supported', 'INCORRECT_CHAT_TYPE');
          }

          channelId = '@' + chat.username;

          await main.db.createChatChannel('' + req.chatId, channelId);
        } catch (error) {
          const err = error as ErrorWithCode;
          let isResolved = false;
          let message: string;
          if (
            ['INCORRECT_CHANNEL_NAME', 'CHANNEL_ALREADY_USED', 'INCORRECT_CHAT_TYPE'].includes(
              err.code,
            )
          ) {
            isResolved = true;
            if (err.code === 'INCORRECT_CHANNEL_NAME') {
              message = locale.m('alert_incorrect-telegram-channel-name');
            } else if (err.code === 'CHANNEL_ALREADY_USED') {
              message = locale.m('alert_telegram-channel-exists');
            } else if (err.code === 'INCORRECT_CHAT_TYPE') {
              message = locale.m('alert_telegram-chat-is-not-supported');
            } else {
              message = err.message;
            }
          } else if (errHandler[ErrEnum.ChatNotFound](err)) {
            isResolved = true;
            message = locale.m('alert_chat-not-found');
          } else if (errHandler[ErrEnum.BotIsNotAMemberOfThe](err)) {
            isResolved = true;
            message = locale.m('alert_bot-is-not-channel-member');
          } else {
            message = locale.m('alert_unexpected-error');
          }
          await editOrSendNewMessage(req.chatId, messageId, message);
          if (!isResolved) {
            throw err;
          }
          return;
        }

        const message = locale.m('alert_telegram-channel-set', {channelName: channelId});
        await editOrSendNewMessage(req.chatId, messageId, message);

        if (req.callback_query) {
          await passEx(
            () =>
              main.bot.api.editMessageReplyMarkup({
                reply_markup: {
                  inline_keyboard: getOptions(locale, req.chat),
                },
                chat_id: req.chatId,
                message_id: req.messageId,
              }),
            [ErrEnum.MessageNotModified],
          );
        }
      } catch (error) {
        const err = error as ErrorWithCode;
        if (['RESPONSE_COMMAND', 'RESPONSE_TIMEOUT'].includes(err.code)) {
          // pass
        } else {
          debug('%j %j error %o', req.command, requestedData, err);
        }
      }
    },
  );

  router.callback_query(
    /\/(?<optionsType>options|channelOptions)\/(?<key>[^\/]+)\/(?<value>.+)/,
    provideChat,
    async (req, res) => {
      const {locale} = res;

      const {optionsType, key, value} = req.params;

      try {
        const changes: Partial<NewChat> = {};
        switch (key) {
          case 'isHidePreview': {
            changes.isHidePreview = value === 'true';
            break;
          }
          case 'isMutedRecords': {
            if (optionsType === 'channelOptions') {
              throw new ErrorWithCode(
                'Option is not available for channel',
                'UNAVAILABLE_CHANNEL_OPTION',
              );
            }
            changes.isMutedRecords = value === 'true';
            break;
          }
          case 'isEnabledAutoClean': {
            changes.isEnabledAutoClean = value === 'true';
            break;
          }
          case 'isMuted': {
            if (optionsType === 'channelOptions') {
              throw new ErrorWithCode(
                'Option is not available for channel',
                'UNAVAILABLE_CHANNEL_OPTION',
              );
            }
            changes.isMuted = value === 'true';
            break;
          }
          default: {
            throw new Error('Unknown option filed');
          }
        }

        switch (optionsType) {
          case 'options': {
            Object.assign(req.chat, changes);
            await req.chat.save();
            break;
          }
          case 'channelOptions': {
            if (!req.chat.channel) {
              throw new Error('Chat channel is empty');
            }
            Object.assign(req.chat.channel, changes);
            await req.chat.channel.save();
            break;
          }
        }

        await passEx(
          () =>
            main.bot.api.editMessageReplyMarkup({
              reply_markup: {
                inline_keyboard: getOptions(locale, req.chat),
              },
              chat_id: req.chatId,
              message_id: req.messageId,
            }),
          [ErrEnum.MessageNotModified],
        );
      } catch (err) {
        debug('%j error %o', req.command, err);
      }
    },
  );

  router.textOrCallbackQuery(/\/options/, provideChat, async (req, res) => {
    const {locale} = res;

    try {
      if (req.callback_query && !req.query.rel) {
        await main.bot.api.editMessageReplyMarkup({
          reply_markup: {
            inline_keyboard: getOptions(locale, req.chat),
          },
          chat_id: req.chatId,
          message_id: req.messageId,
        });
      } else {
        await main.bot.api.sendMessage({
          chat_id: req.chatId,
          text: locale.m('context_options'),
          reply_markup: {
            inline_keyboard: getOptions(locale, req.chat),
          },
        });
      }
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.textOrCallbackQuery(/\/online/, provideChannels, withChannels, async (req, res) => {
    const {locale} = res;

    try {
      const channelIds = req.channels.map((channel) => channel.id);
      const streams = await main.db.getStreamsWithChannelByChannelIds(channelIds);

      let message: string;
      if (!streams.length) {
        message = locale.m('alert_offline');
      } else {
        message = streams.map((stream) => getStreamAsText(stream)).join('\n\n');
      }

      const buttons: InlineKeyboardButton[][] = [];
      streams.forEach((stream) => {
        if (!stream.isOffline && !stream.isTimeout) {
          buttons.push([
            {
              text: getStreamAsButtonText(stream),
              callback_data: `/watch/${stream.id}`,
            },
          ]);
        }
      });

      const buttonsPage = pageBtnList(req.query, buttons, '/online');

      buttonsPage.unshift([
        {
          text: locale.m('action_refresh'),
          callback_data: '/online',
        },
      ]);

      const options = {
        link_preview_options: {is_disabled: true},
        parse_mode: 'HTML' as ParseMode,
        reply_markup: {
          inline_keyboard: buttonsPage,
        },
      };

      if (req.callback_query && !req.query.rel) {
        await passEx(
          () =>
            main.bot.api.editMessageText({
              text: message,
              ...options,
              chat_id: req.chatId,
              message_id: req.messageId,
            }),
          [ErrEnum.MessageNotModified],
        );
      } else {
        await main.bot.api.sendMessage({
          chat_id: req.chatId,
          text: message,
          ...options,
        });
      }
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.callback_query(/\/watch\/(?<streamId>.+)/, provideChat, async (req, res) => {
    const {locale} = res;

    try {
      let stream: StreamModelWithChannel;

      try {
        const {streamId} = req.params;
        stream = await main.db.getStreamWithChannelById(streamId);
      } catch (error) {
        const err = error as ErrorWithCode;
        if (err.code === 'STREAM_IS_NOT_FOUND') {
          const message = locale.m('action_stream-not-found');
          await main.bot.api.sendMessage({
            chat_id: req.chatId,
            text: message,
          });
        } else {
          throw err;
        }
        return;
      }

      const chatSender = new ChatSender(main, req.chat);
      await chatSender.sendStream(stream);
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.textOrCallbackQuery(/\/list/, provideChannels, withChannels, async (req, res) => {
    const serviceIds: string[] = [];
    const serviceIdChannels: Map<string, ChannelModel[]> = new Map();
    req.channels.forEach((channel) => {
      if (!serviceIdChannels.has(channel.service)) {
        serviceIds.push(channel.service);
      }
      const serviceChannels = ensureMap(serviceIdChannels, channel.service, []);
      serviceChannels.push(channel);
    });

    serviceIds.sort((aa, bb) => {
      const a = serviceIdChannels.get(aa)!.length;
      const b = serviceIdChannels.get(bb)!.length;
      return a === b ? 0 : a > b ? -1 : 1;
    });

    const lines: string[] = [];
    serviceIds.forEach((serviceId) => {
      const channelLines = [];
      const service = main.getServiceById(serviceId);
      channelLines.push(htmlSanitize('b', (service?.name ?? serviceId) + ':'));
      serviceIdChannels.get(serviceId)!.forEach((channel) => {
        channelLines.push(htmlSanitize('a', channel.title, channel.url));
      });
      lines.push(channelLines.join('\n'));
    });

    const body = lines.join('\n\n');
    const pageIndex = parseInt(req.query.page || 0);
    const pages = splitTextByPages(body);
    const prevPages = pages.splice(0, pageIndex);
    const pageText = pages.shift() || prevPages.shift() || '';

    const pageControls = [];
    if (pageIndex > 0) {
      pageControls.push({
        text: '<',
        callback_data: '/list' + '?page=' + (pageIndex - 1),
      });
    }
    if (pages.length) {
      pageControls.push({
        text: '>',
        callback_data: '/list' + '?page=' + (pageIndex + 1),
      });
    }

    const options = {
      link_preview_options: {is_disabled: true},
      parse_mode: 'HTML' as ParseMode,
      reply_markup: {
        inline_keyboard: [pageControls],
      },
    };

    try {
      if (req.callback_query && !req.query.rel) {
        await main.bot.api.editMessageText({
          text: pageText,
          ...options,
          chat_id: req.chatId,
          message_id: req.messageId,
        });
      } else {
        await main.bot.api.sendMessage({
          chat_id: req.chatId,
          text: pageText,
          ...options,
        });
      }
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  type AskParamProps = {
    locale: Locale;
    req: RouterTextReq | RouterCallbackQueryReq;
    value: string;
    messageText: string;
  };

  const askParam = async ({locale, req, value, messageText}: AskParamProps) => {
    if (value) {
      return {value: value.trim()};
    }

    const cancelText = locale.m('alert_command-canceled', {command: req.command});
    const {req: rdReq, msg: rdMsg} = await requestData(locale, req, messageText, cancelText);
    tracker.track(rdReq.chatId, {
      ec: 'command',
      ea: req.command,
      el: rdReq.message.text,
      t: 'event',
    });
    return {value: rdReq.message.text.trim(), messageId: rdMsg.message_id};
  };

  const requestData = async (
    locale: Locale,
    req: RouterTextReq | RouterCallbackQueryReq,
    messageText: string,
    cancelText: string,
  ) => {
    const {chatId, fromId} = req;
    const options: Omit<SendMessageParams, 'chat_id' | 'text'> = {};
    let msgText = messageText;
    if (chatId < 0) {
      msgText += '\n' + locale.m('context_group-note');
      if (req.callback_query) {
        msgText = '@' + req.callback_query.from.username + ' ' + messageText;
      } else {
        options.reply_parameters = {message_id: req.messageId};
      }
      options.reply_markup = {
        force_reply: true,
        selective: true,
      };
    }

    const msg = await main.bot.api.sendMessage({
      chat_id: chatId,
      text: msgText,
      ...options,
    });

    try {
      const {req} = await router.waitResponse<RouterTextReq>(
        null,
        {
          event: 'message',
          type: 'text',
          chatId: chatId,
          fromId: fromId,
          throwOnCommand: true,
        },
        3 * 60,
      );
      return {req, msg};
    } catch (error) {
      const err = error as ErrorWithCode;
      if (['RESPONSE_COMMAND', 'RESPONSE_TIMEOUT'].includes(err.code)) {
        await editOrSendNewMessage(chatId, msg.message_id, cancelText);
      }
      throw err;
    }
  };

  type AskChooseProps = {
    req: RouterTextReq | RouterCallbackQueryReq;
    locale: Locale;
    messageText: string;
    messageId?: number;
    options: {
      name: string;
      value: string;
    }[];
    value?: string;
  };

  const askChoose = async ({
    locale,
    req,
    value,
    messageId,
    messageText,
    options,
  }: AskChooseProps) => {
    if (value) {
      return {value: value.trim(), messageId};
    }

    const cancelText = locale.m('alert_command-canceled', {command: req.command});
    const chooseKeyboard = [
      ...arrayByPart(
        options.map(({name, value}) => {
          return {
            text: name,
            callback_data: '/choose/' + value,
          };
        }),
        2,
      ),
      [
        {
          text: locale.m('action_cancel'),
          callback_data: '/choose/cancel',
        },
      ],
    ];

    const {req: rReq, messageId: rMessageId} = await requestChoose(
      req.chatId,
      req.fromId,
      messageId,
      messageText,
      cancelText,
      chooseKeyboard,
    );

    if (rReq.params.value === 'cancel') {
      await editOrSendNewMessage(rReq.chatId, rMessageId, cancelText);
      throw new ErrorWithCode('Response cancel', 'RESPONSE_CANCEL');
    }

    const option = options.find(({value}) => value === rReq.params.value);
    if (!option) {
      throw new Error('Unexpected option value');
    }

    return {value: option?.value, messageId: rMessageId};
  };

  const requestChoose = async (
    chatId: number,
    fromId: number | undefined,
    origMessageId: number | undefined,
    messageText: string,
    cancelText: string,
    inline_keyboard: InlineKeyboardButton[][],
  ) => {
    const messageId = await editOrSendNewMessage(chatId, origMessageId, messageText, {
      reply_markup: {inline_keyboard},
    });

    let req: RouterCallbackQueryReq;
    try {
      const {req: rReq} = await router.waitResponse<RouterCallbackQueryReq>(
        /\/choose\/(?<value>.+)/,
        {
          event: 'callback_query',
          chatId: chatId,
          fromId: fromId,
        },
        3 * 60,
      );
      req = rReq;
    } catch (error) {
      const err = error as ErrorWithCode;
      if (['RESPONSE_COMMAND', 'RESPONSE_TIMEOUT'].includes(err.code)) {
        await editOrSendNewMessage(chatId, messageId, cancelText);
      }
      throw err;
    }

    await main.bot.api.answerCallbackQuery({callback_query_id: req.callback_query.id});

    return {req, messageId};
  };
}

function getOptions(locale: Locale, chat: ChatModel | ChatModelWithOptionalChannel) {
  const btnList = [];

  if (chat.isHidePreview) {
    btnList.push([
      {
        text: locale.m('action_show-preview'),
        callback_data: '/options/isHidePreview/false',
      },
    ]);
  } else {
    btnList.push([
      {
        text: locale.m('action_hide-preview'),
        callback_data: '/options/isHidePreview/true',
      },
    ]);
  }

  /*if (chat.isMutedRecords) {
    btnList.push([{
      text: 'Unmute records',
      callback_data: '/options/isMutedRecords/false'
    }]);
  } else {
    btnList.push([{
      text: 'Mute records',
      callback_data: '/options/isMutedRecords/true'
    }]);
  }*/

  if (chat.isEnabledAutoClean) {
    btnList.push([
      {
        text: locale.m('action_disable-auto-clean'),
        callback_data: '/options/isEnabledAutoClean/false',
      },
    ]);
  } else {
    btnList.push([
      {
        text: locale.m('action_enable-auto-clean'),
        callback_data: '/options/isEnabledAutoClean/true',
      },
    ]);
  }

  if (chat.channelId) {
    btnList.push([
      {
        text: locale.m('action_remove-channel', {channel: chat.channelId}),
        callback_data: '/unsetChannel',
      },
    ]);
  } else {
    btnList.push([
      {
        text: locale.m('action_set-channel'),
        callback_data: '/setChannel',
      },
    ]);
  }

  if (chat.channelId) {
    if (chat.isMuted) {
      btnList.push([
        {
          text: locale.m('action_unmute'),
          callback_data: '/options/isMuted/false',
        },
      ]);
    } else {
      btnList.push([
        {
          text: locale.m('action_mute'),
          callback_data: '/options/isMuted/true',
        },
      ]);
    }
  }

  if ('channel' in chat && chat.channel) {
    if (chat.channel.isHidePreview) {
      btnList.push([
        {
          text: locale.m('action_show-preview-for-channel'),
          callback_data: '/channelOptions/isHidePreview/false',
        },
      ]);
    } else {
      btnList.push([
        {
          text: locale.m('action_hide-preview-for-channel'),
          callback_data: '/channelOptions/isHidePreview/true',
        },
      ]);
    }

    if (chat.isEnabledAutoClean) {
      btnList.push([
        {
          text: locale.m('action_disable-auto-clean-for-channel'),
          callback_data: '/channelOptions/isEnabledAutoClean/false',
        },
      ]);
    } else {
      btnList.push([
        {
          text: locale.m('action_enable-auto-clean-for-channel'),
          callback_data: '/channelOptions/isEnabledAutoClean/true',
        },
      ]);
    }
  }

  return btnList;
}
