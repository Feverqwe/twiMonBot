export interface StreamInterface {
  id: string,
  url: string,
  title: string,
  game: string|null,
  isRecord: boolean,
  previews: string[],
  viewers: number|null,
  channelId: string,
  channelTitle: string,
}

export interface ServiceInterface {
  match(string): boolean,
  getStreams(channelsIds: string[]): Promise<{streams: StreamInterface[], skippedChannelIds: string[], removedChannelIds: string[]}>,
  getExistsChannelIds(channelsIds: string[]): Promise<string[]>,
  findChannel(query: string): Promise<{id: string, title: string, url: string}>,
}

export default null;