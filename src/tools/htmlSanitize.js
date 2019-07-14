const sanitize = function (text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

const sanitizeAttr = function (text) {
  return sanitize(text).replace(/"/g, '&quot;');
};

const htmlSanitize = function (type, text, url) {
  if (!text) {
    text = type;
    type = '';
  }

  switch (type) {
    case '':
      return sanitize(text);
    case 'a':
      return '<a href="' + sanitizeAttr(url) + '">' + sanitize(text) + '</a>';
    case 'b':
      return '<b>' + sanitize(text) + '</b>';
    case 'strong':
      return '<strong>' + sanitize(text) + '</strong>';
    case 'i':
      return '<i>' + sanitize(text) + '</i>';
    case 'em':
      return '<em>' + sanitize(text) + '</em>';
    case 'pre':
      return '<pre>' + sanitize(text) + '</pre>';
    case 'code':
      return '<code>' + sanitize(text) + '</code>';
  }

  throw new Error("htmlSanitize error");
};

export default htmlSanitize;