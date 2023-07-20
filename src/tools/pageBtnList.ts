import TelegramBot from "node-telegram-bot-api";

const pageBtnList = (query: {[s: string]: any}, btnList: TelegramBot.InlineKeyboardButton[][], command: string, _middleBtn?: TelegramBot.InlineKeyboardButton|TelegramBot.InlineKeyboardButton[]) => {
  const page = parseInt(query.page) || 0;
  let middleBtns: TelegramBot.InlineKeyboardButton[]|null = _middleBtn as TelegramBot.InlineKeyboardButton[];
  if (middleBtns && !Array.isArray(middleBtns)) {
    middleBtns = [middleBtns];
  }
  const maxItemCount = 10;
  const offset = page * maxItemCount;
  const offsetEnd = offset + maxItemCount;
  const countItem = btnList.length;
  const pageList = btnList.slice(offset, offsetEnd);
  if (countItem > maxItemCount || page > 0) {
    const pageControls = [];
    if (page > 0) {
      pageControls.push({
        text: '<',
        callback_data: command + '?page=' + (page - 1)
      });
    }
    if (middleBtns) {
      pageControls.push(...middleBtns);
    }
    if (countItem - offsetEnd > 0) {
      pageControls.push({
        text: '>',
        callback_data: command + '?page=' + (page + 1)
      });
    }
    pageList.push(pageControls);
  } else
  if (middleBtns) {
    pageList.push(middleBtns);
  }
  return pageList;
};

export default pageBtnList;
