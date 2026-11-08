const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const { Transform } = require('node:stream');
const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} = require('@discordjs/voice');
const ffmpegPath = require('ffmpeg-static');
const youtubeDlConstants = require('@distube/youtube-dl/src/constants');
const downloadYtDlp = require('@distube/youtube-dl/src/download');
const YOUTUBE_DL_PATH =
  process.env.YOUTUBE_DL_PATH || youtubeDlConstants.YOUTUBE_DL_PATH;

const DEFAULT_VOLUME = 0.8;
const VOLUME_STEP = 0.1;
const NORMALIZE_FILTER = 'loudnorm=I=-16:TP=-1.5:LRA=11';
const PROCESS_TIMEOUT_MS = 30_000;
let ytDlpReady;

async function ensureYtDlp() {
  if (!ytDlpReady) {
    ytDlpReady = (async () => {
      try {
        await fs.access(YOUTUBE_DL_PATH);
      } catch (error) {
        if (process.env.YOUTUBE_DL_PATH || error.code !== 'ENOENT') throw error;
        await downloadYtDlp();
        await fs.access(YOUTUBE_DL_PATH);
      }
    })().catch((error) => {
      ytDlpReady = null;
      const hint = process.env.YOUTUBE_DL_PATH
        ? `ตรวจสอบค่า YOUTUBE_DL_PATH (${YOUTUBE_DL_PATH})`
        : 'ตรวจสอบอินเทอร์เน็ตของโฮสต์ หรือตั้งค่า YOUTUBE_DL_PATH';
      throw new Error(`ไม่พบ yt-dlp ที่ ${YOUTUBE_DL_PATH}; ${hint}`, {
        cause: error,
      });
    });
  }

  await ytDlpReady;
}

function createPeakingFilter(sampleRate, frequency, gainDb, quality) {
  const amplitude = 10 ** (gainDb / 40);
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * quality);
  const a0 = 1 + alpha / amplitude;

  return {
    b0: (1 + alpha * amplitude) / a0,
    b1: (-2 * cosine) / a0,
    b2: (1 - alpha * amplitude) / a0,
    a1: (-2 * cosine) / a0,
    a2: (1 - alpha / amplitude) / a0,
  };
}

function createShelfFilter(sampleRate, frequency, gainDb, type) {
  const amplitude = 10 ** (gainDb / 40);
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const alpha = (sine / 2) * Math.sqrt(2);
  const beta = 2 * Math.sqrt(amplitude) * alpha;

  if (type === 'low') {
    const a0 = amplitude + 1 + (amplitude - 1) * cosine + beta;
    return {
      b0: (amplitude * (amplitude + 1 - (amplitude - 1) * cosine + beta)) / a0,
      b1: (2 * amplitude * (amplitude - 1 - (amplitude + 1) * cosine)) / a0,
      b2: (amplitude * (amplitude + 1 - (amplitude - 1) * cosine - beta)) / a0,
      a1: (-2 * (amplitude - 1 + (amplitude + 1) * cosine)) / a0,
      a2: (amplitude + 1 + (amplitude - 1) * cosine - beta) / a0,
    };
  }

  const a0 = amplitude + 1 - (amplitude - 1) * cosine + beta;
  return {
    b0: (amplitude * (amplitude + 1 + (amplitude - 1) * cosine + beta)) / a0,
    b1: (-2 * amplitude * (amplitude - 1 + (amplitude + 1) * cosine)) / a0,
    b2: (amplitude * (amplitude + 1 + (amplitude - 1) * cosine - beta)) / a0,
    a1: (2 * (amplitude - 1 - (amplitude + 1) * cosine)) / a0,
    a2: (amplitude + 1 - (amplitude - 1) * cosine - beta) / a0,
  };
}

class BassBoostTransform extends Transform {
  constructor(sampleRate = 48_000) {
    super();
    this.filters = [
      createShelfFilter(sampleRate, 180, 6, 'low'),
      createPeakingFilter(sampleRate, 100, 3, 0.8),
    ];
    this.channels = Array.from({ length: 2 }, () => ({
      filters: this.filters.map(() => ({
        input1: 0,
        input2: 0,
        output1: 0,
        output2: 0,
      })),
    }));
    this.pending = Buffer.alloc(0);
    this.targetMix = 0;
    this.currentMix = 0;
    this.rampStep = 1 / (sampleRate * 0.05);
  }

