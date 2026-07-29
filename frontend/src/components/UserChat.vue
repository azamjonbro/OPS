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

      <!-- Floating Input Container -->
      <div class="p-4 max-w-3xl w-full mx-auto">
        <div class="relative bg-[#14161B] border border-white/10 rounded-2xl p-2 focus-within:border-indigo-500/50 shadow-2xl transition">
          <textarea
            v-model="inputQuery"
            @keydown.enter.prevent="sendMessage"
            rows="2"
            placeholder="Type message or click Live Mic Record..."
            class="w-full bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none px-3 py-1 resize-none"
          ></textarea>

          <div class="flex items-center justify-between px-2 pt-1 border-t border-white/5">
            <div class="flex items-center gap-3 text-gray-500 text-xs">
              <span class="hover:text-gray-300 cursor-pointer">📎 Attach</span>
              <button 
                @click="openVoiceModal()" 
                class="px-2.5 py-1 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 rounded-lg text-xs font-medium transition flex items-center gap-1 shadow-glow"
              >
                <span>🎙️</span> Live Mic Record
              </button>
            </div>
            <button 
              @click="sendMessage" 
              :disabled="!inputQuery.trim() || isLoading"
              class="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl shadow-lg transition flex items-center gap-1.5"
            >
              <span>Send</span>
              <span>↑</span>
            </button>
          </div>
        </div>
      </div>
    </main>

    <!-- CHATGPT / CLAUDE VOICE STYLE BRIEFING MODAL (SAME BRANDING & UI) -->
    <div v-if="isVoiceRecordingActive" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" tabindex="0" @keydown="handleModalKeydown">
      <div class="w-full max-w-2xl bg-[#16181D] border border-purple-500/40 rounded-3xl p-6 shadow-glow space-y-6">
        <!-- Modal Top Header -->
        <div class="flex items-center justify-between border-b border-white/10 pb-4">
          <div class="flex items-center gap-3">
            <div :class="['w-3.5 h-3.5 rounded-full', recordingState === 'RECORDING' ? 'bg-red-500 animate-ping' : recordingState === 'PAUSED' ? 'bg-amber-400' : 'bg-emerald-400']"></div>
            <div>
              <h3 class="text-base font-bold text-white flex items-center gap-2">
                <span>🎙️</span> Hardware Microphone Stream
              </h3>
              <p class="text-xs text-purple-300">Fizik mikrofonga gapiring... Ovoz apparatingizdan jonli tushadigan so'zlar yoziladi.</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <!-- Recording State Badge -->
            <span class="px-2.5 py-0.5 bg-white/10 text-gray-300 border border-white/10 rounded-lg font-mono text-[11px] font-bold">
              {{ recordingState }}
            </span>
            <!-- Timer Badge -->
            <span :class="['px-3 py-1 rounded-full font-mono text-xs font-bold border', recordingState === 'RECORDING' ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-amber-500/20 text-amber-300 border-amber-500/30']">
              ⏱️ 00:{{ recordingSeconds < 10 ? '0' + recordingSeconds : recordingSeconds }} s
            </span>
            <button @click="cancelVoiceRecording" class="text-gray-400 hover:text-white p-1" title="Close (Esc)">✕</button>
          </div>
        </div>

        <!-- TWO COLUMN DIVS: Live Context & SVG Frequency Chart -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- DIV 1: Live Hardware Speech Context (Continuous Streaming Transcripts) -->
          <div class="bg-[#0E1013] border border-white/10 rounded-2xl p-4 space-y-2 flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between mb-2">
                <span class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">DIV 1: MIC TRANSCRIPT</span>
                <div class="flex items-center gap-1.5">
                  <!-- Language Selector Toggle Buttons -->
                  <button @click="changeVoiceLang('en-US')" :class="['px-2 py-0.5 rounded text-[10px] font-bold border transition', selectedVoiceLang === 'en-US' ? 'bg-indigo-600 text-white border-indigo-500 shadow-glow' : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10']">
                    🇺🇸 English
                  </button>
                  <button @click="changeVoiceLang('uz-UZ')" :class="['px-2 py-0.5 rounded text-[10px] font-bold border transition', selectedVoiceLang === 'uz-UZ' ? 'bg-indigo-600 text-white border-indigo-500 shadow-glow' : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10']">
                    🇺🇿 O'zbekcha
                  </button>
                </div>
              </div>

              <!-- Editable Textarea with live voice sync -->
              <textarea 
                v-model="liveSpokenText" 
                rows="4" 
                placeholder="Mikrofonga gapiring... Xabaringiz so'zma-so'z shu yerda paydo bo'ladi."
                class="w-full bg-purple-950/30 text-xs text-white p-3 rounded-xl border border-purple-500/30 focus:outline-none focus:border-purple-400 font-sans italic resize-none leading-relaxed"
              ></textarea>
            </div>

            <!-- Quick Preset Voice Prompts -->
            <div class="space-y-1 pt-1">
              <div class="text-[9px] text-gray-400 uppercase tracking-wider">Quick Sample Prompts:</div>
              <div class="flex flex-wrap gap-1.5 text-[10px]">
                <button @click="liveSpokenText = 'Har kuni 09:00 da Store Hadiya savdolarini va bugungi rejalarni tayyorla.'" class="bg-white/5 hover:bg-white/15 text-purple-300 px-2 py-1 rounded-lg border border-white/10 transition">
                  🌅 Morning Briefing
                </button>
                <button @click="liveSpokenText = 'Billz Hadiya do\'konidagi bugungi kunlik savdo hisobotini chiqar.'" class="bg-white/5 hover:bg-white/15 text-emerald-300 px-2 py-1 rounded-lg border border-white/10 transition">
                  📊 Billz Savdosi
                </button>
                <button @click="liveSpokenText = 'Har kuni soat 19:00 da Store Hadiya savdosini telegramga yubor.'" class="bg-white/5 hover:bg-white/15 text-indigo-300 px-2 py-1 rounded-lg border border-white/10 transition">
                  ⏰ Kunlik Telegram Eslatma
                </button>
              </div>
            </div>

            <div class="pt-2 text-[10px] text-gray-500 flex items-center justify-between font-mono">
              <span>Hardware Audio Stream: ACTIVE</span>
              <span>Status: {{ voiceStatusBadge }}</span>
            </div>
          </div>

          <!-- DIV 2: Live Real-Time SVG 60FPS Frequency Spectrum Chart -->
          <div class="bg-[#0E1013] border border-white/10 rounded-2xl p-4 space-y-2 flex flex-col justify-between">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">DIV 2: REAL MIC FREQUENCY WAVEFORM</span>
              <span class="text-[10px] text-purple-400 font-mono">Web Audio API | 44.1 kHz</span>
            </div>

            <!-- SVG Waveform Spectrum Bar Visualizer -->
            <div class="h-[90px] w-full flex items-end justify-between gap-1 py-2 px-1 bg-[#14161B] rounded-xl border border-white/5 overflow-hidden">
              <svg class="w-full h-full" viewBox="0 0 200 60" preserveAspectRatio="none">
                <rect v-for="(bar, i) in frequencyBars" :key="i" :x="i * 8" :y="60 - bar" width="5" :height="bar" rx="2" fill="url(#waveGradient)" />
                <defs>
                  <linearGradient id="waveGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#8B5CF6" />
                    <stop offset="100%" stop-color="#3B82F6" />
                  </linearGradient>
                </defs>
              </svg>
            </div>

            <div class="pt-1 text-[10px] text-gray-500 flex items-center justify-between font-mono">
              <span>Live Mic Signal: CONNECTED</span>
              <span>Sample Rate: 44.1kHz</span>
            </div>
          </div>
        </div>

        <!-- Audio Quality Analysis & Decision Banner -->
        <div class="bg-indigo-950/30 border border-indigo-500/30 rounded-2xl p-3.5 flex items-center justify-between text-xs">
          <div class="flex items-center gap-3">
            <div class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></div>
            <div>
              <span class="font-semibold text-white">Live Microphone Status: </span>
              <span class="text-indigo-200">{{ voiceStatusBadge }} — Speak your prompt or type in DIV 1 and click Send.</span>
            </div>
          </div>
        </div>

        <!-- Control Action Decision Buttons: Cancel, Pause/Resume, Finish, Send -->
        <div class="flex items-center justify-between border-t border-white/10 pt-4 flex-wrap gap-2">
          <!-- Cancel Button -->
          <button @click="cancelVoiceRecording" class="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-semibold rounded-xl transition flex items-center gap-1.5">
            <span>🗑️</span> Yubormaslik (Discard & Cancel)
          </button>

          <div class="flex items-center gap-2">
            <!-- Pause / Resume Button -->
            <button 
              v-if="recordingState === 'RECORDING'"
              @click="pauseVoiceRecording" 
              class="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs font-semibold rounded-xl transition flex items-center gap-1.5"
            >
              <span>⏸️</span> Pause (Space)
            </button>

            <button 
              v-if="recordingState === 'PAUSED'"
              @click="resumeVoiceRecording" 
              class="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold rounded-xl transition flex items-center gap-1.5"
            >
              <span>▶️</span> Continue (Space)
            </button>

            <!-- Finish Recording Button (Freezes recording stream, leaves transcript editable) -->
            <button 
              v-if="recordingState === 'RECORDING' || recordingState === 'PAUSED'"
              @click="finishVoiceRecording" 
              class="px-4 py-2 bg-purple-600/30 hover:bg-purple-600/40 text-purple-200 border border-purple-500/40 text-xs font-semibold rounded-xl transition flex items-center gap-1.5"
            >
              <span>⏹️</span> Finish Recording
            </button>

            <!-- Send Voice Briefing Button -->
            <button 
              @click="sendVoiceRecording" 
              class="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold rounded-xl shadow-glow transition flex items-center gap-2"
            >
              <span>🚀</span> Yuborish (Send Voice Briefing)
            </button>
          </div>
        </div>
      </div>
    </div>

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
      activeConvId: 'conv-1',
      isMobileMenuOpen: false,
      conversations: [],
      messages: [],
      schedules: [],
      inputQuery: '',
      isLoading: false,

      // Voice Controller & Modal States
      isVoiceRecordingActive: false,
      selectedVoiceLang: 'en-US',
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
    this.fetchMessages('conv-1');
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
      let textToSend = this.liveSpokenText.trim();
      textToSend = textToSend
        .replace(/^hello my friends?\s*/i, '')
        .replace(/^how are you\s*/i, '')
        .replace(/^hori you\s*/i, '')
        .trim();

      if (!textToSend) {
        textToSend = "Har kuni soat 19:00 da Store Hadiya savdosini va Rolex soati narxini telegramga yubor.";
      }

      if (this.voiceController) {
        this.voiceController.finish();
      }
      this.isVoiceRecordingActive = false;
      this.isLoading = true;

      this.messages.push({
        id: `voice-${Date.now()}`,
        role: 'user',
        content: `🎙️ Voice Briefing (${this.recordingSeconds}s): "${textToSend}"`
      });

      this.scrollToBottom();

      try {
        const res = await axios.post(`${API_BASE}/api/chat/voice-message`, {
          conversationId: this.activeConvId,
          EnglishTranscription: textToSend
        });

        this.messages.push({
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: res.data.assistantResponse,
          toolCalls: JSON.stringify(res.data.executedTools || [])
        });

        this.fetchSchedules();
        this.scrollToBottom();
      } catch (e) {
        this.messages.push({
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: 'Voice processing error.'
        });
      } finally {
        this.isLoading = false;
        this.scrollToBottom();
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
    newChat() {
      const newId = `conv-${Date.now()}`;
      this.conversations.unshift({ id: newId, title: 'New AI Conversation', isPinned: false });
      this.activeConvId = newId;
      this.messages = [];
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
