import {IStream, IStreamWithChannel} from "../db";
import htmlSanitize from "./htmlSanitize";

const icons = {
  timeout: '⏲',
  offline: '🏁',
  online: '🎈',
  record: '📽️',
};

export function getDescription(stream: IStreamWithChannel) {
  let game = stream.game;
  if (stream.title.includes(game)) {
    game = '';
  }

  return joinString(...[
    joinString(getIcon(stream), htmlSanitize(stream.title), ' '),
    htmlSanitize('a', joinString(stream.channel.title, game, ' — '), stream.channel.url)
  ], '\n');
}

export function getCaption(stream: IStreamWithChannel) {
  let game = stream.game;
  if (stream.title.includes(game)) {
    game = '';
  }

  return joinString(...[
    joinString(joinString(getIcon(stream), stream.title, ' '), game, ' — '),
    stream.url
  ], '\n');
}

export function getString(stream: IStreamWithChannel) {
  let game = stream.game;
  if (stream.title.includes(game)) {
    game = '';
  }

  const icon = getIcon(stream, true);

  return joinString(...[
    joinString(htmlSanitize('b', stream.channel.title), icon, stream.viewers && stream.viewers.toString(), ' '),
    htmlSanitize(joinString(stream.title, game, ' — ')),
    htmlSanitize(stream.url)
  ], '\n');
}

export function getButtonText(stream: IStreamWithChannel) {
  let game = stream.game;
  if (stream.title.includes(game)) {
    game = '';
  }

  return joinString(stream.title, game, ' — ');
}

function getIcon(stream: IStream, withOnline?: boolean) {
  let icon = null;
  if (stream.isTimeout) {
    icon = icons.timeout;
  } else
  if (stream.isOffline) {
    icon = icons.offline;
  } else
  if (stream.isRecord) {
    icon = icons.record;
  } else
  if (withOnline) {
    icon = icons.online;
  }
  return icon;
}

function joinString(...parts: (string|null)[]) {
  const sep = parts.pop();
  return parts.map(s => s && s.trim()).filter(s => !!s).join(sep).trim();
}