# Discord Audio Loop Bot

A Discord bot that plays a local audio file on **infinite loop** in a voice channel.

# Commands

 `/play`    Join your current voice channel & loop the audio 
 `/pause`   Pause the playback                               
 `/resume`  Resume from where it was paused                  
 `/leave`   Stop playback & leave the voice channel 

 added skip too        

> All commands are **owner-only**. Others see: `Vaipu illa raja 🙅`

# Dependencies

- `discord.js` — Discord API wrapper
- `@discordjs/voice` — Voice connection & audio playback
- `@discordjs/opus` — Audio encoding
- `ffmpeg-static` — Bundled FFmpeg (fallback)
- `sodium-native` — Encryption for voice
- `dotenv` — Environment variable loading