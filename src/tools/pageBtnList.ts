import {TInlineKeyboardButton} from "../router";

const pageBtnList = (query: {[s: string]: any}, btnList: TInlineKeyboardButton[][], command: string, _middleBtn?: TInlineKeyboardButton|TInlineKeyboardButton[]) => {
  const page = parseInt(query.page) || 0;
  let middleBtns: TInlineKeyboardButton[]|null = _middleBtn as TInlineKeyboardButton[];
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