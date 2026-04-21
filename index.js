const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
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

// Playlist ------------------------->
const playlist = fs.existsSync(AUDIO_FOLDER)
  ? fs.readdirSync(AUDIO_FOLDER)
      .filter((file) => file.endsWith(".mp3"))
      .sort() 
      .map((file) => ({
        name: path.basename(file, ".mp3"), // for display without (.mp3) extension-------------------------?>
        file: path.join(AUDIO_FOLDER, file),
      }))
  : [];

let currentIndex = 0;
let isLooping = false;
let currentConnection = null;
let currentGuildId = null;

//Vote skip state------------------------->
let voteSkipSet = new Set();
let voteSkipActive = false;

function resetVoteSkip() {
  voteSkipSet = new Set();
  voteSkipActive = false;
}

//Audio player------------------------->
const player = createAudioPlayer();

function playAudio() {
  if (playlist.length === 0) return;
  const track = playlist[currentIndex];
  console.log(`🎵 Now playing: ${track.name}`);
  const resource = createAudioResource(track.file);
  player.play(resource);
  resetVoteSkip();// reset function for new track -------------------------?>
}

player.on(AudioPlayerStatus.Idle, () => {
  if (isLooping) {
    currentIndex = (currentIndex + 1) % playlist.length;
    playAudio();
  }
});

player.on("error", (err) => {
  console.error("🔊 Player error:", err.message);
  if (isLooping) setTimeout(playAudio, 1000);
});


function getVCMemberCount(guild) {
  if (!currentConnection) return 0;
  const channelId = currentConnection.joinConfig?.channelId;
  if (!channelId) return 0;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return 0;
  return channel.members.filter((m) => !m.user.bot).size;
}

function requiredVotes(memberCount) {
  return Math.ceil(memberCount / 3); //calcaulation function 1/3 for vote skip-------------------------?>
}

//Slash command definitions------------------------->
const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Joins VC and plays Sai's playlist"),

  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pause audio"),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Resume audio"),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Vote to skip the current track"),

  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("Leave VC"),

  new SlashCommandBuilder()
    .setName("nowplaying")
    .setDescription("Show the currently playing track"),

  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the full track queue"),

  new SlashCommandBuilder()
    .setName("goto")
    .setDescription("Jump to a specific track by its queue number")
    .addIntegerOption((opt) =>
      opt
        .setName("number")
        .setDescription("Track number from the queue (Enter the number shown in /queue)")
        .setRequired(true)
        .setMinValue(1)
    ),
].map((c) => c.toJSON());

//Register commands------------------------->
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("✅ Commands registered");
}

//Client------------------------->
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

//Interaction handler------------------------->
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guild, member } = interaction;
  const isOwner = interaction.user.id === OWNER_ID;

  if (commandName === "skip") {
    if (!isLooping && player.state.status !== AudioPlayerStatus.Playing) {
      return interaction.reply({
        content: "❌ Nothing is playing right now.",
        flags: MessageFlags.Ephemeral,
      });
    }//Bot owner instant skip option-------------------------?>

    if (isOwner) {
      currentIndex = (currentIndex + 1) % playlist.length;
      resetVoteSkip();
      player.stop();
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(2E0854)
            .setDescription(`⏭  **Skipped** by owner → now playing **#${currentIndex + 1} — ${playlist[currentIndex].name}**`),
        ],
      });
    }

//comman vote skip------------------------->
    const memberCount = getVCMemberCount(guild);
    const needed = requiredVotes(memberCount);

    if (voteSkipSet.has(interaction.user.id)) {
      return interaction.reply({
        content: "❌ You already voted to skip.",
        flags: MessageFlags.Ephemeral,
      });
    }

    voteSkipSet.add(interaction.user.id);
    const votes = voteSkipSet.size;

    if (votes >= needed) {
      //Enough votes : skip it-------------------------?>
      currentIndex = (currentIndex + 1) % playlist.length;
      resetVoteSkip();
      player.stop();
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(2E0854)
            .setTitle("⏭  Vote skip passed!")
            .setDescription(`Skipping to **#${currentIndex + 1} — ${playlist[currentIndex].name}**`)
            .setFooter({ text: `${votes}/${needed} votes reached` }),
        ],
      });
    }

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(2E0854)
          .setTitle("🗳️  Vote to skip")
          .setDescription(`**${playlist[currentIndex].name}**`)
          .addFields(
            { name: "Votes", value: `${votes} / ${needed}`, inline: true },
            { name: "VC members", value: `${memberCount}`, inline: true },
            { name: "Required (1/3)", value: `${needed}`, inline: true }
          )
          .setFooter({ text: `${interaction.user.username} voted • Need ${needed - votes} more vote(s)` }),
      ],
    });
  }

//nowplaying------------------------->

  if (commandName === "nowplaying") {
    if (!isLooping || playlist.length === 0) {
      return interaction.reply({
        content: "❌ Nothing is playing right now.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const track = playlist[currentIndex];
    const nextTrack = playlist[(currentIndex + 1) % playlist.length];

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(2E0854)
          .setTitle("🎵  Now Playing")
          .setDescription(`**${track.name}**`)
          .addFields(
            { name: "Track", value: `#${currentIndex + 1} of ${playlist.length}`, inline: true },
            { name: "Up next", value: `#${(currentIndex + 1) % playlist.length + 1} — ${nextTrack.name}`, inline: true }
          )
          .setFooter({ text: "Use /skip to vote skip • /queue to see full list" }),
      ],
    });
  }

