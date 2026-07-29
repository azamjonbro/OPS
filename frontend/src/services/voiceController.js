import { TranscriptBuffer } from './transcriptBuffer';
import { SpeechService, VOICE_STATUS } from './speechService';

export const RECORDING_STATE = {
  IDLE: 'IDLE',
  RECORDING: 'RECORDING',
  PAUSED: 'PAUSED',
  STOPPED: 'STOPPED',
  SENT: 'SENT'
};

export class VoiceController {
  constructor(options = {}) {
    this.state = RECORDING_STATE.IDLE;
    this.options = options;

    // Services
    this.transcriptBuffer = new TranscriptBuffer();
    this.speechService = new SpeechService(this.transcriptBuffer, {
      onStatusChange: (status) => {
        this.onVoiceStatusUpdate(status);
      }
    });

    // Web Audio API
    this.mediaStream = null;
    this.audioContext = null;
    this.analyserNode = null;
    this.animationFrameId = null;

    // Timer
    this.seconds = 0;
    this.timerInterval = null;

    // Frequency Bars (25 bars)
    this.frequencyBars = new Array(25).fill(12);

    // Callbacks
    this.onStateChange = options.onStateChange || (() => {});
    this.onTranscriptUpdate = options.onTranscriptUpdate || (() => {});
    this.onFrequencyUpdate = options.onFrequencyUpdate || (() => {});
    this.onTimerUpdate = options.onTimerUpdate || (() => {});
    this.onVoiceStatusUpdate = options.onVoiceStatusUpdate || (() => {});
    this.onError = options.onError || (() => {});

    // Listen to transcript changes
    this.unsubscribeTranscript = this.transcriptBuffer.onChange((fullText) => {
      this.onTranscriptUpdate(fullText);
    });
  }

  setState(newState) {
    if (this.state === newState) return;
    this.state = newState;
    this.onStateChange(this.state);
  }

  async start() {
    if (this.state !== RECORDING_STATE.IDLE && this.state !== RECORDING_STATE.STOPPED) {
      return;
    }

    try {
      this.transcriptBuffer.clear();
      this.seconds = 0;

      await this._initMediaStream();
      this.speechService.start();
      this._startTimer();

      this.setState(RECORDING_STATE.RECORDING);
      this.onVoiceStatusUpdate(VOICE_STATUS.LISTENING);
    } catch (err) {
      this.onError(err.message || 'Microphone access denied');
      this.cancel();
    }
  }

  pause() {
    if (this.state !== RECORDING_STATE.RECORDING) return;

    this.setState(RECORDING_STATE.PAUSED);
    this._pauseTimer();
    this.speechService.pause();
    this.onVoiceStatusUpdate(VOICE_STATUS.PAUSED);
  }

  async resume(currentEditedText = '') {
    if (this.state !== RECORDING_STATE.PAUSED) return;

    if (currentEditedText !== undefined) {
      this.transcriptBuffer.setManualEdits(currentEditedText);
    }

    try {
      if (!this.mediaStream || !this.mediaStream.active) {
        await this._initMediaStream();
      }
      this.speechService.resume();
      this._startTimer();

      this.setState(RECORDING_STATE.RECORDING);
      this.onVoiceStatusUpdate(VOICE_STATUS.LISTENING);
    } catch (err) {
      this.onError('Failed to resume recording stream');
    }
  }

  finish() {
    if (this.state !== RECORDING_STATE.RECORDING && this.state !== RECORDING_STATE.PAUSED) return;

    this.setState(RECORDING_STATE.STOPPED);
    this._pauseTimer();
    this.speechService.stop();
    this._stopAudioContext();
    this.onVoiceStatusUpdate(VOICE_STATUS.READY_TO_SEND);
  }

  cancel() {
    this._pauseTimer();
    this.speechService.stop();
    this._destroyMediaStream();
    this._stopAudioContext();

    this.seconds = 0;
    this.transcriptBuffer.clear();
    this.frequencyBars = new Array(25).fill(12);

    this.onTimerUpdate(0);
    this.onFrequencyUpdate(this.frequencyBars);
    this.onVoiceStatusUpdate('');

    this.setState(RECORDING_STATE.IDLE);
  }

  // --- INTERNAL AUDIO STREAM ENGINE ---
  async _initMediaStream() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Microphone not supported in this browser');
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Web Audio API
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      this.audioContext = new AudioContextClass();
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 64;
      source.connect(this.analyserNode);

      this._renderWaveformLoop();
    }
  }

  _renderWaveformLoop() {
    if (!this.analyserNode || (this.state !== RECORDING_STATE.RECORDING && this.state !== RECORDING_STATE.IDLE)) {
      if (this.state === RECORDING_STATE.PAUSED || this.state === RECORDING_STATE.STOPPED) {
        return;
      }
    }

    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(dataArray);

    const bars = [];
    for (let i = 0; i < 25; i++) {
      const val = dataArray[i % dataArray.length] || 0;
      bars.push(Math.max(6, Math.min(56, Math.floor(val / 4.2))));
    }
    this.frequencyBars = bars;
    this.onFrequencyUpdate(this.frequencyBars);

    if (this.state === RECORDING_STATE.RECORDING) {
      this.animationFrameId = requestAnimationFrame(() => this._renderWaveformLoop());
    }
  }

  _startTimer() {
    this._pauseTimer();
    this.timerInterval = setInterval(() => {
      if (this.state === RECORDING_STATE.RECORDING) {
        this.seconds++;
        this.onTimerUpdate(this.seconds);
      }
    }, 1000);
  }

  _pauseTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  _stopAudioContext() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.audioContext) {
      try { this.audioContext.close(); } catch (e) {}
      this.audioContext = null;
    }
  }

  _destroyMediaStream() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    if (this.unsubscribeTranscript) {
      this.unsubscribeTranscript();
    }
  }
}
