const { EmbedBuilder } = require('discord.js');

function createMusicEmbed({
  title,
  description,
  fields = [],
  thumbnail,
  color = 0xf5a623,
}) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .addFields(fields)
    .setTimestamp();

  if (thumbnail) embed.setThumbnail(thumbnail);
  return embed;
}

function sendMusicCard(channel, data) {
  if (!channel) {
    console.error('ไม่พบช่องข้อความสำหรับส่งการ์ดเพลง');
    return;
  }

  channel.send({ embeds: [createMusicEmbed(data)] }).catch((error) => {
    console.error('ส่งการ์ดเพลงไม่สำเร็จ:', error);
  });
}

function sendStatus(channel, content) {
  if (!channel) {
    console.error('ไม่พบช่องข้อความสำหรับส่งสถานะเพลง');
    return;
  }

  const embed = createMusicEmbed({
    title: 'สถานะเพลง',
    description: content,
  });
  channel.send({ embeds: [embed] }).catch((error) => {
    console.error('ส่งสถานะเพลงไม่สำเร็จ:', error);
  });
}

module.exports = { createMusicEmbed, sendMusicCard, sendStatus };
