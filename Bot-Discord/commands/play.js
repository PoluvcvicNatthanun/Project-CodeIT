module.exports = {
  names: ['!play', '!เล่น'],
  async execute(message, args, musicPlayer) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      return message.reply('คุณต้องเข้าห้องเสียงก่อนครับ!');
    }

    const query = args.join(' ').trim().replace(/^<(.+)>$/, '$1');
    if (!query) {
      return message.reply('กรุณาใส่ลิงก์หรือชื่อเพลงครับ!');
    }

    try {
      await musicPlayer.play(message, voiceChannel, query);
    } catch (error) {
      console.error('เล่นเพลงไม่สำเร็จ:', error);
      const errorMessage = error.message || 'ไม่ทราบสาเหตุ';
      await message.reply(`เล่นเพลงไม่สำเร็จ: ${errorMessage.slice(0, 500)}`);
    }
  },
};
