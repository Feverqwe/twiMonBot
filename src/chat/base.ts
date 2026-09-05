import Main from '../main';
import LogFile from '../shared/logFile';
import Router from '../shared/router';
import registerSharedBaseRoutes from '../shared/chat/baseRoutes';
import type QuickLRU from 'quick-lru';
import {tracker} from '../tracker';

export default function registerBaseRoutes(
  main: Main,
  router: Router,
  log: LogFile,
  chatIdAdminIdsCache: QuickLRU<number, number[]>,
) {
  registerSharedBaseRoutes(main, router, log, chatIdAdminIdsCache, tracker);
}
