import path from 'node:path';
import type {QueryInterface, Sequelize} from 'sequelize';
import {SequelizeStorage, Umzug, type MigrationFn} from 'umzug';
import {getDebug} from './tools/getDebug';

const debug = getDebug('app:migrator');

export type Migration = MigrationFn<QueryInterface>;

const createMigrator = (sequelize: Sequelize) => {
  return new Umzug({
    migrations: {glob: path.join(__dirname, 'migrations', '*.js')},
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({sequelize}),
    logger: {
      debug: (event) => debug('%o', event),
      info: (event) => debug('%o', event),
      warn: (event) => debug('%o', event),
      error: (event) => debug('%o', event),
    },
  });
};

export default createMigrator;
