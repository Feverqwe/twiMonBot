import type {Bot, EditMessageTextParams} from 'node-telegram-bot-api';
import ErrorWithCode from '../tools/errorWithCode';
import {ErrEnum, errHandler} from '../tools/passTgEx';

type EditableMessageForm = Pick<
  EditMessageTextParams,
  'parse_mode' | 'entities' | 'link_preview_options' | 'reply_markup'
>;

export default function createEditOrSendNewMessage(
  api: Pick<Bot['api'], 'editMessageText' | 'sendMessage'>,
) {
  return async (
    chatId: number,
    messageId: number | undefined,
    text: string,
    form?: EditableMessageForm,
  ): Promise<number> => {
    try {
      if (!messageId) {
        throw new ErrorWithCode('messageId is empty', 'MESSAGE_ID_IS_EMPTY');
      }

      const result = await api.editMessageText({
        ...form,
        text,
        chat_id: chatId,
        message_id: messageId,
      });

      if (typeof result === 'object') {
        return result.message_id;
      }

      return messageId;
    } catch (error) {
      const err = error as ErrorWithCode;
      if (
        err.code === 'MESSAGE_ID_IS_EMPTY' ||
        errHandler[ErrEnum.MessageCantBeEdited](err) ||
        errHandler[ErrEnum.MessageToEditNotFound](err)
      ) {
        const msg = await api.sendMessage({
          ...form,
          chat_id: chatId,
          text,
        });
        return msg.message_id;
      }
      throw err;
    }
  };
}
