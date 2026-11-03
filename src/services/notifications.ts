/**
 * Ingestion Notification Service
 * Provides Desktop notifications (HTML5 Notification API),
 * audio completion chime (Web Audio API), and dynamic tab title flash.
 */

class NotificationService {
  private audioCtx: AudioContext | null = null;
  private originalTitle = 'Personal GitIngest';
  private titleBlinkInterval: any = null;

  constructor() {
    if (typeof document !== 'undefined') {
      this.originalTitle = document.title || 'Personal GitIngest';
      window.addEventListener('focus', () => {
        this.clearTitleBlink();
      });
    }
  }

  /**
   * Request desktop notification permission from user.
   */
  async requestPermission(): Promise<NotificationPermission | 'unsupported'> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    if (Notification.permission === 'default') {
      try {
        return await Notification.requestPermission();
      } catch {
        return Notification.permission;
      }
    }
    return Notification.permission;
  }

  /**
   * Play a clean, pleasant completion chime using Web Audio API.
   * No external sound files or asset downloads required.
   */
  playChime(): void {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.audioCtx || this.audioCtx.state === 'closed') {
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const now = this.audioCtx.currentTime;

      // Note 1: E5 (659.25 Hz)
      const osc1 = this.audioCtx.createOscillator();
      const gain1 = this.audioCtx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.12, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc1.connect(gain1);
      gain1.connect(this.audioCtx.destination);
      osc1.start(now);
      osc1.stop(now + 0.35);

      // Note 2: B5 (987.77 Hz) slightly delayed for a pleasant chime
      const osc2 = this.audioCtx.createOscillator();
      const gain2 = this.audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(987.77, now + 0.12);
      gain2.gain.setValueAtTime(0.15, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc2.connect(gain2);
      gain2.connect(this.audioCtx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.6);
    } catch {
      // Audio autoplay policy may prevent sound if user has not interacted yet
    }
  }

  /**
   * Flash document tab title until the user returns to the tab.
   */
  flashTabTitle(repoName: string): void {
    if (typeof document === 'undefined') return;
    this.clearTitleBlink();

    if (document.hasFocus()) return;

    let isAlert = true;
    const alertTitle = `🔔 Ready: ${repoName}`;
    document.title = alertTitle;

    this.titleBlinkInterval = setInterval(() => {
      document.title = isAlert ? alertTitle : this.originalTitle;
      isAlert = !isAlert;
    }, 1200);
  }

  clearTitleBlink(): void {
    if (this.titleBlinkInterval) {
      clearInterval(this.titleBlinkInterval);
      this.titleBlinkInterval = null;
    }
    if (typeof document !== 'undefined') {
      document.title = this.originalTitle;
    }
  }

  /**
   * Send notification:
   * - Audio chime: always plays to indicate completion
   * - Desktop notification & tab title flash: ONLY sent if the user is in another tab or minimized
   */
  notifyIngestionDone(repoName: string, filesAnalyzed: number, durationSeconds?: number): void {
    // 1. Audio chime
    this.playChime();

    const isUserActiveInTab = typeof document !== 'undefined' && document.hasFocus() && document.visibilityState === 'visible';

    // If user is actively looking at this tab, they see the result immediately — do not spam with OS notifications
    if (isUserActiveInTab) {
      return;
    }

    // 2. Tab title flash (only if user is not in tab)
    this.flashTabTitle(repoName);

    // 3. Desktop Notification (only if user is not in tab)
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const timeStr = durationSeconds ? ` in ${durationSeconds.toFixed(1)}s` : '';
        const notification = new Notification('GitIngest Complete!', {
          body: `${repoName} (${filesAnalyzed} files) digested successfully${timeStr}.`,
          icon: '/static/favicons/favicon.svg',
          badge: '/static/favicons/favicon.svg',
          tag: `gitingest_${repoName}`,
        });

        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      } catch {
        // Fallback if Notification constructor fails in some browser contexts
      }
    }
  }
}

export const notifier = new NotificationService();
