/*
 * Product video formats and limits, shared by the web app (upload limits,
 * video addresses) and the worker (lib/video-processing.ts), which is the
 * only code that runs ffmpeg.
 */

/** The upload types sellers may send, as browsers name them. */
export const VIDEO_CONTENT_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
] as const
export type VideoContentType = (typeof VIDEO_CONTENT_TYPES)[number]

export const MAX_VIDEO_UPLOAD_BYTES = 50 * 1024 * 1024
export const MAX_VIDEO_SECONDS = 60

/** The public address key of the video file stored at `storageKey`. */
export const videoFileKey = (storageKey: string) => `${storageKey}/video.mp4`
/** The public address key of the still image shown before the video plays. */
export const videoPosterKey = (storageKey: string) => `${storageKey}/poster.jpg`
