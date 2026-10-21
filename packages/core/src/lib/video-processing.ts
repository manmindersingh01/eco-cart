import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { parseEnv } from './config.ts'
import { MAX_VIDEO_SECONDS } from './videos.ts'

/*
 * Turns an uploaded product video into one file every browser plays: H.264
 * and AAC in MP4, at most 720p and 30 frames a second, with the index at the
 * front so playback starts before the whole file arrives, and a poster image.
 * Runs only in the worker, which runs ffprobe and ffmpeg as child processes.
 * Re-encoding drops all metadata, including any location a phone recorded.
 */

/** Where the worker finds ffmpeg and ffprobe; its Docker image installs both. */
export interface VideoTools {
  ffmpegPath: string
  ffprobePath: string
}

export function loadVideoTools(
  env: NodeJS.ProcessEnv = process.env,
): VideoTools {
  const config = parseEnv(
    z.object({
      FFMPEG_PATH: z.string().min(1, 'must not be empty').default('ffmpeg'),
      FFPROBE_PATH: z.string().min(1, 'must not be empty').default('ffprobe'),
    }),
    env,
  )
  return { ffmpegPath: config.FFMPEG_PATH, ffprobePath: config.FFPROBE_PATH }
}

/** A video that cannot be used; the message is shown to the seller. */
export class VideoRejectedError extends Error {
  override name = 'VideoRejectedError'
}

export interface PreparedVideo {
  /** MP4, ready to serve. */
  video: Buffer
  /** JPEG, the same size as the video. */
  poster: Buffer
  width: number
  height: number
  durationMs: number
}

const execFileAsync = promisify(execFile)

const PROBE_TIMEOUT_MS = 30_000
const CONVERT_TIMEOUT_MS = 10 * 60_000
/** A recording of "one minute" often lasts a few hundredths longer. */
const DURATION_GRACE_SECONDS = 0.5
const MAX_VIDEO_PIXELS = 4096 * 2160

// Only these demuxers may read an upload, so a file that is really a
// playlist or another format can never make ffmpeg open other files. The
// first name is the one demuxer that reads MP4 and MOV.
const INPUT_RESTRICTIONS = [
  '-protocol_whitelist',
  'file',
  '-format_whitelist',
  'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm',
]

// Fits the picture inside 1280 by 720, or 720 by 1280 when it stands
// upright, never enlarges it, and keeps both sides even for H.264.
const SCALE_TO_720P =
  "scale=w='min(iw,if(gte(iw,ih),1280,720))':h='min(ih,if(gte(iw,ih),720,1280))'" +
  ':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1'

const NOT_A_VIDEO = 'The file is not an MP4, MOV, or WebM video'
const COULD_NOT_CONVERT =
  'The video could not be converted; export it again as MP4 and add it'

const probeOutput = z.object({
  format: z.object({ duration: z.string().optional() }),
  streams: z.array(
    z.object({
      index: z.number().int(),
      codec_type: z.string().optional(),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
      // Cover art inside an MP4 counts as a video stream too.
      disposition: z.object({ attached_pic: z.number().optional() }).optional(),
    }),
  ),
})
type Probe = z.infer<typeof probeOutput>

