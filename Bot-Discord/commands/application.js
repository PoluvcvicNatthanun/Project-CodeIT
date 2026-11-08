const { SlashCommandBuilder } = require('discord.js');
const {
  createMusicEmbed,
  sendMusicCard,
} = require('./helpers');

const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a YouTube video or search for a song')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('YouTube URL or song name')
        .setRequired(true),
    ),
  new SlashCommandBuilder().setName('help').setDescription('Show music bot commands'),
  new SlashCommandBuilder().setName('skip').setDescription('Skip the current song'),
  new SlashCommandBuilder().setName('next').setDescription('Play the next song'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop music and leave voice'),
  new SlashCommandBuilder().setName('status').setDescription('Show current playback status'),
  new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Toggle repeat for the current song')
    .addBooleanOption((option) =>
      option.setName('enabled').setDescription('Turn repeat on or off'),
    ),
  new SlashCommandBuilder()
    .setName('bass')
    .setDescription('Turn bass boost on or off')
    .addBooleanOption((option) =>
      option.setName('enabled').setDescription('Turn bass boost on or off'),
    ),
  new SlashCommandBuilder()
    .setName('autoplay')
    .setDescription('Randomly play YouTube songs when the queue is empty')
    .addBooleanOption((option) =>
      option.setName('enabled').setDescription('Turn autoplay on or off'),
    ),
  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Adjust playback volume')
    .addStringOption((option) =>
      option
        .setName('action')
        .setDescription('Choose how to adjust volume')
        .setRequired(true)
        .addChoices(
          { name: 'Increase by 10%', value: 'increase' },
          { name: 'Decrease by 10%', value: 'decrease' },
          { name: 'Set exact level', value: 'set' },
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName('percent')
        .setDescription('Volume from 0 to 100; required for Set exact level')
        .setMinValue(0)
        .setMaxValue(100),
    ),
].map((command) => command.toJSON());

async function execute(interaction, musicPlayer) {
  const { commandName } = interaction;
  const guildId = interaction.guildId;
  const channel = interaction.channel;
  const voiceChannel = interaction.member?.voice?.channel;

  if (commandName === 'help') {
    return interaction.editReply({
      embeds: [
        createMusicEmbed({
          title: '🎵 Music bot commands',
          description: [
            '`/play query:<URL or song>` — เล่นเพลงหรือค้นหาเพลง',
            '`/skip` หรือ `/next` — ข้ามเพลง',
            '`/stop` — หยุดเพลงและออกจากห้องเสียง',
            '`/status` — ดูสถานะเพลง',
            '`/loop [enabled]` — เปิดหรือปิดวนเพลง',
            '`/bass [enabled]` — เปิดหรือปิดเพิ่มเบส',
            '`/autoplay [enabled]` — สุ่มเพลง YouTube ต่อเมื่อเพลงจบ',
            '`/volume` — ปรับระดับเสียง',
          ].join('\n'),
        }),
      ],
    });
  }

  if (commandName === 'status') {
    const status = musicPlayer.getStatus(guildId);
    if (!status) {
      return interaction.editReply({
        embeds: [
          createMusicEmbed({
            title: '📭 Nothing is playing',
            description: 'There is no track in the queue.',
          }),
        ],
      });
    }

    return interaction.editReply({
      embeds: [
        createMusicEmbed({
          title: '▶ Now playing',
          description: `[${status.track.title}](${status.track.url})`,
          thumbnail: status.track.thumbnail,
          fields: [
            { name: 'LENGTH', value: `${status.elapsed} / ${status.duration}`, inline: true },
            { name: 'REPEAT', value: status.loop ? 'ON' : 'OFF', inline: true },
            { name: 'BASS', value: status.bass ? 'ON' : 'OFF', inline: true },
            { name: 'AUTOPLAY', value: status.autoPlay ? 'ON' : 'OFF', inline: true },
            { name: 'VOLUME', value: `${status.volume}%`, inline: true },
            { name: 'ADDED BY', value: status.track.requestedBy?.toString() || 'Unknown' },
            { name: 'QUEUE', value: `${status.queuedCount} track(s) left in queue` },
          ],
        }),
      ],
    });
  }

  try {
    if (commandName === 'play') {
      if (!voiceChannel) throw new Error('เข้าห้องเสียงก่อนใช้คำสั่งนี้ครับ');
      await musicPlayer.play(
        interaction,
        voiceChannel,
        interaction.options.getString('query', true),
      );
      return interaction.editReply('รับคำขอเพลงแล้วครับ');
    }

    if (commandName === 'skip' || commandName === 'next') {
      await musicPlayer.skip(guildId, interaction.user);
      return interaction.editReply('ข้ามไปเพลงถัดไปแล้วครับ');
    }

    if (commandName === 'stop') {
      musicPlayer.stop(guildId);
      sendMusicCard(channel, {
        title: '⏹ Playback stopped',
        description: 'หยุดเล่นเพลงและออกจากห้องเสียงแล้วครับ',
      });
      return interaction.editReply('หยุดเพลงแล้วครับ');
    }

    if (commandName === 'loop') {
      const enabled = interaction.options.getBoolean('enabled');
      const isLooping = musicPlayer.setLoop(guildId, enabled ?? undefined);
      sendMusicCard(channel, {
        title: isLooping ? '🔁 Repeat enabled' : '➡️ Repeat disabled',
        description: isLooping
          ? 'วนเพลงปัจจุบันซ้ำเมื่อเพลงจบ'
          : 'ปิดการวนเพลงแล้ว',
      });
      return interaction.editReply(isLooping ? 'เปิดวนเพลงแล้วครับ' : 'ปิดวนเพลงแล้วครับ');
    }

    if (commandName === 'bass') {
      const enabled = interaction.options.getBoolean('enabled');
      const isBassEnabled = musicPlayer.setBass(guildId, enabled ?? undefined);
      sendMusicCard(channel, {
        title: isBassEnabled ? '🔊 Bass boost enabled' : '🔉 Bass boost disabled',
        description: isBassEnabled ? 'เปิดเพิ่มเบสแล้วครับ' : 'ปิดเพิ่มเบสแล้วครับ',
      });
      return interaction.editReply(
        isBassEnabled ? 'เปิดเพิ่มเบสแล้วครับ' : 'ปิดเพิ่มเบสแล้วครับ',
      );
    }

    if (commandName === 'autoplay') {
      const enabled = interaction.options.getBoolean('enabled');
      const isAutoPlayEnabled = musicPlayer.setAutoPlay(guildId, enabled ?? undefined);
      sendMusicCard(channel, {
        title: isAutoPlayEnabled ? '🎲 Autoplay enabled' : '⏹️ Autoplay disabled',
        description: isAutoPlayEnabled
          ? 'เมื่อเพลงจบและไม่มีเพลงในคิว จะสุ่มเพลงจาก YouTube มาเล่นต่อ'
          : 'ปิดการสุ่มเพลงอัตโนมัติแล้ว',
      });
      return interaction.editReply(
        isAutoPlayEnabled ? 'เปิด Autoplay แล้วครับ' : 'ปิด Autoplay แล้วครับ',
      );
    }

    if (commandName === 'volume') {
      const action = interaction.options.getString('action', true);
      const percent = interaction.options.getInteger('percent');
      let volume;

      if (action === 'increase') {
        volume = musicPlayer.increaseVolume(guildId);
      } else if (action === 'decrease') {
        volume = musicPlayer.decreaseVolume(guildId);
      } else {
        if (percent === null) {
          throw new Error('ระบุ percent ตั้งแต่ 0 ถึง 100 ด้วยครับ');
        }
        volume = musicPlayer.setVolumePercent(guildId, percent);
      }

      sendMusicCard(channel, {
        title: '🔊 Volume updated',
        description: `ตั้งระดับเสียงเป็น **${volume}%** แล้วครับ`,
      });
      return interaction.editReply(`ระดับเสียง ${volume}% ครับ`);
    }
  } catch (error) {
    console.error(`Slash command /${commandName} failed:`, error);
    return interaction.editReply(
      `ทำคำสั่งไม่สำเร็จ: ${(error.message || 'เกิดข้อผิดพลาด').slice(0, 500)}`,
    );
  }
}

module.exports = { commands, execute };
