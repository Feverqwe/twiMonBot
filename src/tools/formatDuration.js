// from momentjs ISO_8601
const isoRegex = /^PT(?:(-?[0-9,.]*)H)?(?:(-?[0-9,.]*)M)?(?:(-?[0-9,.]*)S)?$/;

const parseIso = (inp) => {
  const res = inp && parseFloat(inp.replace(',', '.'));
  return (!Number.isFinite(res) ? 0 : res);
};

const formatDuration = (str) => {
  const match = isoRegex.exec(str);
  if (!match) {
    throw new Error(`Incorrect format! ${str}`);
  }

  const parts = [
    parseIso(match[1]),
    parseIso(match[2]),
    parseIso(match[3])
  ];

  if (parts[0] === 0) {
    parts.shift();
  }

  return parts.map((count, index) => {
    if (index > 0 && count < 10) {
      count = '0' + count;
    }
    return count;
  }).join(':');
};

export default formatDuration;