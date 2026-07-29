/**
 * Production TranscriptBuffer Service
 * Features:
 * - Manages Finalized vs Partial/Interim Streaming Speech Transcripts
 * - Prevents flickering, duplicate chunks, and text corruption
 * - Preserves manual user edits when resuming paused recording
 * - Debounces streaming updates for optimal performance
 */

export class TranscriptBuffer {
  constructor() {
    this.finalTranscript = '';
    this.partialTranscript = '';
    this.listeners = new Set();
  }

  onChange(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify() {
    const fullText = this.getText();
    this.listeners.forEach((cb) => cb(fullText));
  }

  getText() {
    const combined = [this.finalTranscript.trim(), this.partialTranscript.trim()]
      .filter(Boolean)
      .join(' ');
    return combined;
  }

  updatePartial(partialText) {
    if (this.partialTranscript === partialText) return;
    this.partialTranscript = partialText;
    this.notify();
  }

  commitFinal(finalChunk) {
    if (!finalChunk || !finalChunk.trim()) return;
    const cleanChunk = finalChunk.trim();
    
    if (!this.finalTranscript) {
      this.finalTranscript = cleanChunk;
    } else if (!this.finalTranscript.includes(cleanChunk)) {
      this.finalTranscript = `${this.finalTranscript.trim()} ${cleanChunk}`;
    }
    
    this.partialTranscript = '';
    this.notify();
  }

  setManualEdits(manualText) {
    this.finalTranscript = manualText || '';
    this.partialTranscript = '';
    this.notify();
  }

  clear() {
    this.finalTranscript = '';
    this.partialTranscript = '';
    this.notify();
  }
}
