const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  MessageFlags,
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
} = require("@discordjs/voice");

const path = require("path");
const fs = require("fs");
require("dotenv").config();

const TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const OWNER_ID = process.env.OWNER_ID;

const AUDIO_FOLDER = path.resolve(__dirname, "audios");

// audio folder model
const playlist = fs.existsSync(AUDIO_FOLDER)
  ? fs.readdirSync(AUDIO_FOLDER)
      .filter(file => file.endsWith(".mp3"))
      .map(file => path.join(AUDIO_FOLDER, file))
  : [];

let currentIndex = 0;
let isLooping = false;
let currentConnection = null;

const player = createAudioPlayer();

// play--------------------------------------------------------------------->
function playAudio() {
  if (playlist.length === 0) return;

  const file = playlist[currentIndex];
  console.log(`🎵 Now playing: ${path.basename(file)}`);

  const resource = createAudioResource(file);
  player.play(resource);
}

// LOOP method
player.on(AudioPlayerStatus.Idle, () => {
  if (isLooping) {
    currentIndex = (currentIndex + 1) % playlist.length;
    playAudio();
  }
});

// Error handler
player.on("error", (err) => {
  console.error("🔊 Player error:", err.message);
  if (isLooping) setTimeout(playAudio, 1000);
});

//dc commands
const commands = [
  new SlashCommandBuilder().setName("play").setDescription("Joins VC and plays Sai's playlist"),
  new SlashCommandBuilder().setName("pause").setDescription("Pause audio"),
  new SlashCommandBuilder().setName("resume").setDescription("Resume audio"),
  new SlashCommandBuilder().setName("skip").setDescription("Skip current track"),
  new SlashCommandBuilder().setName("leave").setDescription("Leave VC"),
].map(c => c.toJSON());

// COMMANDS (register)
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("Slash commands registered");
}

// CLIENT (need to learn this)
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates, 
  ],
});

//Commasnd handler
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // owner only perms------------------------------------------------------>
  if (interaction.user.id !== OWNER_ID) {
    return interaction.reply({
      content: "❌ You are not allowed to control this bot.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const { commandName, guild, member } = interaction;

  //PLAY
  if (commandName === "play") {
    const voiceChannel = member.voice?.channel;

    if (!voiceChannel) {
      return interaction.reply({
        content: "❌ Join a voice channel first!",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (playlist.length === 0) {
      return interaction.reply({
        content: "❌ No audio files in /audios folder",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    const existing = getVoiceConnection(guild.id);
    if (existing) existing.destroy();

    try {
      currentConnection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
      });

      await entersState(currentConnection, VoiceConnectionStatus.Ready, 20000);

      currentConnection.subscribe(player);
      isLooping = true;

      currentConnection.on(VoiceConnectionStatus.Disconnected, () => {
        isLooping = false;
        player.stop();
        currentConnection = null;
        console.log("🔌 Disconnected from VC");
      });

      playAudio();

      return interaction.editReply({
        content: `▶️ Playing **${path.basename(playlist[currentIndex])}**`,
      });

    } catch (err) {
      console.error("❌ VC Error:", err);
      return interaction.editReply({
        content: "❌ Failed to join voice channel",
      });
    }
  }

  //⏸ PAUSE
  if (commandName === "pause") {
    if (player.state.status !== AudioPlayerStatus.Playing) {
      return interaction.reply({
        content: "❌ Nothing is playing",
        flags: MessageFlags.Ephemeral,
      });
    }

    player.pause();
    isLooping = false;

    return interaction.reply("⏸ Paused");
  }

  //RESUME
  if (commandName === "resume") {
    if (player.state.status !== AudioPlayerStatus.Paused) {
      return interaction.reply({
        content: "❌ Not paused",
        flags: MessageFlags.Ephemeral,
      });
    }

    player.unpause();
    isLooping = true;

    return interaction.reply("▶️ Resumed");
  }

  // ⏭ SKIP
  if (commandName === "skip") {
    if (!isLooping) {
      return interaction.reply({
        content: "❌ Nothing is playing",
        flags: MessageFlags.Ephemeral,
      });
    }

    currentIndex = (currentIndex + 1) % playlist.length;
    player.stop(); 

    return interaction.reply("⏭ Skipped");
  }

  // LEAVE
  if (commandName === "leave") {
    const conn = getVoiceConnection(guild.id);

    if (!conn) {
      return interaction.reply({
        content: "❌ Not in a voice channel",
        flags: MessageFlags.Ephemeral,
      });
    }

    isLooping = false;
    player.stop();
    conn.destroy();
    currentConnection = null;

    return interaction.reply("poitu varen mamae durrr");
  }
});

// ready
client.once("clientReady", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`🎧 Tracks loaded: ${playlist.length}`);
});

// ⚠️ ERROR HANDLING
client.on("error", console.error);
process.on("unhandledRejection", console.error);

// npm start
(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();