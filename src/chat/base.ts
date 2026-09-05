import Main from '../main';
import LogFile from '../shared/logFile';
import Router from '../shared/router';
import registerSharedBaseRoutes from '../shared/chat/baseRoutes';
import TimeCache from '../shared/tools/timeCache';
import {tracker} from '../tracker';

export default function registerBaseRoutes(
  main: Main,
  router: Router,
  log: LogFile,
  chatIdAdminIdsCache: TimeCache<number, number[]>,
) {
  registerSharedBaseRoutes(main, router, log, chatIdAdminIdsCache, tracker);
}