  setEnabled(enabled) {
    this.targetMix = enabled ? 1 : 0;
  }

  _transform(chunk, encoding, callback) {
    const input = this.pending.length
      ? Buffer.concat([this.pending, chunk])
      : chunk;
    const completeLength = input.length - (input.length % 4);
    this.pending = Buffer.from(input.subarray(completeLength));
    if (!completeLength) return callback();

    const output = Buffer.allocUnsafe(completeLength);
    for (let offset = 0; offset < completeLength; offset += 2) {
      const channel = this.channels[(offset / 2) % 2];
      const sample = input.readInt16LE(offset) / 32768;
      let equalized = sample;
      for (let index = 0; index < this.filters.length; index += 1) {
        const coefficients = this.filters[index];
        const state = channel.filters[index];
        const filtered =
          coefficients.b0 * equalized +
          coefficients.b1 * state.input1 +
          coefficients.b2 * state.input2 -
          coefficients.a1 * state.output1 -
          coefficients.a2 * state.output2;

        state.input2 = state.input1;
        state.input1 = equalized;
        state.output2 = state.output1;
        state.output1 = filtered;
        equalized = filtered;
      }

      if (this.currentMix < this.targetMix) {
        this.currentMix = Math.min(this.targetMix, this.currentMix + this.rampStep);
      } else if (this.currentMix > this.targetMix) {
        this.currentMix = Math.max(this.targetMix, this.currentMix - this.rampStep);
      }

      const mixed = sample + (equalized - sample) * this.currentMix;
      const limited =
        Math.abs(mixed) <= 0.92
          ? mixed
          : Math.sign(mixed) *
            (0.92 + 0.08 * Math.tanh((Math.abs(mixed) - 0.92) / 0.08));
      const bounded = Math.max(-1, Math.min(1, limited));
      output.writeInt16LE(
        Math.max(-32768, Math.min(32767, Math.round(bounded * 32768))),
        offset,
      );
    }

    callback(null, output);
  }
}

function formatDuration(seconds) {
  const totalSeconds = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  const time = [minutes, remainingSeconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');

  return hours ? `${hours}:${time}` : time;
}

function normalizeTrackTitle(title) {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(official|audio|video|lyrics?|visuali[sz]er|remaster(?:ed)?|karaoke|cover|version|hd|4k)\b/g, ' ')
    .replace(/[^a-z0-9\u0E00-\u0E7F]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function titleSimilarity(first, second) {
  const firstWords = new Set(normalizeTrackTitle(first).split(' ').filter(Boolean));
  const secondWords = new Set(normalizeTrackTitle(second).split(' ').filter(Boolean));
  if (!firstWords.size || !secondWords.size) return 0;

  const shared = [...firstWords].filter((word) => secondWords.has(word)).length;
  return shared / Math.min(firstWords.size, secondWords.size);
}

async function runYtDlp(args) {
  await ensureYtDlp();

  return new Promise((resolve, reject) => {
    const process = spawn(YOUTUBE_DL_PATH, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      process.kill();
      finish(new Error('YouTube ใช้เวลาตอบกลับนานเกินไป'));
    }, PROCESS_TIMEOUT_MS);

    const finish = (error, output) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(output);
    };

    process.stdout.setEncoding('utf8');
    process.stderr.setEncoding('utf8');
    process.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 5_000_000) {
        process.kill();
        finish(new Error('ข้อมูลเพลงจาก YouTube มีขนาดใหญ่เกินไป'));
      }
    });
    process.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-5_000);
    });
    process.once('error', (error) => finish(error));
    process.once('close', (code) => {
      if (code === 0) finish(null, stdout);
      else finish(new Error(stderr.trim() || `yt-dlp จบการทำงานด้วยรหัส ${code}`));
    });
  });
}

function getInput(query) {
  let url;
  try {
    url = new URL(query);
  } catch {
    return `ytsearch1:${query}`;
  }

  const hostname = url.hostname.toLowerCase();
  const isYouTube =
    hostname === 'youtu.be' ||
    hostname === 'youtube.com' ||
    hostname.endsWith('.youtube.com');
  if (!isYouTube || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('รองรับเฉพาะ URL จาก YouTube หรือชื่อเพลงสำหรับค้นหาครับ');
  }
  return url.toString();
}

