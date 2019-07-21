export interface StreamInterface {
  id: string|number,
  url: string,
  title: string,
  game: string|null,
  isRecord: boolean,
  previews: string[],
  viewers: number|null,
  channelId: string|number,
  channelTitle: string,
}

export interface ServiceInterface {
  match(string): boolean,
  getStreams(channelsIds: string[]|number[]): Promise<{streams: StreamInterface[], skippedChannelIds: string[]|number[], removedChannelIds: string[]|number[]}>,
  getExistsChannelIds(channelsIds: string[]|number[]): Promise<string[]|number[]>,
  findChannel(query: string): Promise<{id: string|number, title: string, url: string}>,
}

export default null;