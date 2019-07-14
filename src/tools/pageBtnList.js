/**
 * @param {Object} query
 * @param {Array} btnList
 * @param {string} command
 * @param {Array|Object} middleBtn
 * @return {Array}
 */
const pageBtnList = (query, btnList, command, middleBtn) => {
  const page = parseInt(query.page) || 0;
  if (middleBtn && !Array.isArray(middleBtn)) {
    middleBtn = [middleBtn];
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
    if (middleBtn) {
      pageControls.push(...middleBtn);
    }
    if (countItem - offsetEnd > 0) {
      pageControls.push({
        text: '>',
        callback_data: command + '?page=' + (page + 1)
      });
    }
    pageList.push(pageControls);
  } else
  if (middleBtn) {
    pageList.push(middleBtn);
  }
  return pageList;
};

export default pageBtnList;