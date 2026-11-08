const { sendStatus } = require('./helpers');

module.exports = {
  names: ['!skip', '!ข้าม', '!next', '!ถัดไป', '!เพลงถัดไป'],
  async execute(message, args, musicPlayer) {
    try {
      await musicPlayer.skip(message.guildId);
    } catch (error) {
      sendStatus(message.channel, error.message);
    }
  },
};