async function run(
  path: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  const { stdout } = await execFileAsync(path, args, {
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout
}

/**
 * A program that exits with an error code could not read the file. One that
 * could not start, ran out of time, or was stopped is the worker's problem,
 * so the job is retried instead.
 */
const fileWasTheProblem = (error: unknown) =>
  error instanceof Error &&
  'code' in error &&
  typeof error.code === 'number' &&
  !('killed' in error && error.killed)

async function probe(
  tools: VideoTools,
  path: string,
  rejection: string,
): Promise<Probe> {
  let stdout: string
  try {
    stdout = await run(
      tools.ffprobePath,
      [
        '-v',
        'error',
        ...INPUT_RESTRICTIONS,
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        path,
      ],
      PROBE_TIMEOUT_MS,
    )
  } catch (error) {
    if (fileWasTheProblem(error)) throw new VideoRejectedError(rejection)
    throw error
  }
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch {
    throw new VideoRejectedError(rejection)
  }
  const parsed = probeOutput.safeParse(json)
  if (!parsed.success) throw new VideoRejectedError(rejection)
  return parsed.data
}

function pictureOf(probed: Probe) {
  return probed.streams.find(
    (stream) =>
      stream.codec_type === 'video' && !stream.disposition?.attached_pic,
  )
}

function checkUpload(probed: Probe) {
  const picture = pictureOf(probed)
  if (!picture?.width || !picture.height) {
    throw new VideoRejectedError(
      'The file has no picture in it; add a video, not only sound',
    )
  }
  if (picture.width * picture.height > MAX_VIDEO_PIXELS) {
    throw new VideoRejectedError(
      'The video is larger than 4K; export it at a smaller size',
    )
  }
  const seconds = Number(probed.format.duration)
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new VideoRejectedError(
      "The video's length could not be read; export it again and add it",
    )
  }
  if (seconds > MAX_VIDEO_SECONDS + DURATION_GRACE_SECONDS) {
    throw new VideoRejectedError(
      `The video is longer than ${MAX_VIDEO_SECONDS} seconds`,
    )
  }
  return { pictureIndex: picture.index, seconds }
}

async function convert(tools: VideoTools, args: string[]): Promise<void> {
  try {
    await run(
      tools.ffmpegPath,
      ['-nostdin', '-y', '-v', 'error', ...args],
      CONVERT_TIMEOUT_MS,
    )
  } catch (error) {
    if (fileWasTheProblem(error)) {
      throw new VideoRejectedError(COULD_NOT_CONVERT)
    }
    throw error
  }
}

/**
 * Checks an uploaded video and converts it. Throws VideoRejectedError when
 * the file cannot be used, and any other error when the worker itself has a
 * problem, so the job is retried.
 */
export async function prepareProductVideo(
  tools: VideoTools,
  original: Buffer,
): Promise<PreparedVideo> {
  const folder = await mkdtemp(join(tmpdir(), 'ecokart-video-'))
  try {
    const upload = join(folder, 'upload')
    const video = join(folder, 'video.mp4')
    const poster = join(folder, 'poster.jpg')
    await writeFile(upload, original)

    const { pictureIndex, seconds } = checkUpload(
      await probe(tools, upload, NOT_A_VIDEO),
    )
    await convert(tools, [
      ...INPUT_RESTRICTIONS,
      '-i',
      upload,
      '-map',
      `0:${pictureIndex}`,
      '-map',
      '0:a:0?',
      '-t',
      String(MAX_VIDEO_SECONDS),
      '-vf',
      SCALE_TO_720P,
      '-fpsmax',
      '30',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '23',
      // Keeps a one-minute video near 20 MB for buyers on mobile data.
      '-maxrate',
      '2500k',
      '-bufsize',
      '5000k',
      '-profile:v',
      'high',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ac',
      '2',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-movflags',
      '+faststart',
      '-f',
      'mp4',
      video,
    ])
    await convert(tools, [
      '-ss',
      Math.min(1, seconds / 2).toFixed(3),
      '-i',
      video,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      '-c:v',
      'mjpeg',
      '-f',
      'image2',
      poster,
    ])

    const converted = await probe(tools, video, COULD_NOT_CONVERT)
    const picture = pictureOf(converted)
    const durationMs = Math.round(Number(converted.format.duration) * 1000)
    if (!picture?.width || !picture.height || !(durationMs > 0)) {
      throw new VideoRejectedError(COULD_NOT_CONVERT)
    }
    return {
      video: await readFile(video),
      poster: await readFile(poster),
      width: picture.width,
      height: picture.height,
      durationMs,
    }
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

/**
 * Fails when ffmpeg or ffprobe cannot run, or ffmpeg lacks the H.264 or AAC
 * encoder, so a worker image without them stops at start-up instead of
 * failing every video.
 */
export async function checkVideoTools(tools: VideoTools): Promise<void> {
  return checkVideoToolsWith(tools, run)
}

type ProgramRunner = typeof run

/** The injectable runner keeps the tool-capability check portable in tests. */
export async function checkVideoToolsWith(
  tools: VideoTools,
  runProgram: ProgramRunner,
): Promise<void> {
  const tryRun = async (name: string, path: string, setting: string) => {
    try {
      return await runProgram(
        path,
        ['-hide_banner', '-version'],
        PROBE_TIMEOUT_MS,
      )
    } catch (error) {
      throw new Error(
        `${name} cannot run from "${path}". Install ffmpeg, or set ${setting} to where ${name} is.`,
        { cause: error },
      )
    }
  }
  await tryRun('ffprobe', tools.ffprobePath, 'FFPROBE_PATH')
  await tryRun('ffmpeg', tools.ffmpegPath, 'FFMPEG_PATH')
  const encoders = await runProgram(
    tools.ffmpegPath,
    ['-hide_banner', '-encoders'],
    PROBE_TIMEOUT_MS,
  )
  for (const encoder of ['libx264', 'aac']) {
    // Lines look like " V....D libx264   libx264 H.264 / AVC ...".
    if (!new RegExp(`^\\s*\\S+\\s+${encoder}\\s`, 'm').test(encoders)) {
      throw new Error(
        `The ffmpeg at "${tools.ffmpegPath}" has no ${encoder} encoder; install a build that has it.`,
      )
    }
  }
}
