import htmlSanitize from './htmlSanitize';
import {ServiceInterface} from '../checker';
import {StreamModel, StreamModelWithChannel} from '../db';

const icons = {
  timeout: '⏳',
  offline: '🏁',
  online: '🎈',
  record: '📽️',
};

export function getStreamAsDescription(stream: StreamModelWithChannel, service: ServiceInterface) {
  const icon = getIcon(stream);
  const channelName = service.streamUrlWithoutChannelName ? stream.channel.title : '';

  let game = stream.game || '';
  if (isSameString(game, stream.title)) {
    game = '';
  }

  return joinString(
    [
      joinString(
        [
          joinString(
            [joinString([icon, htmlSanitize('', stream.title)], ' '), htmlSanitize('', game)],
            ' — ',
          ),
          htmlSanitize('', channelName),
        ],
        ' – ',
      ),
      htmlSanitize('', stream.url),
    ],
    '\n',
  );
}

export function getStreamAsCaption(stream: StreamModelWithChannel, service: ServiceInterface) {
  const icon = getIcon(stream);
  const channelName = service.streamUrlWithoutChannelName ? stream.channel.title : '';

  let game = stream.game || '';
  if (isSameString(game, stream.title)) {
    game = '';
  }

  return joinString(
    [
      joinString(
        [joinString([joinString([icon, stream.title], ' '), game], ' — '), channelName],
        ' – ',
      ),
      stream.url,
    ],
    '\n',
  );
}

export function getStreamAsText(stream: StreamModelWithChannel) {
  const icon = getIcon(stream, true);
  const viewers = typeof stream.viewers === 'number' ? String(stream.viewers) : '';

  let game = stream.game || '';
  if (isSameString(game, stream.title)) {
    game = '';
  }

  return joinString(
    [
      joinString([htmlSanitize('b', stream.channel.title), icon, viewers], ' '),
      htmlSanitize('', joinString([stream.title, game], ' — ')),
      htmlSanitize('', stream.url),
    ],
    '\n',
  );
}

export function getStreamAsButtonText(stream: StreamModelWithChannel) {
  return joinString([stream.channel.title, stream.title], ' — ');
}

function getIcon(stream: StreamModel, withOnline?: boolean) {
  let icon = null;
  if (stream.isTimeout) {
    icon = icons.timeout;
  } else if (stream.isOffline) {
    icon = icons.offline;
  } else if (stream.isRecord) {
    icon = icons.record;
  } else if (withOnline) {
    icon = icons.online;
  }
  return icon;
}

function joinString(parts: (string | null | undefined)[], sep: string) {
  return parts
    .map((s) => s && s.trim())
    .filter((s) => !!s)
    .join(sep)
    .trim();
}

function isSameString(a: string, b: string) {
  return a.toLowerCase().trim() === b.toLowerCase().trim();
}
