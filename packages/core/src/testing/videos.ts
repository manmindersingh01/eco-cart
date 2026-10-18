import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { loadVideoTools } from '../lib/video-processing.ts'

const execFileAsync = promisify(execFile)

export interface TestVideoOptions {
  width?: number
  height?: number
  seconds?: number
  framesPerSecond?: number
  /** mp4 and mov hold H.264, webm holds VP8. */
  format?: 'mp4' | 'mov' | 'webm'
  /** Adds a tone, as a phone recording has sound. */
  sound?: boolean
}

/**
 * A short video made from ffmpeg's built-in test pattern, so tests need no
 * video files in the repository.
 */
export async function createTestVideo({
  width = 640,
  height = 360,
  seconds = 1,
  framesPerSecond = 25,
  format = 'mp4',
  sound = false,
}: TestVideoOptions = {}): Promise<Buffer<ArrayBuffer>> {
  const folder = await mkdtemp(join(tmpdir(), 'ecokart-test-video-'))
  try {
    const output = join(folder, `video.${format}`)
    await execFileAsync(loadVideoTools().ffmpegPath, [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=${width}x${height}:rate=${framesPerSecond}:duration=${seconds}`,
      ...(sound
        ? ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`]
        : []),
      ...(format === 'webm'
        ? ['-c:v', 'libvpx', '-b:v', '300k']
        : ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']),
      ...(sound ? ['-c:a', format === 'webm' ? 'libopus' : 'aac'] : []),
      output,
    ])
    return await readFile(output)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

/** Only sound, which is not a product video. */
export async function createTestSound(
  seconds = 1,
): Promise<Buffer<ArrayBuffer>> {
  const folder = await mkdtemp(join(tmpdir(), 'ecokart-test-sound-'))
  try {
    const output = join(folder, 'sound.mp4')
    await execFileAsync(loadVideoTools().ffmpegPath, [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${seconds}`,
      '-c:a',
      'aac',
      output,
    ])
    return await readFile(output)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}
