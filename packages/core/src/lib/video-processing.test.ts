import { describe, expect, test } from 'vitest'
import {
  checkVideoTools,
  checkVideoToolsWith,
  loadVideoTools,
} from './video-processing.ts'

describe('loadVideoTools', () => {
  test('finds ffmpeg and ffprobe on the PATH unless told where they are', () => {
    expect(loadVideoTools({})).toEqual({
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
    })
    expect(
      loadVideoTools({
        FFMPEG_PATH: '/usr/bin/ffmpeg',
        FFPROBE_PATH: '/usr/bin/ffprobe',
      }),
    ).toEqual({
      ffmpegPath: '/usr/bin/ffmpeg',
      ffprobePath: '/usr/bin/ffprobe',
    })
    expect(() => loadVideoTools({ FFMPEG_PATH: '' })).toThrow(
      'FFMPEG_PATH must not be empty',
    )
  })
})

describe('checkVideoTools', () => {
  test('passes with the installed ffmpeg', async () => {
    await expect(checkVideoTools(loadVideoTools())).resolves.toBeUndefined()
  })

  test('says what to set when a program is missing', async () => {
    await expect(
      checkVideoTools({ ...loadVideoTools(), ffprobePath: '/nowhere/ffprobe' }),
    ).rejects.toThrow(
      'ffprobe cannot run from "/nowhere/ffprobe". Install ffmpeg, or set FFPROBE_PATH to where ffprobe is.',
    )
  })

  test('refuses an ffmpeg without the H.264 encoder', async () => {
    const fake = '/fake/ffmpeg'
    await expect(
      checkVideoToolsWith(
        { ...loadVideoTools(), ffmpegPath: fake },
        async () => 'ffmpeg version 0',
      ),
    ).rejects.toThrow(`The ffmpeg at "${fake}" has no libx264 encoder`)
  })
})
