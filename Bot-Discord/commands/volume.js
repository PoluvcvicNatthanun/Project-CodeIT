const { sendStatus } = require('./helpers');

const volumeCommands = new Map([
  ['!volup', 'up'],
  ['!เสียงเพิ่ม', 'up'],
  ['!เสียงขึ้น', 'up'],
  ['!เพิ่มเสียง', 'up'],
  ['!voldown', 'down'],
  ['!เสียงลด', 'down'],
  ['!เสียงลง', 'down'],
  ['!ลดเสียง', 'down'],
]);

module.exports = {
  names: [
    '!volume',
    '!vol',
    '!เสียง',
    ...volumeCommands.keys(),
  ],
  execute(message, args, musicPlayer, commandName) {
    try {
      const direction = volumeCommands.get(commandName) || args[0]?.toLowerCase();
      let volume;

      if (['up', 'เพิ่ม', 'ขึ้น', '+'].includes(direction)) {
        volume = musicPlayer.increaseVolume(message.guildId);
      } else if (['down', 'ลด', 'ลง', '-'].includes(direction)) {
        volume = musicPlayer.decreaseVolume(message.guildId);
      } else if (/^\d{1,3}$/.test(direction || '')) {
        volume = musicPlayer.setVolumePercent(
          message.guildId,
          Number(direction),
        );
      } else {
        return sendStatus(
          message.channel,
          'ใช้ `!volup` / `!voldown` หรือ `!volume 0-100` เพื่อปรับเสียงครับ',
        );
      }

      sendStatus(message.channel, `🔊 ปรับระดับเสียงเป็น ${volume}% แล้วครับ`);
    } catch (error) {
      sendStatus(message.channel, error.message);
    }
  },
};
