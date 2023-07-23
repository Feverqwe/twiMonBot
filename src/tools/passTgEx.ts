export enum ErrEnum {
  MessageNotModified = 'messageNotModified',
  ChatNotFound = 'chatNotFound',
  BotIsNotAMemberOfThe = 'botIsNotAMemberOfThe',
  MessageCantBeEdited = 'messageCantBeEdited',
  MessageToEditNotFound = 'messageToEditNotFound',
}

export const errHandler = {
  [ErrEnum.MessageNotModified]: (err: Error & {code?: string}) => {
    return err.code === 'ETELEGRAM' && /message is not modified/.test(err.message);
  },
  [ErrEnum.ChatNotFound]: (err: Error & {code?: string}) => {
    return err.code === 'ETELEGRAM' && /chat not found/.test(err.message);
  },
  [ErrEnum.BotIsNotAMemberOfThe]: (err: Error & {code?: string}) => {
    return err.code === 'ETELEGRAM' && /bot is not a member of the/.test(err.message);
  },
  [ErrEnum.MessageCantBeEdited]: (err: Error & {code?: string}) => {
    return err.code === 'ETELEGRAM' && /message can't be edited/.test(err.message);
  },
  [ErrEnum.MessageToEditNotFound]: (err: Error & {code?: string}) => {
    return err.code === 'ETELEGRAM' && /message to edit not found/.test(err.message);
  },
};

export async function passEx<T>(callback: () => Promise<T>, passErrors: ErrEnum[]) {
  try {
    return await callback();
  } catch (error) {
    const err = error as Error & {code?: string};
    if (!passErrors.some((passErr) => errHandler[passErr](err))) {
      throw err;
    }
  }
}
