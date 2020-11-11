import {IStream, IStreamWithChannel} from "../db";
import htmlSanitize from "./htmlSanitize";
import {ServiceInterface} from "../checker";

const icons = {
  timeout: '⏳',
  offline: '🏁',
  online: '🎈',
  record: '📽️',
};

export function getDescription(stream: IStreamWithChannel, service: ServiceInterface) {
  const icon = getIcon(stream);
  const channelName = service.streamUrlWithoutChannelName ? stream.channel.title : '';

  let game = stream.game || '';
  if (isSameString(game, stream.title)) {
    game = '';
  }

  return joinString([
    joinString([
      joinString([icon, htmlSanitize('', stream.title)], ' '),
      htmlSanitize('', game),
    ], ' — '),
    htmlSanitize('', joinString([stream.url, channelName], ' – ')),
  ], '\n');
}

export function getStreamAsCaption(stream: IStreamWithChannel, service: ServiceInterface) {
  const icon = getIcon(stream);
  const channelName = service.streamUrlWithoutChannelName ? stream.channel.title : '';

  let game = stream.game || '';
  if (isSameString(game, stream.title)) {
    game = '';
  }

  return joinString([
    joinString([
      joinString([icon, stream.title], ' '),
      game,
    ], ' — '),
    joinString([stream.url, channelName], ' – '),
  ], '\n');
}

export function getStreamAsText(stream: IStreamWithChannel) {
  const icon = getIcon(stream, true);
  const viewers = typeof stream.viewers === 'number' ? String(stream.viewers) : '';

  let game = stream.game || '';
  if (isSameString(game, stream.title)) {
    game = '';
  }

  return joinString([
    joinString([
      htmlSanitize('b', stream.channel.title), icon, viewers
    ], ' '),
    htmlSanitize('', joinString([stream.title, game], ' — ')),
    htmlSanitize('', stream.url)
  ], '\n');
}

export function getStreamAsButtonText(stream: IStreamWithChannel) {
  return joinString([
    stream.channel.title, stream.title
  ], ' — ');
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

function joinString(parts: (string|null|undefined)[], sep: string) {
  return parts.map(s => s && s.trim()).filter(s => !!s).join(sep).trim();
}

function isSameString(a: string, b: string) {
  return a.toLowerCase().trim() === b.toLowerCase().trim();
}