class MusicPlayer {
  constructor(sendStatus, sendMusicCard) {
    this.sendStatus = sendStatus;
    this.sendMusicCard = sendMusicCard;
    this.queues = new Map();
  }

  getQueue(guildId) {
    return this.queues.get(guildId);
  }

  async resolveTrack(query) {
    const input = getInput(query);
    const output = await runYtDlp([
      '--no-warnings',
      '--no-playlist',
      '--dump-single-json',
      '--skip-download',
      '--',
      input,
    ]);

    const result = JSON.parse(output);
    const video = result.entries?.[0] || result;
    const url =
      video.webpage_url ||
      video.original_url ||
      (video.id ? `https://www.youtube.com/watch?v=${video.id}` : null);
    if (!url || !video.title) {
      throw new Error('ไม่พบข้อมูลเพลงจาก YouTube');
    }

    return {
      id: video.id,
      title: video.title,
      url,
      duration: video.duration || 0,
      thumbnail: video.thumbnail,
    };
  }

  async play(message, voiceChannel, query) {
    const track = await this.resolveTrack(query);
    track.requestedBy = message.author || message.user;
    let queue = this.getQueue(message.guildId);

    if (!queue) {
      queue = await this.createQueue(message.guildId, voiceChannel, message.channel);
    } else {
      queue.textChannel = message.channel;
    }

    queue.tracks.push(track);
    if (queue.currentTrack || queue.autoPlayLoading) {
      this.sendMusicCard(
        queue.textChannel,
        {
          title: '➕ Added to queue',
          description: `[${track.title}](${track.url})`,
          thumbnail: track.thumbnail,
          fields: [
            { name: 'LENGTH', value: formatDuration(track.duration), inline: true },
            { name: 'POSITION', value: String(queue.tracks.length), inline: true },
            { name: 'ADDED BY', value: track.requestedBy?.toString() || 'Unknown' },
          ],
        },
      );
      return;
    }

    await this.playNext(queue);
  }

  async createQueue(guildId, voiceChannel, textChannel) {
    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
      group: guildId,
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (error) {
      connection.destroy();
      throw new Error(`เชื่อมต่อห้องเสียงไม่สำเร็จ: ${error.message}`);
    }

    const queue = {
      guildId,
      textChannel,
      voiceChannel,
      player,
      connection,
      tracks: [],
      currentTrack: null,
      lastTrack: null,
      currentProcess: null,
      bassFilter: null,
      resource: null,
      volume: DEFAULT_VOLUME,
      bass: false,
      loop: false,
      autoPlay: false,
      autoPlayLoading: false,
      recentTrackIds: [],
      recentTrackTitles: [],
      startedAt: 0,
      pausedAt: 0,
      position: 0,
      generation: 0,
      stopping: false,
    };

    connection.subscribe(player);
    player.on('stateChange', (oldState, newState) => {
      if (
        newState.status === AudioPlayerStatus.Idle &&
        oldState.status !== AudioPlayerStatus.Idle
      ) {
        this.handleTrackEnd(queue);
      }
    });
    player.on('error', (error) => this.handlePlaybackError(queue, error));
    connection.on('stateChange', (_, newState) => {
      if (newState.status === VoiceConnectionStatus.Destroyed) {
        this.cleanupQueue(queue);
      }
    });

    this.queues.set(guildId, queue);
    return queue;
  }

