const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
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
const fs   = require("fs");
require("dotenv").config();

const TOKEN     = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const OWNER_ID  = process.env.OWNER_ID;


const DEFAULT_FOLDER = process.env.DEFAULT_FOLDER || null;
const AUDIO_ROOT = path.resolve(__dirname, "audios"); //audio path folder --> sub folder 


function loadTracksFromFolder(folderPath) {
  if (!fs.existsSync(folderPath)) return [];
  return fs
    .readdirSync(folderPath)
    .filter((f) => f.endsWith(".mp3"))
    .sort()
    .map((file) => ({
      name: path.basename(file, ".mp3"),
      file: path.join(folderPath, file),
    }));
}

function discoverFolders() {
  const folders = {};

  if (!fs.existsSync(AUDIO_ROOT)) {
    fs.mkdirSync(AUDIO_ROOT, { recursive: true });
    return folders;
  }

  const entries = fs.readdirSync(AUDIO_ROOT, { withFileTypes: true });
  const subDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const dir of subDirs) {
    const tracks = loadTracksFromFolder(path.join(AUDIO_ROOT, dir));
    if (tracks.length > 0) folders[dir] = tracks;
  }

  // default
  if (Object.keys(folders).length === 0) {
    const rootTracks = loadTracksFromFolder(AUDIO_ROOT);
    if (rootTracks.length > 0) folders["default"] = rootTracks;
  }

  return folders;
}

//State
const allFolders  = discoverFolders();
const folderNames = Object.keys(allFolders);

let activeFolderName = DEFAULT_FOLDER && allFolders[DEFAULT_FOLDER]
  ? DEFAULT_FOLDER
  : folderNames[0] || null;

let playlist          = activeFolderName ? allFolders[activeFolderName] : [];
let currentIndex      = 0;
let isLooping         = false;
let currentConnection = null;
let currentGuildId    = null;

let voteSkipSet = new Set();

function resetVoteSkip() {
  voteSkipSet = new Set();
}

//Audio Player
const player = createAudioPlayer();

function playAudio() {
  if (playlist.length === 0) return;
  const track = playlist[currentIndex];
  console.log(`🎵 Now playing: ${track.name}`);
  resetVoteSkip();
  player.play(createAudioResource(track.file));
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

//Helper
function getVCMemberCount(guild) {
  if (!currentConnection) return 0;
  const channelId = currentConnection.joinConfig?.channelId;
  if (!channelId) return 0;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return 0;
  return channel.members.filter((m) => !m.user.bot).size;
}

function requiredVotes(memberCount) {
  return Math.ceil(memberCount / 3);
}

//Slash Commands
const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Joins VC and plays the active playlist"),

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
    .setDescription("Jump to a specific track by its queue number (owner only)")
    .addIntegerOption((opt) =>
      opt
        .setName("number")
        .setDescription("Track number from /queue")
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("folders")
    .setDescription("List all available audio folders"),

  new SlashCommandBuilder()
    .setName("switchfolder")
    .setDescription("Switch to a different audio folder (owner only)")
    .addStringOption((opt) =>
      opt
        .setName("name")
        .setDescription("Folder name — leave empty for an interactive menu")
        .setRequired(false)
    ),
].map((c) => c.toJSON());

//Register Commands
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("✅ Commands registered");
}

//Client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

//Folder Switch Helper
function handleFolderSwitch(interaction, folderName, isSelectMenu) {
  const reply = (opts) =>
    isSelectMenu
      ? interaction.update({ ...opts, components: [] })
      : interaction.reply(opts);

  if (!allFolders[folderName]) {
    return reply({
      content: `❌ Folder \`${folderName}\` not found. Use /folders to see available ones.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (folderName === activeFolderName) {
    return reply({
      content: `ℹ️  Already on folder \`${folderName}\`.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  activeFolderName = folderName;
  playlist         = allFolders[folderName];
  currentIndex     = 0;
  resetVoteSkip();

  const wasPlaying = isLooping;
  if (wasPlaying) {
    player.stop();
    isLooping = true;
    playAudio();
  }

  return reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x2E0854)
        .setTitle("📁  Folder Switched")
        .setDescription(`Now using **\`${folderName}\`**`)
        .addFields(
          { name: "Tracks", value: `${playlist.length}`, inline: true },
          {
            name:  "Status",
            value: wasPlaying ? `▶ Playing #1 — ${playlist[0].name}` : "Idle",
            inline: true,
          }
        )
        .setFooter({ text: wasPlaying ? "Restarted from track 1" : "Use /play to start" }),
    ],
  });
}

