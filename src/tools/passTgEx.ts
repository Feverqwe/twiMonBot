import {TelegramApiError} from 'node-telegram-bot-api';

export enum ErrEnum {
  MessageNotModified = 'messageNotModified',
  ChatNotFound = 'chatNotFound',
  BotIsNotAMemberOfThe = 'botIsNotAMemberOfThe',
  MessageCantBeEdited = 'messageCantBeEdited',
  MessageToEditNotFound = 'messageToEditNotFound',
  NotEnoughRightsSendPhotos = 'notEnoughRightsSendPhotos',
}

const hasDescription = (err: unknown, re: RegExp) => {
  return err instanceof TelegramApiError && re.test(err.description);
};

export const errHandler = {
  [ErrEnum.MessageNotModified]: (err: unknown) => {
    return hasDescription(err, /message is not modified/);
  },
  [ErrEnum.ChatNotFound]: (err: unknown) => {
    return hasDescription(err, /chat not found/);
  },
  [ErrEnum.BotIsNotAMemberOfThe]: (err: unknown) => {
    return hasDescription(err, /bot is not a member of the/);
  },
  [ErrEnum.MessageCantBeEdited]: (err: unknown) => {
    return hasDescription(err, /message can't be edited/);
  },
  [ErrEnum.MessageToEditNotFound]: (err: unknown) => {
    return hasDescription(err, /message to edit not found/);
  },
  [ErrEnum.NotEnoughRightsSendPhotos]: (err: unknown) => {
    return hasDescription(err, /not enough rights to send photos/);
  },
};

export async function passEx<T>(callback: () => Promise<T>, passErrors: ErrEnum[]) {
  try {
    return await callback();
  } catch (error) {
    if (!passErrors.some((passErr) => errHandler[passErr](error))) {
      throw error;
    }
  }
}
