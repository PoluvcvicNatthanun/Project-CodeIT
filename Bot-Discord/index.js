require('dotenv').config();
const { ActivityType, Client, GatewayIntentBits } = require('discord.js');
const MusicPlayer = require('./musicPlayer');
const { sendMusicCard, sendStatus } = require('./commands/helpers');
const applicationCommands = require('./commands/application');
const { version } = require('./package.json');

const guildCommandQueues = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const musicPlayer = new MusicPlayer(sendStatus, sendMusicCard);

client.once('ready', async () => {
  console.log(`บอท ${client.user.tag} พร้อมใช้งานแล้ว!`);
  client.user.setPresence({
    activities: [
      {
        name: `/help | V${version}`,
        type: ActivityType.Playing,
      },
    ],
    status: 'online',
  });

  const guildIds = process.env.GUILD_ID
    ? [process.env.GUILD_ID]
    : [...client.guilds.cache.keys()];

  try {
    if (guildIds.length) {
      await client.application.commands.set([]);
      await Promise.all(
        guildIds.map((guildId) =>
          client.application.commands.set(applicationCommands.commands, guildId),
        ),
      );
    } else {
      await client.application.commands.set(applicationCommands.commands);
    }

    console.log(
      `ลงทะเบียน Slash Commands แล้ว (${guildIds.length ? `${guildIds.length} เซิร์ฟเวอร์` : 'global'})`,
    );
  } catch (error) {
    console.error('ลงทะเบียน Slash Commands ไม่สำเร็จ:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guildId) return;

  try {
    await interaction.deferReply({
      ephemeral: interaction.commandName !== 'status',
    });
  } catch (error) {
    console.error('เริ่มตอบ Slash Command ไม่สำเร็จ:', error);
    return;
  }

  const previousCommand =
    guildCommandQueues.get(interaction.guildId) || Promise.resolve();
  const currentCommand = previousCommand
    .catch((error) => {
      console.error('คำสั่งก่อนหน้าทำงานไม่สำเร็จ:', error);
    })
    .then(() => applicationCommands.execute(interaction, musicPlayer));
  guildCommandQueues.set(interaction.guildId, currentCommand);

  try {
    await currentCommand;
  } catch (error) {
    console.error(`Slash command /${interaction.commandName} failed:`, error);
    const reply = {
      content: 'คำสั่งทำงานไม่สำเร็จ กรุณาลองใหม่ครับ',
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(reply).catch(console.error);
    } else {
      await interaction.reply({ ...reply, ephemeral: true }).catch(console.error);
    }
  } finally {
    if (guildCommandQueues.get(interaction.guildId) === currentCommand) {
      guildCommandQueues.delete(interaction.guildId);
    }
  }
});

client.login(process.env.TOKEN);