//Interaction Handler
client.on("interactionCreate", async (interaction) => {

  // Select menu response for /switchfolder (no-arg flow)
  if (interaction.isStringSelectMenu() && interaction.customId === "folder_select") {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({
        content: "❌ Only the owner can switch folders.",
        flags: MessageFlags.Ephemeral,
      });
    }
    return handleFolderSwitch(interaction, interaction.values[0], true);
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, guild, member } = interaction;
  const isOwner = interaction.user.id === OWNER_ID;

  //folders
  if (commandName === "folders") {
    if (folderNames.length === 0) {
      return interaction.reply({
        content: "❌ No audio folders found inside `/audios/`.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const lines = folderNames.map((name) => {
      const count  = allFolders[name]?.length || 0;
      const active = name === activeFolderName ? " ◀ **active**" : "";
      return `\`${name}\` — **${count}** track${count !== 1 ? "s" : ""}${active}`;
    });

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2E0854)
          .setTitle("📁  Audio Folders")
          .setDescription(lines.join("\n"))
          .setFooter({ text: "Use /switchfolder to change the active playlist" }),
      ],
    });
  }

  //switchfolder
  if (commandName === "switchfolder") {
    if (!isOwner) {
      return interaction.reply({
        content: "❌ Only the owner can switch folders.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const nameArg = interaction.options.getString("name");

    if (!nameArg) {
      if (folderNames.length === 0) {
        return interaction.reply({ content: "❌ No folders found.", flags: MessageFlags.Ephemeral });
      }

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("folder_select")
          .setPlaceholder("Pick a folder…")
          .addOptions(
            folderNames.map((name) => ({
              label:       name,
              description: `${allFolders[name].length} tracks`,
              value:       name,
              default:     name === activeFolderName,
            }))
          )
      );

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2E0854)
            .setTitle("📁  Switch Folder")
            .setDescription("Select a playlist folder:"),
        ],
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
    }

    return handleFolderSwitch(interaction, nameArg, false);
  }

  //skip
  if (commandName === "skip") {
    if (!isLooping && player.state.status !== AudioPlayerStatus.Playing) {
      return interaction.reply({
        content: "❌ Nothing is playing right now.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (isOwner) {
      currentIndex = (currentIndex + 1) % playlist.length;
      resetVoteSkip();
      player.stop();
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2E0854)
            .setDescription(
              `⏭  **Skipped** by owner → now playing **#${currentIndex + 1} — ${playlist[currentIndex].name}**`
            ),
        ],
      });
    }

    const memberCount = getVCMemberCount(guild);
    const needed      = requiredVotes(memberCount);

    if (voteSkipSet.has(interaction.user.id)) {
      return interaction.reply({
        content: "❌ You already voted to skip.",
        flags: MessageFlags.Ephemeral,
      });
    }

    voteSkipSet.add(interaction.user.id);
    const votes = voteSkipSet.size;

    if (votes >= needed) {
      currentIndex = (currentIndex + 1) % playlist.length;
      resetVoteSkip();
      player.stop();
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2E0854)
            .setTitle("⏭  Vote skip passed!")
            .setDescription(`Skipping to **#${currentIndex + 1} — ${playlist[currentIndex].name}**`)
            .setFooter({ text: `${votes}/${needed} votes reached` }),
        ],
      });
    }

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2E0854)
          .setTitle("🗳️  Vote to skip")
          .setDescription(`**${playlist[currentIndex].name}**`)
          .addFields(
            { name: "Votes",          value: `${votes} / ${needed}`, inline: true },
            { name: "VC members",     value: `${memberCount}`,       inline: true },
            { name: "Required (1/3)", value: `${needed}`,            inline: true }
          )
          .setFooter({ text: `${interaction.user.username} voted • Need ${needed - votes} more vote(s)` }),
      ],
    });
  }

  //nowplaying
  if (commandName === "nowplaying") {
    if (!isLooping || playlist.length === 0) {
      return interaction.reply({
        content: "❌ Nothing is playing right now.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const track     = playlist[currentIndex];
    const nextTrack = playlist[(currentIndex + 1) % playlist.length];

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2E0854)
          .setTitle("🎵  Now Playing")
          .setDescription(`**${track.name}**`)
          .addFields(
            { name: "Track",   value: `#${currentIndex + 1} of ${playlist.length}`,                       inline: true },
            { name: "Up next", value: `#${(currentIndex + 1) % playlist.length + 1} — ${nextTrack.name}`, inline: true },
            { name: "Folder",  value: `\`${activeFolderName}\``,                                           inline: true }
          )
          .setFooter({ text: "Use /skip to vote skip • /queue to see full list" }),
      ],
    });
  }

  //queue
  if (commandName === "queue") {
    if (playlist.length === 0) {
      return interaction.reply({
        content: "❌ No tracks loaded. Add .mp3 files to your audios folder.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const lines = playlist.map((track, i) => {
      const isCurrent = i === currentIndex && isLooping;
      const num    = String(i + 1).padStart(2, "0");
      const prefix = isCurrent ? "▶" : "  ";
      return `${prefix} \`${num}\` ${isCurrent ? `**${track.name}**` : track.name}`;
    });

    const CHUNK       = 20;
    const currentPage = Math.floor(currentIndex / CHUNK);
    const start       = currentPage * CHUNK;
    const end         = Math.min(start + CHUNK, playlist.length);

    const embed = new EmbedBuilder()
      .setColor(0x2E0854)
      .setTitle(`📋  Queue — \`${activeFolderName}\``)
      .setDescription(lines.slice(start, end).join("\n"))
      .setFooter({ text: `Showing tracks ${start + 1}–${end} of ${playlist.length}` });

    if (isLooping) {
      embed.addFields({
        name:  "Now playing",
        value: `#${currentIndex + 1} — ${playlist[currentIndex].name}`,
      });
    }

    return interaction.reply({ embeds: [embed] });
  }

  //goto
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
          .setColor(0x2E0854)
          .setTitle("⏩  Jumped to track")
          .setDescription(`**#${number} — ${playlist[currentIndex].name}**`)
          .setFooter({ text: "Playing now" }),
      ],
    });
  }

  //Owneronly
  if (!isOwner) {
    return interaction.reply({
      content: "❌ You are not allowed to control this bot.",
      flags: MessageFlags.Ephemeral,
    });
  }

  //play
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
        content: `❌ No .mp3 files found in folder \`${activeFolderName}\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    const existing = getVoiceConnection(guild.id);
    if (existing) existing.destroy();

    try {
      currentGuildId    = guild.id;
      currentConnection = joinVoiceChannel({
        channelId:      voiceChannel.id,
        guildId:        guild.id,
        adapterCreator: guild.voiceAdapterCreator,
      });

      await entersState(currentConnection, VoiceConnectionStatus.Ready, 20000);
      currentConnection.subscribe(player);
      isLooping = true;
      resetVoteSkip();

      currentConnection.on(VoiceConnectionStatus.Disconnected, () => {
        isLooping         = false;
        currentConnection = null;
        currentGuildId    = null;
        player.stop();
        resetVoteSkip();
        console.log("🔌 Disconnected from VC");
      });

      playAudio();

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2E0854)
            .setTitle("▶️  Playing")
            .setDescription(`**#${currentIndex + 1} — ${playlist[currentIndex].name}**`)
            .addFields(
              { name: "Folder",       value: `\`${activeFolderName}\``, inline: true },
              { name: "Total tracks", value: `${playlist.length}`,      inline: true },
              { name: "Channel",      value: `${voiceChannel.name}`,    inline: true }
            )
            .setFooter({ text: "Use /queue to see all tracks • /switchfolder to change playlist" }),
        ],
      });
    } catch (err) {
      console.error("❌ VC Error:", err);
      return interaction.editReply({ content: "❌ Failed to join voice channel." });
    }
  }

  //pause
  if (commandName === "pause") {
    if (player.state.status !== AudioPlayerStatus.Playing) {
      return interaction.reply({ content: "❌ Nothing is playing.", flags: MessageFlags.Ephemeral });
    }
    player.pause();
    isLooping = false;
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2E0854)
          .setDescription("⏸  **Paused** — use `/resume` to continue"),
      ],
    });
  }

  //resume
  if (commandName === "resume") {
    if (player.state.status !== AudioPlayerStatus.Paused) {
      return interaction.reply({ content: "❌ Not paused.", flags: MessageFlags.Ephemeral });
    }
    player.unpause();
    isLooping = true;
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2E0854)
          .setDescription(`▶️  **Resumed** — #${currentIndex + 1} — ${playlist[currentIndex].name}`),
      ],
    });
  }

  // leave 
  if (commandName === "leave") {
    const conn = getVoiceConnection(guild.id);
    if (!conn) {
      return interaction.reply({ content: "❌ Not in a voice channel.", flags: MessageFlags.Ephemeral });
    }
    isLooping         = false;
    currentConnection = null;
    currentGuildId    = null;
    player.stop();
    conn.destroy();
    resetVoteSkip();
    return interaction.reply("poitu varen mamae durrr 👋");
  }
});

// Boot 
client.once("clientReady", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`📁 Folders loaded: ${folderNames.length}`);
  folderNames.forEach((name) => {
    console.log(`   └─ ${name}: ${allFolders[name].length} tracks`);
  });
  if (activeFolderName) console.log(`🎯 Default folder: ${activeFolderName}`);
});

client.on("error", console.error);
process.on("unhandledRejection", console.error);

(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();