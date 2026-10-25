import {ChatModel} from '../../db/models';

export default async function ensureChatWithChannel(id: string) {
  const include = [{model: ChatModel, as: 'channel'}];
  const [model, isCreated] = await ChatModel.findOrCreate({where: {id}, include});
  if (isCreated) {
    // Creation does not load associations, unlike the find path of findOrCreate.
    await model.reload({include});
  }
  const {channel} = model;
  if (channel === undefined) {
    throw new Error('Chat channel association was not loaded');
  }
  return Object.assign(model, {channel});
}
