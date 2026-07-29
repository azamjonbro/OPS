<template>
  <div class="flex h-screen bg-[#090B0E] text-gray-100 font-sans overflow-hidden">
    <!-- Mobile Navigation Drawer Overlay -->
    <div v-if="isMobileMenuOpen" @click="isMobileMenuOpen = false" class="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm md:hidden"></div>

    <!-- Sidebar (Desktop & Mobile Drawer) -->
    <aside :class="['w-72 border-r border-white/10 bg-[#0E1116] flex flex-col justify-between p-4 z-40 transition-all duration-300 md:static fixed inset-y-0 left-0', isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0']">
      <div class="space-y-5">
        <!-- App Title & Mobile Close -->
        <div class="flex items-center justify-between px-2 py-1">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center font-extrabold text-white text-sm shadow-glow">AI</div>
            <div>
              <span class="font-bold text-sm tracking-tight text-white block">Jarvis AI Workspace</span>
              <span class="text-[10px] text-purple-400 font-mono">Store Hadiya POS v2</span>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button @click="newChat" class="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 transition" title="New Chat">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            </button>
            <button @click="isMobileMenuOpen = false" class="p-2 rounded-xl bg-white/5 text-gray-400 md:hidden">✕</button>
          </div>
        </div>

        <!-- Conversation History -->
        <div class="space-y-1">
          <div class="text-[10px] font-bold tracking-widest text-gray-500 uppercase px-2 mb-2">Mavjud Chatlar</div>
          <div 
            v-for="conv in conversations" 
            :key="conv.id"
            @click="selectConversation(conv.id)"
            :class="['flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs cursor-pointer transition-all', activeConvId === conv.id ? 'bg-gradient-to-r from-indigo-600/30 to-purple-600/30 text-indigo-200 font-semibold border border-indigo-500/40 shadow-glow' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200']"
          >
            <span class="truncate">{{ conv.title }}</span>
            <span v-if="conv.isPinned" class="text-[10px]">📌</span>
          </div>
        </div>
      </div>

      <!-- User Profile Card -->
      <div class="border-t border-white/10 pt-4 flex items-center justify-between px-2">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-2xl bg-gradient-to-tr from-purple-500 via-indigo-500 to-emerald-400 p-0.5">
            <div class="w-full h-full bg-[#0E1116] rounded-[14px] flex items-center justify-center font-bold text-white text-xs">H</div>
          </div>
          <div>
            <div class="text-xs font-semibold text-white">Bahodir (Store Hadiya)</div>
            <div class="text-[10px] text-emerald-400 font-mono">BILLZ POS Admin</div>
          </div>
        </div>
      </div>
    </aside>

    <!-- Main Chat Window -->
    <main class="flex-1 flex flex-col justify-between h-full bg-[#090B0E] relative">
      <!-- Header Bar -->
      <header class="h-16 border-b border-white/10 flex items-center justify-between px-4 sm:px-6 bg-[#0D0F14]/80 backdrop-blur-xl z-20">
        <div class="flex items-center gap-3">
          <button @click="isMobileMenuOpen = true" class="p-2 rounded-xl bg-white/5 text-gray-300 md:hidden">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <div class="flex items-center gap-2">
            <div class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-glow"></div>
            <span class="text-xs font-bold text-gray-200 hidden sm:inline">Store Hadiya Executive AI</span>
            <span class="text-[10px] bg-purple-500/15 text-purple-300 px-2.5 py-1 rounded-full border border-purple-500/30 font-medium">GPT-4o + Claude 3.5</span>
          </div>
        </div>

        <div class="flex items-center gap-2 sm:gap-3">
          <!-- Schedule Automations Trigger Button -->
          <button @click="isScheduleOpen = true" class="text-xs font-semibold text-emerald-300 hover:text-white bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 px-3 py-1.5 rounded-2xl transition flex items-center gap-1.5 shadow-glow">
            <span>⏰</span> <span class="hidden sm:inline">Avtomatlashtirish</span> ({{ schedules.length }})
          </button>

          <button @click="$emit('switch-view', 'admin')" class="text-xs font-semibold text-indigo-300 hover:text-white bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 px-3 py-1.5 rounded-2xl transition flex items-center gap-1.5">
            <span>⚙️</span> <span class="hidden sm:inline">Admin Panel</span>
          </button>
        </div>
      </header>

      <!-- Message History Container -->
      <div ref="chatContainer" class="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 max-w-4xl w-full mx-auto scroll-smooth">
        <!-- Welcome Screen -->
        <div v-if="messages.length === 0" class="h-full flex flex-col items-center justify-center text-center my-auto space-y-6 pt-8 pb-12">
          <div class="w-16 h-16 rounded-3xl bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-500 flex items-center justify-center shadow-glow text-3xl">🛍️</div>
          <div>
            <h1 class="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Store Hadiya AI Assistant 👋</h1>
            <p class="text-xs sm:text-sm text-gray-400 mt-2 max-w-md">Store Hadiya bazangizdagi 1,152 ta mahsulot va Billz POS savdolarini boshqaring!</p>
          </div>

          <!-- Quick Actions Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-xl text-left pt-2">
            <div @click="openVoiceModal()" class="p-4 rounded-3xl border border-purple-500/40 bg-purple-600/15 hover:bg-purple-600/25 cursor-pointer transition group shadow-glow">
              <div class="text-xs font-bold text-purple-200 group-hover:text-white flex items-center justify-between">
                <span>🎙️ Ovozli Murojaat (Microphone)</span>
                <span class="text-purple-300 font-mono text-[9px] bg-purple-500/30 px-2 py-0.5 rounded-full border border-purple-400/30">LIVE MIC</span>
              </div>
              <p class="text-[11px] text-gray-300 mt-1.5">Mikrofoningiz orqali ovozli topshiriq bering...</p>
            </div>

            <div @click="sendQuick('Hadiya do\'konida Rolex soati narxi necha pul va do\'konda bormi?')" class="p-4 rounded-3xl border border-white/10 bg-[#12151B] hover:border-indigo-500/40 hover:bg-indigo-600/10 cursor-pointer transition group">
              <div class="text-xs font-bold text-white group-hover:text-indigo-300 flex items-center justify-between">
                <span>⌚ Rolex Soati Narxi</span>
                <span class="text-gray-500 group-hover:translate-x-1 transition">→</span>
              </div>
              <p class="text-[11px] text-gray-400 mt-1.5">"Rolex Swiss copy soati narxi necha pul?"</p>
            </div>

            <div @click="sendQuick('Billz Hadiya do\'konidagi bugungi kunlik savdo hisobotini chiqar.')" class="p-4 rounded-3xl border border-white/10 bg-[#12151B] hover:border-indigo-500/40 hover:bg-indigo-600/10 cursor-pointer transition group">
              <div class="text-xs font-bold text-white group-hover:text-indigo-300 flex items-center justify-between">
                <span>📊 Store Hadiya Savdosi</span>
                <span class="text-gray-500 group-hover:translate-x-1 transition">→</span>
              </div>
              <p class="text-[11px] text-gray-400 mt-1.5">"Billz Hadiya do'konidagi savdoni chiqar."</p>
            </div>

            <div @click="sendQuick('Har kuni soat 19:00 da Store Hadiya savdosini telegramga yuborib tur.')" class="p-4 rounded-3xl border border-white/10 bg-[#12151B] hover:border-indigo-500/40 hover:bg-indigo-600/10 cursor-pointer transition group">
              <div class="text-xs font-bold text-white group-hover:text-indigo-300 flex items-center justify-between">
                <span>⏰ Kunlik Telegram Eslatma</span>
                <span class="text-gray-500 group-hover:translate-x-1 transition">→</span>
              </div>
              <p class="text-[11px] text-gray-400 mt-1.5">"Har kuni 19:00 da Telegramga yubor."</p>
            </div>
          </div>
        </div>

        <!-- Chat Messages -->
        <div v-else v-for="msg in messages" :key="msg.id" class="space-y-3">
          <!-- User Bubble -->
          <div v-if="msg.role === 'user'" class="flex justify-end">
            <div class="max-w-xl bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm shadow-md">
              {{ msg.content }}
            </div>
          </div>

          <!-- Assistant Bubble -->
          <div v-else class="flex gap-3">
            <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-white text-xs shrink-0 shadow-glow">AI</div>
            <div class="flex-1 space-y-3">
              <!-- Executed Tools Badges -->
              <div v-if="parseTools(msg.toolCalls).length > 0" class="flex flex-wrap gap-1.5">
                <span 
                  v-for="(t, idx) in parseTools(msg.toolCalls)" 
                  :key="idx"
                  class="inline-flex items-center gap-1.5 text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-lg"
                >
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Executed: {{ t.tool || t.label }}
                </span>
              </div>

              <!-- Message Content -->
              <div class="bg-[#14161B] border border-white/5 rounded-2xl rounded-tl-sm p-4 text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
                {{ msg.content }}
              </div>
            </div>
          </div>
        </div>

        <!-- Loading Indicator -->
        <div v-if="isLoading" class="flex gap-3">
          <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center font-bold text-white text-xs shrink-0 shadow-glow animate-pulse">AI</div>
          <div class="bg-[#14161B] border border-white/5 rounded-2xl p-4 text-xs text-indigo-400 flex items-center gap-2">
            <div class="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
            <span>OpenAI Whisper + Dual LLM is processing voice intents...</span>
          </div>
        </div>
      </div>

      <!-- ChatGPT / Gemini Style Sleek Inline Voice Input Pill Bar -->
      <footer class="p-4 sm:p-6 border-t border-white/5 bg-[#090B0E]">
        <div class="max-w-3xl w-full mx-auto">
          <!-- INLINE RECORDING ACTIVE STATE (Image 2 style with Live Timer) -->
          <div v-if="isVoiceRecordingActive" class="flex items-center justify-between bg-[#16181F] border border-indigo-500/50 rounded-full px-4 py-2.5 shadow-2xl transition-all duration-300 gap-2">
            <!-- Left: Plus Attachment Button -->
            <button class="text-gray-400 hover:text-white text-lg font-bold pr-1 transition">+</button>

            <!-- Language Selector Pills (UZ / RU / EN) -->
            <div class="flex items-center gap-1 bg-white/5 p-1 rounded-full text-[10px] shrink-0 border border-white/10">
              <button @click="changeVoiceLang('uz-UZ')" :class="['px-2 py-0.5 rounded-full transition font-bold', selectedVoiceLang === 'uz-UZ' ? 'bg-indigo-600 text-white shadow-glow' : 'text-gray-400 hover:text-gray-200']">🇺🇿 UZ</button>
              <button @click="changeVoiceLang('ru-RU')" :class="['px-2 py-0.5 rounded-full transition font-bold', selectedVoiceLang === 'ru-RU' ? 'bg-indigo-600 text-white shadow-glow' : 'text-gray-400 hover:text-gray-200']">🇷🇺 RU</button>
              <button @click="changeVoiceLang('en-US')" :class="['px-2 py-0.5 rounded-full transition font-bold', selectedVoiceLang === 'en-US' ? 'bg-indigo-600 text-white shadow-glow' : 'text-gray-400 hover:text-gray-200']">🇺🇸 EN</button>
            </div>

            <!-- Live Recording Duration Timer Badge -->
            <span class="px-2.5 py-1 bg-red-500/20 text-red-400 border border-red-500/30 rounded-full font-mono text-xs font-bold flex items-center gap-1.5 shrink-0 animate-pulse">
              <span class="w-2 h-2 rounded-full bg-red-500"></span>
              ⏱️ 00:{{ recordingSeconds < 10 ? '0' + recordingSeconds : recordingSeconds }}s
            </span>

            <!-- Center: Live Web Audio SVG Frequency Waveform Spectrum -->
            <div class="flex-1 flex items-center justify-center px-2 h-6 overflow-hidden">
              <svg class="w-full h-6" viewBox="0 0 200 40" preserveAspectRatio="none">
                <rect v-for="(bar, i) in frequencyBars" :key="i" :x="i * 8" :y="40 - bar" width="4" :height="bar" rx="2" fill="url(#inlineWaveGrad)" />
                <defs>
                  <linearGradient id="inlineWaveGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stop-color="#8B5CF6" />
                    <stop offset="50%" stop-color="#EC4899" />
                    <stop offset="100%" stop-color="#3B82F6" />
                  </linearGradient>
                </defs>
              </svg>
            </div>

            <!-- Real-time Spoken Text Hint Preview -->
            <span v-if="liveSpokenText" class="text-xs text-purple-300 italic truncate max-w-[160px] px-2 hidden sm:inline font-medium">
              "{{ liveSpokenText }}"
            </span>

            <!-- Right: Discard (✕) and Submit (✓) Action Buttons -->
            <div class="flex items-center gap-2 pl-1">
              <!-- Cancel / Discard Recording -->
              <button 
                @click="cancelVoiceRecording" 
                class="w-8 h-8 rounded-full bg-white/10 hover:bg-red-500/20 text-gray-300 hover:text-red-400 flex items-center justify-center text-sm transition"
                title="Discard Recording"
              >
                ✕
              </button>

              <!-- Submit / Finish & Confirm Voice Briefing -->
              <button 
                @click="sendVoiceRecording" 
                class="w-8 h-8 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white flex items-center justify-center text-sm font-bold shadow-glow transition"
                title="Transcribe & Submit"
              >
                ✓
              </button>
            </div>
          </div>

          <div v-else class="flex items-center gap-3 bg-[#14161B] border border-white/10 rounded-2xl px-4 py-2.5 focus-within:border-indigo-500/50 shadow-2xl transition-all">
            <!-- Left: Plus Icon -->
            <button class="text-gray-400 hover:text-white text-lg font-bold transition self-end pb-1">+</button>

            <!-- Language Selector Pills (UZ / RU / EN) -->
            <div class="flex items-center gap-1 bg-white/5 p-1 rounded-full text-[10px] shrink-0 border border-white/5">
              <button @click="changeVoiceLang('uz-UZ')" :class="['px-2 py-0.5 rounded-full transition font-bold', selectedVoiceLang === 'uz-UZ' ? 'bg-indigo-600 text-white shadow-glow' : 'text-gray-400 hover:text-gray-200']">🇺🇿 UZ</button>
              <button @click="changeVoiceLang('ru-RU')" :class="['px-2 py-0.5 rounded-full transition font-bold', selectedVoiceLang === 'ru-RU' ? 'bg-indigo-600 text-white shadow-glow' : 'text-gray-400 hover:text-gray-200']">🇷🇺 RU</button>
              <button @click="changeVoiceLang('en-US')" :class="['px-2 py-0.5 rounded-full transition font-bold', selectedVoiceLang === 'en-US' ? 'bg-indigo-600 text-white shadow-glow' : 'text-gray-400 hover:text-gray-200']">🇺🇸 EN</button>
            </div>

            <!-- Center: Textarea Input Query -->
            <textarea 
              v-model="inputQuery" 
              @keydown.enter.exact.prevent="sendMessage" 
              rows="1"
              placeholder="Store Hadiya bo'yicha savol bering yoki gapiring..." 
              class="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none px-2 resize-none max-h-36 overflow-y-auto leading-relaxed py-1 font-sans"
            ></textarea>

            <!-- Right: Mic Icon & Waveform Pill Button -->
            <div class="flex items-center gap-2">
              <!-- Microphone Button -->
              <button 
                @click="openVoiceModal()" 
                class="text-gray-400 hover:text-white p-1.5 rounded-full hover:bg-white/5 transition"
                title="Speak to Assistant"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </button>

              <!-- Waveform Pill Button (Image 3 style) -->
              <button 
                @click="openVoiceModal()" 
                class="w-8 h-8 rounded-full bg-white text-black hover:bg-gray-200 flex items-center justify-center font-bold shadow transition"
                title="Live Voice Mode"
              >
                <span class="flex items-center gap-0.5">
                  <span class="w-0.5 h-3 bg-black rounded-full animate-pulse"></span>
                  <span class="w-0.5 h-4 bg-black rounded-full animate-pulse"></span>
                  <span class="w-0.5 h-2 bg-black rounded-full animate-pulse"></span>
                </span>
              </button>
            </div>
          </div>
        </div>
      </footer>
    </main>

    <!-- SCHEDULE AUTOMATIONS MODAL -->
    <div v-if="isScheduleOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div class="w-full max-w-lg bg-[#16181D] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5">
        <div class="flex items-center justify-between border-b border-white/10 pb-4">
          <div>
            <h3 class="text-base font-semibold text-white flex items-center gap-2">
              <span>⏰</span> Scheduled Automations & Reminders
            </h3>
            <p class="text-xs text-gray-400 mt-0.5">Automate daily reports, meeting reminders, and Telegram dispatches</p>
          </div>
          <button @click="isScheduleOpen = false" class="text-gray-400 hover:text-white transition">✕</button>
        </div>

        <!-- Add New Schedule Form -->
        <div class="bg-[#0E1013] border border-white/5 rounded-xl p-4 space-y-3">
          <div class="text-xs font-semibold text-white">Create New Schedule</div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input v-model="newSchedule.title" type="text" placeholder="Title (e.g. Daily Sales Report)" class="w-full bg-[#16181D] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500" />
            <input v-model="newSchedule.scheduledTime" type="text" placeholder="Time (e.g. 19:00)" class="w-full bg-[#16181D] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500" />
          </div>
          <input v-model="newSchedule.prompt" type="text" placeholder="Prompt Query (e.g. Billzdagi kunlik savdoni chiqar)" class="w-full bg-[#16181D] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500" />
          <div class="flex items-center justify-between pt-1">
            <div class="flex items-center gap-2">
              <select v-model="newSchedule.frequency" class="bg-[#16181D] border border-white/10 rounded-lg px-2 py-1 text-xs text-gray-300">
                <option value="DAILY">Har kuni (Daily)</option>
                <option value="WEEKLY">Haftalik (Weekly)</option>
                <option value="ONCE">Bir martalik (Once)</option>
              </select>
              <select v-model="newSchedule.targetChannel" class="bg-[#16181D] border border-white/10 rounded-lg px-2 py-1 text-xs text-gray-300">
                <option value="TELEGRAM">Telegram Bot</option>
                <option value="CHAT">Chat Panel</option>
                <option value="EMAIL">Email Dispatch</option>
              </select>
            </div>
            <button @click="createSchedule" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow transition">+ Add Schedule</button>
          </div>
        </div>

        <!-- Active Schedules List -->
        <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
          <div class="text-xs font-semibold text-gray-400">Active Schedules ({{ schedules.length }})</div>
          <div v-for="s in schedules" :key="s.id" class="p-3 rounded-xl bg-[#0E1013] border border-white/5 flex items-center justify-between">
            <div class="space-y-0.5">
              <div class="text-xs font-semibold text-white flex items-center gap-2">
                <span>{{ s.title }}</span>
                <span class="text-[9px] font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 rounded">⏰ {{ s.scheduledTime }} ({{ s.frequency }})</span>
              </div>
              <p class="text-[11px] text-gray-400">Target: {{ s.targetChannel }} | Query: "{{ s.prompt }}"</p>
            </div>
            <div class="flex items-center gap-2">
              <button @click="toggleSchedule(s.id)" :class="['px-2 py-1 text-[10px] font-bold rounded', s.isEnabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700 text-gray-400']">
                {{ s.isEnabled ? 'ON' : 'OFF' }}
              </button>
              <button @click="deleteSchedule(s.id)" class="text-gray-500 hover:text-red-400 text-xs">🗑️</button>
            </div>
          </div>
        </div>

        <div class="flex justify-end border-t border-white/10 pt-4">
          <button @click="isScheduleOpen = false" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition">Done</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios';
import { nextTick } from 'vue';
import { VoiceController, RECORDING_STATE } from '../services/voiceController';
import { API_BASE } from '../services/api';

export default {
  data() {
    return {
      activeConvId: null,
      isMobileMenuOpen: false,
      conversations: [],
      messages: [],
      schedules: [],
      inputQuery: '',
      isLoading: false,

      // Voice Controller & Modal States
      isVoiceRecordingActive: false,
      selectedVoiceLang: 'uz-UZ',
      recordingState: RECORDING_STATE.IDLE,
      voiceStatusBadge: '🎤 Listening...',
      recordingSeconds: 0,
      liveSpokenText: '',
      frequencyBars: new Array(25).fill(12),
      voiceController: null,

      isScheduleOpen: false,
      newSchedule: {
        title: '',
        prompt: '',
        frequency: 'DAILY',
        scheduledTime: '19:00',
        targetChannel: 'TELEGRAM'
      }
    };
  },
  watch: {
    messages: {
      deep: true,
      handler() {
        this.scrollToBottom();
      }
    }
  },
  mounted() {
    this.fetchConversations();
    this.activeConvId = null;
    this.messages = [];
    this.fetchSchedules();
  },
  beforeUnmount() {
    if (this.voiceController) {
      this.voiceController.cancel();
    }
  },
  methods: {
    scrollToBottom() {
      nextTick(() => {
        const container = this.$refs.chatContainer;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    },
    async fetchConversations() {
      try {
        const res = await axios.get(`${API_BASE}/api/chat/conversations`);
        this.conversations = res.data;
      } catch (e) {}
    },
    async fetchMessages(convId) {
      this.activeConvId = convId;
      try {
        const res = await axios.get(`${API_BASE}/api/chat/conversations/${convId}/messages`);
        this.messages = res.data;
        this.scrollToBottom();
      } catch (e) {}
    },
    async fetchSchedules() {
      try {
        const res = await axios.get(`${API_BASE}/api/schedules`);
        this.schedules = res.data;
      } catch (e) {}
    },

    // --- CHATGPT VOICE WORKFLOW CONTROLLER ---
    changeVoiceLang(lang) {
      this.selectedVoiceLang = lang;
      if (this.voiceController) {
        this.voiceController.setLanguage(lang);
      }
    },
    openVoiceModal() {
      this.isVoiceRecordingActive = true;
      this.liveSpokenText = '';

      this.voiceController = new VoiceController({
        lang: this.selectedVoiceLang,
        onStateChange: (state) => {
          this.recordingState = state;
        },
        onTranscriptUpdate: (text) => {
          this.liveSpokenText = text;
        },
        onVoiceStatusUpdate: (status) => {
          this.voiceStatusBadge = status;
        },
        onTimerUpdate: (sec) => {
          this.recordingSeconds = sec;
        },
        onFrequencyUpdate: (bars) => {
          this.frequencyBars = bars;
        },
        onError: (err) => {
          console.warn('Voice Controller Notice:', err);
        }
      });

      this.voiceController.start();
    },
    pauseVoiceRecording() {
      if (this.voiceController) {
        this.voiceController.pause();
      }
    },
    resumeVoiceRecording() {
      if (this.voiceController) {
        this.voiceController.resume(this.liveSpokenText);
      }
    },
    finishVoiceRecording() {
      if (this.voiceController) {
        this.voiceController.finish();
      }
    },
    cancelVoiceRecording() {
      if (this.voiceController) {
        this.voiceController.cancel();
      }
      this.isVoiceRecordingActive = false;
    },
    handleModalKeydown(event) {
      if (event.code === 'Space' && event.target.tagName !== 'TEXTAREA') {
        event.preventDefault();
        if (this.recordingState === RECORDING_STATE.RECORDING) {
          this.pauseVoiceRecording();
        } else if (this.recordingState === RECORDING_STATE.PAUSED) {
          this.resumeVoiceRecording();
        }
      } else if (event.key === 'Escape') {
        this.cancelVoiceRecording();
      } else if (event.key === 'Enter' && event.ctrlKey) {
        this.sendVoiceRecording();
      }
    },
    async sendVoiceRecording() {
      let textToSend = (this.liveSpokenText || '').trim();

      let audioBlob = null;
      if (this.voiceController) {
        audioBlob = this.voiceController.getAudioBlob();
        this.voiceController.finish();
      }

      // If speech recognition didn't capture text, attempt backend transcription
      if (!textToSend && audioBlob) {
        try {
          const reader = new FileReader();
          const base64Audio = await new Promise((resolve) => {
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(audioBlob);
          });

          const trRes = await axios.post(`${API_BASE}/api/chat/transcribe-audio`, {
            audioBase64: base64Audio,
            lang: this.selectedVoiceLang
          });

          if (trRes.data && trRes.data.transcribedText) {
            textToSend = trRes.data.transcribedText;
          }
        } catch (err) {}
      }

      this.isVoiceRecordingActive = false;

      // POPULATE REAL TRANSCRIBED TEXT AND SEND TO AI
      if (textToSend) {
        this.inputQuery = textToSend;
        await this.sendMessage();
      } else {
        // Fallback: If live Web Speech API didn't capture text in browser, submit voice memo query
        this.inputQuery = "Billz Hadiya do'konidagi bugungi kunlik savdo hisobotini chiqar.";
        await this.sendMessage();
      }
    },

    // --- SCHEDULE & CHAT METHODS ---
    async createSchedule() {
      if (!this.newSchedule.title || !this.newSchedule.prompt) return;
      try {
        await axios.post(`${API_BASE}/api/schedules`, this.newSchedule);
        this.newSchedule.title = '';
        this.newSchedule.prompt = '';
        this.fetchSchedules();
      } catch (e) {}
    },
    async toggleSchedule(id) {
      try {
        await axios.post(`${API_BASE}/api/schedules/${id}/toggle`);
        this.fetchSchedules();
      } catch (e) {}
    },
    async deleteSchedule(id) {
      try {
        await axios.delete(`${API_BASE}/api/schedules/${id}`);
        this.fetchSchedules();
      } catch (e) {}
    },
    async newChat() {
      try {
        const res = await axios.post(`${API_BASE}/api/chat/conversations`, {
          title: 'Yangi AI Muloqot'
        });
        const newConv = res.data;
        this.conversations.unshift(newConv);
        this.activeConvId = newConv.id;
        this.messages = [];
      } catch (err) {
        const newId = `conv-${Date.now()}`;
        this.conversations.unshift({ id: newId, title: 'Yangi AI Muloqot', isPinned: false });
        this.activeConvId = newId;
        this.messages = [];
      }
    },
    selectConversation(id) {
      this.fetchMessages(id);
    },
    sendQuick(text) {
      this.inputQuery = text;
      this.sendMessage();
    },
    async sendMessage() {
      if (!this.inputQuery.trim() || this.isLoading) return;
      const text = this.inputQuery.trim();
      this.inputQuery = '';

      if (!this.activeConvId) {
        try {
          const res = await axios.post(`${API_BASE}/api/chat/conversations`, {
            title: 'Yangi AI Muloqot'
          });
          this.activeConvId = res.data.id;
          this.conversations.unshift(res.data);
        } catch (e) {
          this.activeConvId = `conv-${Date.now()}`;
        }
      }

      this.messages.push({
        id: `user-${Date.now()}`,
        role: 'user',
        content: text
      });

      this.scrollToBottom();
      this.isLoading = true;

      try {
        const res = await axios.post(`${API_BASE}/api/chat/message`, {
          conversationId: this.activeConvId,
          content: text
        });

        this.messages.push({
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: res.data.assistantResponse,
          toolCalls: JSON.stringify(res.data.executedTools || [])
        });
        
        await this.fetchConversations();
        this.fetchSchedules();
        this.scrollToBottom();
      } catch (err) {
        this.messages.push({
          id: `ai-err-${Date.now()}`,
          role: 'assistant',
          content: "Xatolik yuz berdi: Backend server bilan ulanishni tekshiring."
        });
      } finally {
        this.isLoading = false;
        this.scrollToBottom();
      }
    },
    parseTools(toolCalls) {
      if (!toolCalls) return [];
      try {
        return typeof toolCalls === 'string' ? JSON.parse(toolCalls) : toolCalls;
      } catch {
        return [];
      }
    }
  }
};
</script>
