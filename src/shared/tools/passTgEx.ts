import {TelegramApiError} from 'node-telegram-bot-api';

export enum ErrEnum {
  MessageNotModified = 'messageNotModified',
  ChatNotFound = 'chatNotFound',
  BotIsNotAMemberOfThe = 'botIsNotAMemberOfThe',
  MessageCantBeEdited = 'messageCantBeEdited',
  MessageToEditNotFound = 'messageToEditNotFound',
  NotEnoughRightsSendPhotos = 'notEnoughRightsSendPhotos',
}

const blockedErrors = [
  /group chat was deactivated/,
  /group chat is deactivated/,
  /chat not found/,
  /channel not found/,
  /USER_DEACTIVATED/,
  /have no rights to send a message/,
  /need administrator rights in the channel chat/,
  /CHAT_WRITE_FORBIDDEN/,
  /CHAT_SEND_MEDIA_FORBIDDEN/,
  /CHAT_RESTRICTED/,
  /not enough rights to send text messages to the chat/,
];

const skipMessageErrors = [/TOPIC_DELETED/, /TOPIC_CLOSED/];

const sendPhotoUrlErrors = [
  /failed to get HTTP URL content/,
  /wrong type of the web page content/,
  /wrong file identifier\/HTTP URL specified/,
  /FILE_REFERENCE_.+/,
];

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

export function getTelegramErrorBody(err: unknown) {
  if (err instanceof TelegramApiError) {
    return {
      error_code: err.errorCode,
      description: err.description,
      parameters: err.parameters,
    };
  }
}

export function isBlockedError(err: unknown): boolean {
  const body = getTelegramErrorBody(err);
  return Boolean(
    body && (body.error_code === 403 || blockedErrors.some((re) => re.test(body.description))),
  );
}

export function isSkipMessageError(err: unknown): boolean {
  const body = getTelegramErrorBody(err);
  return Boolean(body && skipMessageErrors.some((re) => re.test(body.description)));
}

export function isFileReferenceError(err: unknown): boolean {
  const body = getTelegramErrorBody(err);
  return Boolean(body && /FILE_REFERENCE_.+/.test(body.description));
}

export function isSendPhotoUrlError(err: unknown): boolean {
  const body = getTelegramErrorBody(err);
  const message = err instanceof Error ? err.message : String(err);
  return body?.error_code === 504 || sendPhotoUrlErrors.some((re) => re.test(message));
}
