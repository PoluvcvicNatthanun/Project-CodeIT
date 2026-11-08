const { sendStatus } = require('./helpers');

module.exports = {
  names: ['!loop', '!วน', '!วนเพลง'],
  execute(message, args, musicPlayer) {
    try {
      const option = args[0]?.toLowerCase();
      if (
        option &&
        !['on', 'เปิด', 'ใช่', 'off', 'ปิด', 'ไม่'].includes(option)
      ) {
        return sendStatus(message.channel, 'ใช้ `!loop on` หรือ `!loop off` ครับ');
      }
      const enabled =
        ['on', 'เปิด', 'ใช่'].includes(option) ? true :
        ['off', 'ปิด', 'ไม่'].includes(option) ? false :
        undefined;
      const isLooping = musicPlayer.setLoop(message.guildId, enabled);

      sendStatus(
        message.channel,
        isLooping
          ? '🔁 เปิดวนเพลงปัจจุบันแล้วครับ'
          : '➡️ ปิดวนเพลงแล้วครับ',
      );
    } catch (error) {
      sendStatus(message.channel, error.message);
    }
  },
};
