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

export default null;