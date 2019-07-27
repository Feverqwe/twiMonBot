const splitTextByPages = (text: string) => {
  const maxLen = 4096;

  const textByLines = (text: string) => {
    const lines = [];
    let line = '';
    for (let i = 0, char = '', len = text.length; i < len; i++) {
      char = text[i];
      line += char;
      if (char === '\n' || line.length === maxLen) {
        lines.push(line);
        line = '';
      }
    }
    if (line.length) {
      lines.push(line);
    }
    return lines;
  };

  const linesByPage = (lines: string[]) => {
    const pages = [];
    let page = '';
    lines.forEach((line) => {
      if (page.length + line.length > maxLen) {
        pages.push(page);
        page = '';
      }
      page += line;
    });
    if (page.length) {
      pages.push(page);
    }
    return pages;
  };

  return linesByPage(textByLines(text));
};

export default splitTextByPages;