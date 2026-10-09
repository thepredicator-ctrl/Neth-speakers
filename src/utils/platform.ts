/*
 * Platform detection helpers.
 *
 * iPadOS 13+ reports a desktop-class Mac user agent, so the only reliable
 * signal is a Mac platform string combined with multi-touch support. We need
 * this because Apple's file pickers are notoriously strict: `accept="audio/*"`
 * greys out MP3 files in the Files browser on iPad/iPhone, so on those
 * platforms we omit the accept attribute entirely and validate by decoding.
 */

export function isAppleTouchPlatform(ua: string = navigator.userAgent, platform: string = (navigator as { platform?: string }).platform ?? '', maxTouchPoints: number = navigator.maxTouchPoints ?? 0): boolean {
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ masquerades as macOS: "Macintosh" UA + touch points.
  if (/Mac/i.test(platform) && maxTouchPoints > 1) return true;
  return false;
}

/** True for desktop Safari (no Chrome/Chromium/Android markers). */
export function isSafariLike(ua: string = navigator.userAgent): boolean {
  return /^((?!chrome|chromium|crios|android|fxios).)*safari\//i.test(ua);
}

/** File picker accept string for audio files on non-Apple-touch platforms.
 *  Includes explicit extensions — some browsers match UTIs/extension only. */
export const AUDIO_FILE_ACCEPT = [
  'audio/*',
  '.mp3', '.wav', '.ogg', '.oga', '.flac', '.m4a', '.aac', '.aif', '.aiff', '.opus', '.caf', '.wma',
].join(',');
