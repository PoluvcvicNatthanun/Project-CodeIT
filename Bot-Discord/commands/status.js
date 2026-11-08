const { sendStatus } = require('./helpers');

module.exports = {
  names: ['!status', '!สถานะ'],
  execute(message, args, musicPlayer) {
    const status = musicPlayer.getStatus(message.guildId);
    if (!status) {
      return sendStatus(message.channel, 'ตอนนี้ไม่มีเพลงกำลังเล่นอยู่ครับ');
    }

    sendStatus(
      message.channel,
      `📊 **สถานะเพลง**\n🎶 ${status.paused ? 'หยุดชั่วคราว' : 'กำลังเล่น'}: **${status.track.title}**\n⏱️ ${status.elapsed} / ${status.duration}\n🔊 ระดับเสียง ${status.volume}% · เบส ${status.bass ? 'เปิด' : 'ปิด'} · วนเพลง ${status.loop ? 'เปิด' : 'ปิด'} · เพลงถัดไปในคิว ${status.queuedCount} เพลง`,
    );
  },
};
