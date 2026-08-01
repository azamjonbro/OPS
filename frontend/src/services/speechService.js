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
    this.lang = options.lang || 'en-US';
    this.status = VOICE_STATUS.LISTENING;
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onError = options.onError || (() => {});
  }

  setLanguage(newLang) {
    this.lang = newLang;
    if (this.speechRecognition) {
      try {
        this.speechRecognition.lang = newLang;
      } catch (e) {}
    }
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
      this.shouldBeListening = true;
      this.speechRecognition = new SpeechRecognitionClass();
      this.speechRecognition.continuous = true;
      this.speechRecognition.interimResults = true;
      this.speechRecognition.lang = this.lang || 'en-US';

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
          let text = result[0].transcript || '';

          if (result.isFinal) {
            if (text.trim()) {
              this.buffer.commitFinal(text.trim());
            }
          } else {
            interim += text;
          }
        }

        if (interim.trim()) {
          this.buffer.updatePartial(interim.trim());
        }
      };

      this.speechRecognition.onerror = (e) => {
        console.warn('Speech recognition notice:', e.error);

        // Permission was refused (or the tab lost mic access) — retrying in another
        // language cannot help and would loop forever, so stop and surface it.
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          this.shouldBeListening = false;
          this.onError('Mikrofonga ruxsat berilmadi. Brauzer sozlamalaridan ruxsat bering.');
          return;
        }

        // Uzbek is not in every browser's speech model; fall back once so dictation
        // still works instead of silently producing nothing.
        if (e.error === 'language-not-supported') {
          const fallbackLang = this.lang && this.lang.startsWith('uz') ? 'ru-RU' : 'en-US';
          this.lang = fallbackLang;
          try {
            this.speechRecognition.lang = fallbackLang;
          } catch (err) {}
          this.onError(`"${this.lang}" tili qo'llab-quvvatlanmadi, ${fallbackLang} ga o'tildi.`);
        }
      };

      this.speechRecognition.onend = () => {
        this.isListening = false;
        if (this.shouldBeListening) {
          setTimeout(() => {
            try {
              if (this.shouldBeListening) {
                this.start();
              }
            } catch (err) {}
          }, 150);
        }
      };

      this.speechRecognition.start();
    } catch (e) {
      console.warn('SpeechRecognition start notice:', e);
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
    this.shouldBeListening = false;
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
