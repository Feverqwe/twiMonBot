import escapeTextForBrowser from "./escapeTextForBrowser";

const htmlSanitize = function (type: string, text: string, url?: string) {
  switch (type) {
    case '':
      return escapeTextForBrowser(text);
    case 'a':
      return '<a href="' + escapeTextForBrowser(url!) + '">' + escapeTextForBrowser(text) + '</a>';
    case 'b':
      return '<b>' + escapeTextForBrowser(text) + '</b>';
    case 'strong':
      return '<strong>' + escapeTextForBrowser(text) + '</strong>';
    case 'i':
      return '<i>' + escapeTextForBrowser(text) + '</i>';
    case 'em':
      return '<em>' + escapeTextForBrowser(text) + '</em>';
    case 'pre':
      return '<pre>' + escapeTextForBrowser(text) + '</pre>';
    case 'code':
      return '<code>' + escapeTextForBrowser(text) + '</code>';
  }

  throw new Error("htmlSanitize error");
};

export default htmlSanitize;