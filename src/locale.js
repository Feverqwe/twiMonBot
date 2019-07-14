class Locale {
  getMessage(messageName) {
    return languages.en[messageName];
  }
}

const languages = {};

languages.en = {
  help: 'Hi! I will notify you about the beginning of the broadcasts on Twitch, Youtube, GoodGame and Mixer!',
  offline: 'All channels in offline',
  emptyServiceList: `You don't have channels in watchlist, yet.`,
  enterChannelName: 'Enter the channel URL or name (example: guit88man):',
  enterService: 'Enter a live streaming video platform',
  channelExists: 'This channel has been added!',
  channelAdded: 'Success! The channel {channelName} ({serviceName}) has been added!',
  telegramChannelEnter: 'Enter the channel name (example: @telegram):',
  telegramChannelSet: 'Success! The channel {channelName} has been assigned!',
  telegramChannelError: `Oops! I can't add a {channelName} channel!`,
  commandCanceled: 'Command {command} was canceled.',
  channelDontExist: `Oops! Can't find a channel in the watchlist!`,
  channelDeleted: 'Success! The channel {channelName} ({serviceName}) has been deleted!',
  cleared: 'Success! Watchlist has been cleared!',
  selectDelChannel: 'Select the channel you want to delete',
  channelIsNotFound: 'Oops! Channel {channelName} ({serviceName}) can not be found!',
  clearSure: 'Are you sure?',
  streamIsNotFound: 'Oops! Stream is not found or offline!',
  users: 'Users: {count}',
  channels: 'Channels: {count}',
  refresh: 'Refresh',
  online: 'Online: {count}',
  groupNote: [
    '',
    'Note for groups: Use \'Reply\' to answer.'
  ].join('\n')
};

export default Locale;