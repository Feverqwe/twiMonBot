import jsonStringifyPretty from 'json-stringify-pretty-compact';
import {appConfig} from '../appConfig';
import Main from '../main';
import Router, {RouterReqWithAnyMessage, RouterRes} from '../shared/router';
import ErrorWithCode from '../shared/tools/errorWithCode';
import {getDebug} from '../shared/tools/getDebug';

const debug = getDebug('app:Chat');

export default function registerAdminRoutes(main: Main, router: Router) {
  const isAdmin = async <T extends RouterReqWithAnyMessage>(
    req: T,
    res: RouterRes,
    next: () => void,
  ) => {
    const {locale} = res;
    const adminIds = appConfig.adminIds;
    if (adminIds.includes(req.chatId)) {
      return next();
    }

    try {
      await main.bot.api.sendMessage({
        chat_id: req.chatId,
        text: locale.m('alert_access-denied', {
          chat: req.chatId,
        }),
      });
    } catch (err) {
      debug('isAdmin sendMessage error: %o', err);
    }
  };

  const commands = [
    {name: 'Check chats exists', method: main.sender.checkChatsExists},
    {name: 'Check channels exists', method: main.checker.checkChannelsExists},
    {name: 'Check channels', method: main.checker.check},
    {name: 'Sender check', method: main.sender.check},
    {name: 'Active checker threads', method: main.checker.getActiveThreads},
    {name: 'Active sender threads', method: main.sender.getActiveThreads},
    {name: 'Update pubsub subscriptions', method: main.ytPubSub.updateSubscribes},
    {name: 'Clean chats & channels', method: main.checker.clean},
    {name: 'Clean pubsub feeds', method: main.ytPubSub.clean},
  ];

  router.callback_query(/\/admin\/(?<commandIndex>.+)/, isAdmin, async (req, res) => {
    const {locale} = res;
    const commandIndex = parseInt(req.params.commandIndex, 10);
    const command = commands[commandIndex];

    try {
      let resultStr: string;

      try {
        if (!command) {
          throw new ErrorWithCode('Method is not found', 'METHOD_IS_NOT_FOUND');
        }
        const result = await command.method();

        resultStr = jsonStringifyPretty(
          {result},
          {
            indent: 2,
          },
        );
      } catch (err) {
        await main.bot.api.sendMessage({
          chat_id: req.chatId,
          text: locale.m('alert_command-error', {
            command: command.name,
          }),
        });
        throw err;
      }

      await main.bot.api.sendMessage({
        chat_id: req.chatId,
        text: `${locale.m('alert_command-complete', {
          command: command.name,
        })}\n${resultStr}`,
      });
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });

  router.textOrCallbackQuery(/\/admin/, isAdmin, async (req, res) => {
    const {locale} = res;
    type Button = {text: string; callback_data: string};

    try {
      await main.bot.api.sendMessage({
        chat_id: req.chatId,
        text: locale.m('title_admin-menu'),
        reply_markup: {
          inline_keyboard: commands.reduce<Button[][]>((menu, {name, method}, index) => {
            const buttons: Button[] = index % 2 ? menu.pop()! : [];
            buttons.push({
              text: name || method.name,
              callback_data: `/admin/${index}`,
            });
            menu.push(buttons);
            return menu;
          }, []),
        },
      });
    } catch (err) {
      debug('%j error %o', req.command, err);
    }
  });
}
