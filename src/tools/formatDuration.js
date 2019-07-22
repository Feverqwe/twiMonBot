import {parse, toSeconds} from 'iso8601-duration';

const formatDuration = (duration) => {
  let seconds = toSeconds(parse(duration));

  const hours = Math.floor(seconds / 60 / 60);
  seconds -= hours * 60 * 60;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;

  const parts = [
    hours,
    minutes,
    seconds
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