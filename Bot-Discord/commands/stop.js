const { sendStatus } = require('./helpers');

module.exports = {
  names: ['!stop', '!หยุด'],
  async execute(message, args, musicPlayer) {
    try {
      const queue = musicPlayer.getQueue(message.guildId);
      if (queue) queue.textChannel = message.channel;
      musicPlayer.stop(message.guildId);
      sendStatus(
        message.channel,
        '⏹️ หยุดเล่นเพลงและออกจากห้องเรียบร้อยครับ',
      );
    } catch (error) {
      sendStatus(message.channel, error.message);
    }
  },
};
