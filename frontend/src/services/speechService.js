/**
 * Production SpeechService Engine
 * Features:
 * - Continuous Web Speech API streaming transcription
 * - Intelligent Voice Statuses: LISTENING, HEARING_VOICE, PROCESSING_SPEECH, PAUSED
 * - Auto-restart on speech service idle while recording
 * - Full cleanup on destroy
 */

export const VOICE_STATUS = {
  LISTENING: '🎤 Listening...',
  HEARING_VOICE: '🗣️ Hearing you...',
  PROCESSING_SPEECH: '🧠 Processing speech...',
  PAUSED: '⏸ Recording paused',
  READY_TO_SEND: '✓ Ready to send'
};

export class SpeechService {
  constructor(transcriptBuffer, options = {}) {
    this.buffer = transcriptBuffer;
    this.options = options;
    this.speechRecognition = null;
    this.isListening = false;
    this.status = VOICE_STATUS.LISTENING;
    this.onStatusChange = options.onStatusChange || (() => {});
  }

  setStatus(newStatus) {
    if (this.status === newStatus) return;
    this.status = newStatus;
    this.onStatusChange(this.status);
  }

  start() {
    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      console.warn('SpeechRecognition API not available in this browser environment');
      return;
    }

    try {
      this.speechRecognition = new SpeechRecognitionClass();
      this.speechRecognition.continuous = true;
      this.speechRecognition.interimResults = true;
      // Multi-Language Support: Prefer uz-UZ for Uzbek spoken voice inputs
      this.speechRecognition.lang = 'uz-UZ';

      this.speechRecognition.onstart = () => {
        this.isListening = true;
        this.setStatus(VOICE_STATUS.LISTENING);
      };

      this.speechRecognition.onspeechstart = () => {
        this.setStatus(VOICE_STATUS.HEARING_VOICE);
      };

      this.speechRecognition.onspeechend = () => {
        this.setStatus(VOICE_STATUS.PROCESSING_SPEECH);
      };

      this.speechRecognition.onresult = (event) => {
        this.setStatus(VOICE_STATUS.HEARING_VOICE);
        let interim = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          if (result.isFinal) {
            this.buffer.commitFinal(result[0].transcript);
          } else {
            interim += result[0].transcript;
          }
        }

        if (interim) {
          this.buffer.updatePartial(interim);
        }
      };

      this.speechRecognition.onerror = (e) => {
        if (e.error === 'language-not-supported' || e.error === 'no-speech') {
          // Fallback to en-US if uz-UZ speech model not installed on device
          try {
            this.speechRecognition.lang = 'en-US';
          } catch (err) {}
        }
        console.warn('Speech recognition notice:', e.error);
      };

      this.speechRecognition.onend = () => {
        this.isListening = false;
        // Auto-restart if active
        if (this.speechRecognition && this.status !== VOICE_STATUS.PAUSED) {
          try { this.speechRecognition.start(); } catch (err) {}
        }
      };

      this.speechRecognition.start();
    } catch (err) {
      console.warn('Speech recognition init error:', err);
    }
  }

  pause() {
    this.setStatus(VOICE_STATUS.PAUSED);
    this.stop();
  }

  resume() {
    this.start();
  }

  stop() {
    if (this.speechRecognition) {
      try {
        this.speechRecognition.onend = null;
        this.speechRecognition.stop();
      } catch (e) {}
      this.speechRecognition = null;
    }
    this.isListening = false;
  }
}
