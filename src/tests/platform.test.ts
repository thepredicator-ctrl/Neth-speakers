import { describe, it, expect } from 'vitest';
import { isAppleTouchPlatform, isSafariLike } from '../utils/platform';

const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
// iPadOS 13+ desktop-mode UA masquerades as macOS Safari.
const IPADOS_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const MAC_SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const IOS_CHROME_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1';

describe('isAppleTouchPlatform', () => {
  it('detects iPad and iPhone user agents', () => {
    expect(isAppleTouchPlatform(IPAD_UA, 'iPad', 5)).toBe(true);
    expect(isAppleTouchPlatform(IPHONE_UA, 'iPhone', 5)).toBe(true);
  });

  it('detects iPadOS 13+ desktop-mode (Mac platform + multi-touch)', () => {
    expect(isAppleTouchPlatform(IPADOS_DESKTOP_UA, 'MacIntel', 5)).toBe(true);
  });

  it('rejects desktop Mac (no touch) and desktop Windows', () => {
    expect(isAppleTouchPlatform(MAC_SAFARI_UA, 'MacIntel', 0)).toBe(false);
    expect(isAppleTouchPlatform(CHROME_UA, 'Win32', 0)).toBe(false);
  });
});

describe('isSafariLike', () => {
  it('detects desktop Safari', () => {
    expect(isSafariLike(MAC_SAFARI_UA)).toBe(true);
  });

  it('rejects Chrome on desktop and iOS (CriOS)', () => {
    expect(isSafariLike(CHROME_UA)).toBe(false);
    expect(isSafariLike(IOS_CHROME_UA)).toBe(false);
  });
});