//queue------------------------->

  if (commandName === "queue") {
    if (playlist.length === 0) {
      return interaction.reply({
        content: "❌ No tracks loaded in /audios folder.",
        flags: MessageFlags.Ephemeral,
      });
    }

    //spl bold for current track in queue-------------------------?>
    const lines = playlist.map((track, i) => {
      const isCurrent = i === currentIndex && isLooping;
      const num = String(i + 1).padStart(2, "0");
      const prefix = isCurrent ? "▶" : "  ";
      return `${prefix} \`${num}\` ${isCurrent ? `**${track.name}**` : track.name}`;
    });

//enbred for queue
    const CHUNK = 20;
    const currentPage = Math.floor(currentIndex / CHUNK);
    const start = currentPage * CHUNK;
    const end = Math.min(start + CHUNK, playlist.length);
    const pageLines = lines.slice(start, end);

    const embed = new EmbedBuilder()
      .setColor(2E0854)
      .setTitle("📋  Queue")
      .setDescription(pageLines.join("\n"))
      .setFooter({
        text: `Showing tracks ${start + 1}–${end} of ${playlist.length} `,
      });

    if (isLooping) {
      embed.addFields({
        name: "Now playing",
        value: `#${currentIndex + 1} — ${playlist[currentIndex].name}`,
      });
    }

    return interaction.reply({ embeds: [embed] });
  }

//goto only for owner **need to implement for all with voting system**
  if (commandName === "goto") {
    if (!isOwner) {
      return interaction.reply({
        content: "❌ Only the owner can use /goto.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!isLooping) {
      return interaction.reply({
        content: "❌ Nothing is playing. Use /play first.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const number = interaction.options.getInteger("number");

    if (number < 1 || number > playlist.length) {
      return interaction.reply({
        content: `❌ Invalid track number. Choose between **1** and **${playlist.length}**.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    currentIndex = number - 1;
    resetVoteSkip();
    player.stop(); 

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(2E0854)
          .setTitle("⏩  Jumped to track")
          .setDescription(`**#${number} — ${playlist[currentIndex].name}**`)
          .setFooter({ text: "Playing now" }),
      ],
    });
  }

//
  if (!isOwner) {
    return interaction.reply({
      content: "❌ You are not allowed to control this bot.",
      flags: MessageFlags.Ephemeral,
    });
  }


  //play------------------------->

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
        content: "❌ No audio files found in /audios folder.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    const existing = getVoiceConnection(guild.id);
    if (existing) existing.destroy();

    try {
      currentGuildId = guild.id;
      currentConnection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
      });

      await entersState(currentConnection, VoiceConnectionStatus.Ready, 20000);

      currentConnection.subscribe(player);
      isLooping = true;
      resetVoteSkip();

      currentConnection.on(VoiceConnectionStatus.Disconnected, () => {
        isLooping = false;
        player.stop();
        currentConnection = null;
        currentGuildId = null;
        resetVoteSkip();
        console.log("🔌 Disconnected from VC");
      });

      playAudio();

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(2E0854)
            .setTitle("▶️  Playing")
            .setDescription(`**#${currentIndex + 1} — ${playlist[currentIndex].name}**`)
            .addFields(
              { name: "Total tracks", value: `${playlist.length}`, inline: true },
              { name: "Channel", value: `${voiceChannel.name}`, inline: true }
            )
            .setFooter({ text: "Use /queue to see all tracks • /skip to vote skip" }),
        ],
      });
    } catch (err) {
      console.error("❌ VC Error:", err);
      return interaction.editReply({ content: "❌ Failed to join voice channel." });
    }
  }

  //pause------------------------->

  if (commandName === "pause") {
    if (player.state.status !== AudioPlayerStatus.Playing) {
      return interaction.reply({
        content: "❌ Nothing is playing.",
        flags: MessageFlags.Ephemeral,
      });
    }

    player.pause();
    isLooping = false;

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(2E0854)
          .setDescription("⏸  **Paused** — use `/resume` to continue"),
      ],
    });
  }

  //resume-------------------------?>
  if (commandName === "resume") {
    if (player.state.status !== AudioPlayerStatus.Paused) {
      return interaction.reply({
        content: "❌ Not paused.",
        flags: MessageFlags.Ephemeral,
      });
    }

    player.unpause();
    isLooping = true;

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(2E0854)
          .setDescription(`▶️  **Resumed** — #${currentIndex + 1} — ${playlist[currentIndex].name}`),
      ],
    });
  }

  // leave-------------------------?>

  if (commandName === "leave") {
    const conn = getVoiceConnection(guild.id);

    if (!conn) {
      return interaction.reply({
        content: "❌ Not in a voice channel.",
        flags: MessageFlags.Ephemeral,
      });
    }

    isLooping = false;
    player.stop();
    conn.destroy();
    currentConnection = null;
    currentGuildId = null;
    resetVoteSkip();

    return interaction.reply("poitu varen mamae durrr 👋");
  }
});

client.once("clientReady", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`🎧 Tracks loaded: ${playlist.length}`);
  playlist.forEach((t, i) => console.log(`  ${i + 1}. ${t.name}`));
});

client.on("error", console.error);
process.on("unhandledRejection", console.error);

(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
