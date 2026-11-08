const { sendStatus } = require('./helpers');

module.exports = {
  names: ['!bass', '!เบส', '!เพิ่มเบส'],
  execute(message, args, musicPlayer) {
    try {
      const option = args[0]?.toLowerCase();
      if (
        option &&
        !['on', 'เปิด', 'ใช่', 'off', 'ปิด', 'ไม่'].includes(option)
      ) {
        return sendStatus(message.channel, 'ใช้ `!bass on` หรือ `!bass off` ครับ');
      }
      const enabled =
        ['on', 'เปิด', 'ใช่'].includes(option) ? true :
        ['off', 'ปิด', 'ไม่'].includes(option) ? false :
        undefined;
      const isBassEnabled = musicPlayer.setBass(message.guildId, enabled);

      sendStatus(
        message.channel,
        isBassEnabled
          ? '🔊 เปิดเพิ่มเบสแล้วครับ'
          : '🔉 ปิดเพิ่มเบสแล้วครับ',
      );
    } catch (error) {
      sendStatus(message.channel, error.message);
    }
  },
};
