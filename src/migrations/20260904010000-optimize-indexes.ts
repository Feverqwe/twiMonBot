import type {QueryInterface} from 'sequelize';
import type {Migration} from '../shared/migrator';

interface IndexDefinition {
  name: string;
  fields: string[];
}

interface TableIndexChanges {
  table: string;
  add: IndexDefinition[];
  remove: string[];
}

const applyIndexChanges = async (
  context: QueryInterface,
  changes: TableIndexChanges[],
): Promise<void> => {
  for (const {table, add, remove} of changes) {
    const indexes = (await context.showIndex(table)) as Array<{name: string}>;
    const existingNames = new Set(indexes.map(({name}) => name));

    for (const index of add) {
      if (existingNames.has(index.name)) continue;
      await context.addIndex(table, index.fields, {name: index.name});
      existingNames.add(index.name);
    }

    for (const name of remove) {
      if (!existingNames.has(name)) continue;
      await context.removeIndex(table, name);
      existingNames.delete(name);
    }
  }
};

const upChanges: TableIndexChanges[] = [
  {
    table: 'channels',
    add: [{name: 'service_lastStreamAt_idx', fields: ['service', 'lastStreamAt']}],
    remove: ['service_idx', 'lastStreamAt_idx'],
  },
  {
    table: 'chatIdChannelId',
    add: [{name: 'chatId_createdAt_idx', fields: ['chatId', 'createdAt']}],
    remove: ['chatId_idx', 'createdAt_idx'],
  },
  {
    table: 'streams',
    add: [{name: 'channelId_createdAt_idx', fields: ['channelId', 'createdAt']}],
    remove: ['createdAt_idx'],
  },
  {
    table: 'chatIdStreamId',
    add: [{name: 'chatId_createdAt_idx', fields: ['chatId', 'createdAt']}],
    remove: ['chatId_idx', 'createdAt_idx'],
  },
  {
    table: 'messages',
    add: [
      {
        name: 'chatId_streamId_createdAt_idx',
        fields: ['chatId', 'streamId', 'createdAt'],
      },
    ],
    remove: [],
  },
];

const downChanges: TableIndexChanges[] = [
  {
    table: 'channels',
    add: [
      {name: 'service_idx', fields: ['service']},
      {name: 'lastStreamAt_idx', fields: ['lastStreamAt']},
    ],
    remove: ['service_lastStreamAt_idx'],
  },
  {
    table: 'chatIdChannelId',
    add: [
      {name: 'chatId_idx', fields: ['chatId']},
      {name: 'createdAt_idx', fields: ['createdAt']},
    ],
    remove: ['chatId_createdAt_idx'],
  },
  {
    table: 'streams',
    add: [{name: 'createdAt_idx', fields: ['createdAt']}],
    remove: ['channelId_createdAt_idx'],
  },
  {
    table: 'chatIdStreamId',
    add: [
      {name: 'chatId_idx', fields: ['chatId']},
      {name: 'createdAt_idx', fields: ['createdAt']},
    ],
    remove: ['chatId_createdAt_idx'],
  },
  {
    table: 'messages',
    add: [],
    remove: ['chatId_streamId_createdAt_idx'],
  },
];

export const up: Migration = ({context}) => applyIndexChanges(context, upChanges);

export const down: Migration = ({context}) => applyIndexChanges(context, downChanges);
