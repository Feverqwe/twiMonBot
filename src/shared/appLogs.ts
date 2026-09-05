import LogFile from './logFile';

class AppLogs {
  readonly chat = new LogFile('chat');
  readonly sender = new LogFile('sender');
}

export default AppLogs;