  async playNext(queue) {
    if (this.getQueue(queue.guildId) !== queue || queue.stopping) return;

    let track = queue.tracks.shift();
    if (!track) {
      if (queue.autoPlayLoading) return;
      if (!queue.autoPlay || !queue.lastTrack) {
        this.sendStatus(queue.textChannel, '✅ เล่นเพลงในคิวครบแล้วครับ');
        this.cleanupQueue(queue);
        return;
      }

      queue.autoPlayLoading = true;
      try {
        const recommendation = await this.findAutoplayTrack(queue);
        if (this.getQueue(queue.guildId) !== queue || queue.stopping) return;
        if (!queue.autoPlay) {
          if (queue.tracks.length) return void this.playNext(queue);
          this.cleanupQueue(queue);
          return;
        }
        if (queue.tracks.length) {
          return void this.playNext(queue);
        }

        track = recommendation;
        this.sendMusicCard(queue.textChannel, {
          title: '🎲 Autoplay — random pick',
          description: `[${track.title}](${track.url})`,
          thumbnail: track.thumbnail,
        });
      } catch (error) {
        if (this.getQueue(queue.guildId) === queue && !queue.stopping) {
          this.sendStatus(
            queue.textChannel,
            `สุ่มหาเพลงสำหรับ Autoplay ไม่สำเร็จ: ${(error.message || 'เกิดข้อผิดพลาด').slice(0, 400)}`,
          );
          if (queue.tracks.length) return void this.playNext(queue);
        }
        return;
      } finally {
        queue.autoPlayLoading = false;
      }
    }
    if (!track) return;

    queue.currentTrack = track;
    queue.lastTrack = track;
    if (track.id) {
      queue.recentTrackIds = [
        ...queue.recentTrackIds.filter((id) => id !== track.id),
        track.id,
      ].slice(-20);
    }
    queue.recentTrackTitles = [
      ...queue.recentTrackTitles.filter(
        (title) => normalizeTrackTitle(title) !== normalizeTrackTitle(track.title),
      ),
      track.title,
    ].slice(-20);
    queue.position = 0;
    queue.startedAt = Date.now();
    const generation = ++queue.generation;

    try {
      await ensureYtDlp();
      const ytDlp = spawn(
        YOUTUBE_DL_PATH,
        [
          '--no-warnings',
          '--no-playlist',
          '--format',
          'bestaudio/best',
          '--output',
          '-',
          '--',
          track.url,
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const ffmpeg = spawn(
        ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          'pipe:0',
          '-vn',
          '-af',
          NORMALIZE_FILTER,
          '-f',
          's16le',
          '-ar',
          '48000',
          '-ac',
          '2',
          'pipe:1',
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      const process = { ytDlp, ffmpeg, stderr: '', generation };
      queue.currentProcess = process;

      const bassFilter = new BassBoostTransform();
      bassFilter.setEnabled(queue.bass);
      queue.bassFilter = bassFilter;
      ytDlp.stdout.pipe(ffmpeg.stdin);
      ffmpeg.stdin.on('error', (error) => {
        if (error.code !== 'EPIPE') {
          this.handlePlaybackError(queue, error, generation);
        }
      });
      ytDlp.stderr.on('data', (chunk) => {
        process.stderr = (process.stderr + chunk.toString()).slice(-5_000);
      });
      ffmpeg.stderr.on('data', (chunk) => {
        process.stderr = (process.stderr + chunk.toString()).slice(-5_000);
      });
      ytDlp.once('error', (error) =>
        this.handlePlaybackError(queue, error, generation),
      );
      ytDlp.once('close', (code) => {
        if (code !== 0) {
          this.handlePlaybackError(
            queue,
            new Error(process.stderr.trim() || `yt-dlp จบการทำงานด้วยรหัส ${code}`),
            generation,
          );
        }
      });
      ffmpeg.once('error', (error) =>
        this.handlePlaybackError(queue, error, generation),
      );
      ffmpeg.once('close', (code) => {
        if (code !== 0) {
          this.handlePlaybackError(
            queue,
            new Error(process.stderr.trim() || `FFmpeg จบการทำงานด้วยรหัส ${code}`),
            generation,
          );
        }
      });

      ffmpeg.stdout.pipe(bassFilter);
      const resource = createAudioResource(bassFilter, {
        inputType: StreamType.Raw,
        inlineVolume: true,
        metadata: track,
      });
      resource.volume.setVolume(queue.volume);
      queue.resource = resource;
      queue.player.play(resource);
      this.sendMusicCard(
        queue.textChannel,
        {
          title: '▶ Now playing',
          description: `[${track.title}](${track.url})`,
          thumbnail: track.thumbnail,
          fields: [
            { name: 'LENGTH', value: formatDuration(track.duration), inline: true },
            { name: 'REPEAT', value: queue.loop ? 'ON' : 'OFF', inline: true },
            { name: 'ADDED BY', value: track.requestedBy?.toString() || 'Unknown' },
          ],
        },
      );
    } catch (error) {
      this.handlePlaybackError(queue, error, generation);
    }
  }

  handleTrackEnd(queue) {
    if (this.getQueue(queue.guildId) !== queue || !queue.currentTrack) return;

    queue.lastTrack = queue.currentTrack;
    if (queue.loop) queue.tracks.unshift(queue.currentTrack);
    this.stopProcesses(queue);
    queue.currentTrack = null;
    queue.currentProcess = null;
    queue.resource = null;
    void this.playNext(queue);
  }

  handlePlaybackError(queue, error, generation = queue.generation) {
    if (
      this.getQueue(queue.guildId) !== queue ||
      queue.generation !== generation ||
      !queue.currentTrack
    ) {
      return;
    }

    this.sendStatus(
      queue.textChannel,
      `เล่นเพลงไม่สำเร็จ: ${(error.message || 'เกิดข้อผิดพลาดในการเล่นเพลง').slice(0, 500)}`,
    );
    this.stopProcesses(queue);
    queue.currentTrack = null;
    queue.currentProcess = null;
    queue.resource = null;
    queue.player.stop(true);
    void this.playNext(queue);
  }

  stopProcesses(queue) {
    const process = queue.currentProcess;
    if (!process) return;

    process.ytDlp.stdout.unpipe(process.ffmpeg.stdin);
    for (const child of [process.ytDlp, process.ffmpeg]) {
      if (child.exitCode === null && !child.killed) child.kill();
    }
  }

  async skip(guildId, requestedBy) {
    const queue = this.getQueue(guildId);
    if (!queue?.currentTrack) throw new Error('ไม่มีเพลงที่กำลังเล่นอยู่ครับ');

    const skippedTrack = queue.currentTrack;
    this.stopProcesses(queue);
    queue.currentProcess = null;
    queue.currentTrack = null;
    queue.resource = null;
    queue.player.stop(true);
    this.sendMusicCard(queue.textChannel, {
      title: `▶ Skipped — ${skippedTrack.title}`,
      description: `[${skippedTrack.title}](${skippedTrack.url})`,
      thumbnail: skippedTrack.thumbnail,
      fields: [
        { name: 'LENGTH', value: `00:00 / ${formatDuration(skippedTrack.duration)}`, inline: true },
        { name: 'REPEAT', value: queue.loop ? 'ON' : 'OFF', inline: true },
        { name: 'ADDED BY', value: skippedTrack.requestedBy?.toString() || 'Unknown' },
        {
          name: 'QUEUE',
          value: queue.tracks.length
            ? `${queue.tracks.length} track${queue.tracks.length === 1 ? '' : 's'} left in queue`
            : 'There is no track left in queue',
        },
        ...(requestedBy
          ? [{ name: 'SKIPPED BY', value: requestedBy.toString() }]
          : []),
      ],
    });
    await this.playNext(queue);
  }

  setLoop(guildId, enabled) {
    const queue = this.getQueue(guildId);
    if (!queue?.currentTrack) throw new Error('ไม่มีเพลงที่กำลังเล่นอยู่ครับ');

    queue.loop = typeof enabled === 'boolean' ? enabled : !queue.loop;
    return queue.loop;
  }

  setBass(guildId, enabled) {
    const queue = this.getQueue(guildId);
    if (!queue?.currentTrack) throw new Error('ไม่มีเพลงที่กำลังเล่นอยู่ครับ');

    queue.bass = typeof enabled === 'boolean' ? enabled : !queue.bass;
    queue.bassFilter?.setEnabled(queue.bass);
    return queue.bass;
  }

  setAutoPlay(guildId, enabled) {
    const queue = this.getQueue(guildId);
    if (!queue || (!queue.currentTrack && !queue.autoPlayLoading)) {
      throw new Error('ไม่มีเพลงกำลังเล่นหรือกำลังค้นหาเพลงอัตโนมัติอยู่ครับ');
    }

    queue.autoPlay = typeof enabled === 'boolean' ? enabled : !queue.autoPlay;
    return queue.autoPlay;
  }

  async searchYouTube(query) {
    const output = await runYtDlp([
      '--no-warnings',
      '--flat-playlist',
      '--dump-single-json',
      '--skip-download',
      '--',
      `ytsearch15:${query}`,
    ]);
    return JSON.parse(output);
  }

  async findAutoplayTrack(queue) {
    const lastTrack = queue.lastTrack;
    const title = lastTrack.title
      .replace(/\s*[\[(](?:official|lyrics?|audio|music video|visuali[sz]er)[^\])]*[\])]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const queries = [...new Set([title, `${title} music`, `${title} similar songs`].filter(Boolean))];
    const candidates = new Map();
    const searchErrors = [];

    const addCandidates = (result) => {
      const entries = Array.isArray(result.entries)
        ? result.entries
        : result.id && result.title
          ? [result]
          : [];
      for (const video of entries) {
        if (
          !video.id ||
          !video.title ||
          video.id === lastTrack.id ||
          (video.duration !== undefined && video.duration < 60)
        ) {
          continue;
        }
        candidates.set(video.id, video);
      }
    };

    for (const query of queries) {
      try {
        const result = await this.searchYouTube(query);
        addCandidates(result);
      } catch (error) {
        searchErrors.push(error.message || String(error));
      }
    }

    const getDistinctResults = () => [...candidates.values()].filter((video) => {
      if (
        video.id === lastTrack.id ||
        titleSimilarity(video.title, lastTrack.title) >= 0.6
      ) {
        return false;
      }

      return !queue.recentTrackTitles.some(
        (recentTitle) => titleSimilarity(video.title, recentTitle) >= 0.8,
      );
    });
    let results = getDistinctResults();
    if (!results.length) {
      try {
        addCandidates(await this.searchYouTube('popular songs music'));
        results = getDistinctResults();
      } catch (error) {
        searchErrors.push(error.message || String(error));
      }
    }

    if (!results.length) {
      const details = searchErrors.length
        ? `: ${searchErrors[0].slice(0, 250)}`
        : '';
      throw new Error(`ไม่พบเพลงอื่นจากผลค้นหา YouTube${details}`);
    }

    const unseen = results.filter(
      (video) => !queue.recentTrackIds.includes(video.id),
    );
    const choices = unseen.length ? unseen : results;
    const video = choices[Math.floor(Math.random() * choices.length)];
    return {
      id: video.id,
      title: video.title,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      duration: video.duration || 0,
      thumbnail: video.thumbnail,
      requestedBy: lastTrack.requestedBy,
    };
  }

  adjustVolume(guildId, change) {
    const queue = this.getQueue(guildId);
    if (!queue?.currentTrack) throw new Error('ไม่มีเพลงที่กำลังเล่นอยู่ครับ');

    queue.volume = Math.max(0, Math.min(1, queue.volume + change));
    queue.resource?.volume?.setVolume(queue.volume);
    return Math.round(queue.volume * 100);
  }

  setVolumePercent(guildId, percent) {
    const queue = this.getQueue(guildId);
    if (!queue?.currentTrack) throw new Error('ไม่มีเพลงที่กำลังเล่นอยู่ครับ');
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      throw new Error('ระดับเสียงต้องอยู่ระหว่าง 0 ถึง 100% ครับ');
    }

    queue.volume = percent / 100;
    queue.resource?.volume?.setVolume(queue.volume);
    return percent;
  }

  increaseVolume(guildId) {
    return this.adjustVolume(guildId, VOLUME_STEP);
  }

  decreaseVolume(guildId) {
    return this.adjustVolume(guildId, -VOLUME_STEP);
  }

  stop(guildId) {
    const queue = this.getQueue(guildId);
    if (!queue) throw new Error('ไม่มีเพลงกำลังเล่นอยู่ครับ');

    queue.stopping = true;
    this.queues.delete(guildId);
    this.stopProcesses(queue);
    queue.player.stop(true);
    queue.connection.destroy();
    queue.tracks.length = 0;
    queue.resource = null;
  }

  cleanupQueue(queue) {
    if (this.getQueue(queue.guildId) !== queue) return;

    this.queues.delete(queue.guildId);
    queue.stopping = true;
    this.stopProcesses(queue);
    queue.connection.destroy();
  }

  getStatus(guildId) {
    const queue = this.getQueue(guildId);
    if (!queue?.currentTrack) return null;

    const elapsed = queue.pausedAt
      ? queue.pausedAt - queue.startedAt
      : Date.now() - queue.startedAt;

    return {
      track: queue.currentTrack,
      elapsed: formatDuration(queue.position + elapsed / 1000),
      duration: formatDuration(queue.currentTrack.duration),
      queuedCount: queue.tracks.length,
      paused: queue.player.state.status === AudioPlayerStatus.Paused,
      volume: Math.round(queue.volume * 100),
      bass: queue.bass,
      loop: queue.loop,
      autoPlay: queue.autoPlay,
    };
  }
}

module.exports = MusicPlayer;
