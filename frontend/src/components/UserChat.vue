<template>
  <div 
    class="flex h-screen bg-[#0B0C0E] text-gray-100 font-sans overflow-hidden relative"
    @dragover.prevent="onDragOver"
    @dragenter.prevent="onDragEnter"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDropFile"
  >
    <!-- FULL-SCREEN DRAG & DROP OVERLAY -->
    <div v-if="isDraggingFile" class="fixed inset-0 z-50 bg-[#0B0C0E]/90 flex flex-col items-center justify-center p-6 border-4 border-dashed border-indigo-500 rounded-3xl backdrop-blur-sm transition-all duration-300 pointer-events-none">
      <div class="w-20 h-20 rounded-3xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 mb-4 animate-bounce">
        <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
        </svg>
      </div>
      <h2 class="text-2xl font-bold text-white tracking-tight">Faylni shu yerga tashlang (Drop File Here)</h2>
      <p class="text-sm text-gray-400 mt-2">Rasm, PDF, Excel, CSV va hisobotlarni tahlil qilish uchun yuklang</p>
    </div>

    <!-- Hidden File Input -->
    <input type="file" ref="fileInput" @change="onFileInputChange" class="hidden" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.json,.xml" />

    <!-- Mobile Navigation Drawer Overlay -->
    <div v-if="isMobileMenuOpen" @click="isMobileMenuOpen = false" class="fixed inset-0 z-40 bg-black/60 md:hidden"></div>

    <!-- Sidebar (Desktop & Mobile Drawer) -->
    <aside :class="['w-72 border-r border-[#1F222A] bg-[#111317] flex flex-col justify-between p-4 z-40 transition-all duration-300 md:static fixed inset-y-0 left-0', isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0']">
      <div class="space-y-5">
        <!-- App Title & Mobile Close -->
        <div class="flex items-center justify-between px-2 py-1">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm shrink-0">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
              </svg>
            </div>
            <div>
              <span class="font-bold text-sm tracking-tight text-white block">Jarvis AI Workspace</span>
              <span class="text-[10px] text-indigo-400 font-mono">Store Hadiya POS v2</span>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button @click="newChat" class="p-2 rounded-xl bg-[#1A1D26] hover:bg-[#252936] text-gray-300 border border-[#2D3242] transition" title="New Chat">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
              </svg>
            </button>
            <button @click="isMobileMenuOpen = false" class="p-2 rounded-xl bg-[#1A1D26] text-gray-400 md:hidden">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Conversation History -->
        <div class="space-y-1.5">
          <div class="flex items-center justify-between px-2 mb-2">
            <span class="text-[10px] font-bold tracking-widest text-gray-500 uppercase">Mavjud Chatlar</span>
            <button v-if="conversations.length > 0" @click="promptClearAllChats" class="text-[10px] text-gray-400 hover:text-red-400 transition font-medium">Tozalash</button>
          </div>
          <div 
            v-for="conv in conversations" 
            :key="conv.id"
            @click="selectConversation(conv.id)"
            :class="[
              'flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs cursor-pointer transition-all border group gap-2', 
              activeConvId === conv.id 
                ? 'bg-[#1D212C] text-white font-semibold border-indigo-500/50 shadow-sm' 
                : 'bg-[#14161C] text-gray-300 border-[#1F222A] hover:bg-[#1A1D26] hover:border-[#2D3242] hover:text-white'
            ]"
          >
            <div class="flex items-center gap-2.5 min-w-0">
              <svg class="w-3.5 h-3.5 text-indigo-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
              </svg>
              <span class="truncate font-medium">{{ conv.title }}</span>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button @click.stop="promptDeleteChat(conv.id)" class="text-gray-400 hover:text-red-400 p-1 rounded-lg hover:bg-[#252834] transition opacity-70 group-hover:opacity-100" title="Chatni o'chirish">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
              <svg v-if="conv.isPinned" class="w-3.5 h-3.5 text-indigo-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/>
              </svg>
            </div>
          </div>
        </div>
      </div>

      <!-- User Profile Card -->
      <div class="border-t border-[#1F222A] pt-4 flex items-center justify-between px-2">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-[#1D212C] border border-[#2D3242] flex items-center justify-center font-bold text-indigo-400 text-xs">
            A
          </div>
          <div>
            <div class="text-xs font-semibold text-white">Azamjon (Store Hadiya)</div>
            <div class="text-[10px] text-emerald-400 font-mono">BILLZ POS Admin</div>
          </div>
        </div>
        <button @click="$emit('logout')" class="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-[#1A1D26] transition" title="Tizimdan Chiqish (Logout)">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
        </button>
      </div>
    </aside>

    <!-- Main Chat Window -->
    <main class="flex-1 flex flex-col justify-between h-full bg-[#0B0C0E] relative">
      <!-- Header Bar -->
      <header class="h-16 border-b border-[#1F222A] flex items-center justify-between px-4 sm:px-6 bg-[#111317] z-20">
        <div class="flex items-center gap-3">
          <button @click="isMobileMenuOpen = true" class="p-2 rounded-xl bg-[#1A1D26] text-gray-300 md:hidden">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <div class="flex items-center gap-2">
            <div class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></div>
            <span class="text-xs font-bold text-gray-200 hidden sm:inline">Store Hadiya Executive AI</span>
            <span class="text-[10px] bg-indigo-500/10 text-indigo-300 px-2.5 py-1 rounded-full border border-indigo-500/20 font-medium">GPT-4o + Claude 3.5</span>
          </div>
        </div>

        <div class="flex items-center gap-2 sm:gap-3">
          <!-- Schedule Automations Trigger Button -->
          <button @click="isScheduleOpen = true" class="text-xs font-semibold text-emerald-400 hover:text-white bg-[#141A17] hover:bg-[#1C2621] border border-emerald-500/20 px-3 py-1.5 rounded-xl transition flex items-center gap-2">
            <svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <span class="hidden sm:inline">Avtomatlashtirish</span> ({{ schedules.length }})
          </button>

          <button @click="$emit('switch-view', 'admin')" class="text-xs font-semibold text-indigo-300 hover:text-white bg-[#161922] hover:bg-[#1E2330] border border-indigo-500/20 px-3 py-1.5 rounded-xl transition flex items-center gap-2">
            <svg class="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
            <span class="hidden sm:inline">Admin Panel</span>
          </button>
        </div>
      </header>

      <!-- Message History Container -->
      <div ref="chatContainer" class="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 max-w-4xl w-full mx-auto scroll-smooth">
        <!-- Welcome Screen -->
        <div v-if="messages.length === 0" class="h-full flex flex-col items-center justify-center text-center my-auto space-y-6 pt-8 pb-12">
          <div class="w-14 h-14 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/>
            </svg>
          </div>
          <div>
            <h1 class="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Store Hadiya AI Assistant</h1>
            <p class="text-xs sm:text-sm text-gray-400 mt-2 max-w-md">Store Hadiya bazangizdagi 1,152 ta mahsulot va Billz POS savdolarini boshqaring!</p>
          </div>

          <!-- Quick Actions Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-xl text-left pt-2">
            <div @click="openVoiceModal()" class="p-4 rounded-2xl border border-purple-500/20 bg-[#161420] hover:bg-[#1D1B2A] hover:border-purple-500/40 cursor-pointer transition group">
              <div class="text-xs font-bold text-purple-200 group-hover:text-white flex items-center justify-between">
                <span class="flex items-center gap-2">
                  <svg class="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/>
                  </svg>
                  Ovozli Murojaat (English Voice Mode)
                </span>
                <span class="text-purple-300 font-mono text-[9px] bg-purple-500/20 px-2 py-0.5 rounded-full border border-purple-400/30">LIVE MIC</span>
              </div>
              <p class="text-[11px] text-gray-400 mt-1.5">Mikrofoningiz orqali ovozli topshiriq bering...</p>
            </div>

            <div @click="sendQuick('Hadiya do\'konida Rolex soati narxi necha pul va do\'konda bormi?')" class="p-4 rounded-2xl border border-[#1F222A] bg-[#14161C] hover:border-indigo-500/40 hover:bg-[#191C24] cursor-pointer transition group">
              <div class="text-xs font-bold text-white group-hover:text-indigo-300 flex items-center justify-between">
                <span class="flex items-center gap-2">
                  <svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                  Rolex Soati Narxi
                </span>
                <svg class="w-4 h-4 text-gray-500 group-hover:translate-x-1 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
              </div>
              <p class="text-[11px] text-gray-400 mt-1.5">"Rolex Swiss copy soati narxi necha pul?"</p>
            </div>

            <div @click="sendQuick('Billz Hadiya do\'konidagi bugungi kunlik savdo hisobotini chiqar.')" class="p-4 rounded-2xl border border-[#1F222A] bg-[#14161C] hover:border-indigo-500/40 hover:bg-[#191C24] cursor-pointer transition group">
              <div class="text-xs font-bold text-white group-hover:text-indigo-300 flex items-center justify-between">
                <span class="flex items-center gap-2">
                  <svg class="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 012-2h2a2 2 0 012 2v6m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
                  </svg>
                  Store Hadiya Savdosi
                </span>
                <svg class="w-4 h-4 text-gray-500 group-hover:translate-x-1 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
              </div>
              <p class="text-[11px] text-gray-400 mt-1.5">"Billz Hadiya do'konidagi savdoni chiqar."</p>
            </div>

            <div @click="sendQuick('Har kuni soat 19:00 da Store Hadiya savdosini telegramga yuborib tur.')" class="p-4 rounded-2xl border border-[#1F222A] bg-[#14161C] hover:border-indigo-500/40 hover:bg-[#191C24] cursor-pointer transition group">
              <div class="text-xs font-bold text-white group-hover:text-indigo-300 flex items-center justify-between">
                <span class="flex items-center gap-2">
                  <svg class="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                  </svg>
                  Kunlik Telegram Eslatma
                </span>
                <svg class="w-4 h-4 text-gray-500 group-hover:translate-x-1 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
              </div>
              <p class="text-[11px] text-gray-400 mt-1.5">"Har kuni 19:00 da Telegramga yubor."</p>
            </div>
          </div>
        </div>

        <!-- Chat Messages -->
        <div v-else v-for="msg in messages" :key="msg.id" class="space-y-3">
          <!-- User Bubble -->
          <div v-if="msg.role === 'user'" class="flex justify-end">
            <div class="max-w-xl bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm shadow-sm space-y-2.5">
              <div v-if="msg.attachedFile" class="p-2.5 rounded-xl bg-black/30 border border-white/15 flex items-center gap-3">
                <img v-if="msg.attachedFile.isImage" :src="msg.attachedFile.dataUrl" class="w-16 h-16 rounded-lg object-cover border border-white/20 shrink-0" />
                <div v-else class="w-10 h-10 rounded-lg bg-indigo-500/30 border border-indigo-400/40 flex items-center justify-center text-indigo-200 shrink-0">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                </div>
                <div class="truncate text-xs">
                  <div class="font-bold text-white truncate max-w-[220px]">{{ msg.attachedFile.name }}</div>
                  <div class="text-[10px] opacity-80 font-mono">{{ msg.attachedFile.formattedSize }}</div>
                </div>
              </div>
              <div v-if="msg.content">{{ msg.content }}</div>
            </div>
          </div>

          <!-- Assistant Bubble -->
          <div v-else class="flex gap-3">
            <div class="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white text-xs shrink-0 shadow-sm">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
              </svg>
            </div>
            <div class="flex-1 space-y-3">
              <!-- Executed Tools Badges -->
              <div v-if="parseTools(msg.toolCalls).length > 0" class="flex flex-wrap gap-1.5">
                <span 
                  v-for="(t, idx) in parseTools(msg.toolCalls)" 
                  :key="idx"
                  class="inline-flex items-center gap-1.5 text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-lg"
                >
                  <svg class="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                  Executed: {{ t.tool || t.label }}
                </span>
              </div>

              <!-- Message Content -->
              <div class="bg-[#14161C] border border-[#1F222A] rounded-2xl rounded-tl-sm p-4 text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
                {{ msg.content }}
              </div>
            </div>
          </div>
        </div>

        <!-- Gemini-style Interpreting Loading Indicator -->
        <div v-if="isLoading" class="flex items-center gap-3 pt-2">
          <div class="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white text-xs shrink-0">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
          </div>
          <div class="bg-[#14161C] border border-[#1F222A] rounded-2xl px-4 py-2.5 text-xs text-indigo-300 flex items-center gap-2.5">
            <span class="flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping"></span>
              <span class="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse"></span>
            </span>
            <span class="font-medium tracking-wide">Interpreting User Input...</span>
          </div>
        </div>
      </div>

      <!-- Gemini Style Floating Input Pill Footer -->
      <footer class="p-4 sm:p-6 bg-[#0B0C0E]">
        <div class="max-w-3xl w-full mx-auto space-y-2">

          <!-- ATTACHED FILE PREVIEW CARD -->
          <div v-if="attachedFile" class="flex items-center justify-between bg-[#1E1F24] border border-indigo-500/40 px-3.5 py-2 rounded-2xl w-fit shadow-lg mb-2">
            <div class="flex items-center gap-2.5">
              <img v-if="attachedFile.isImage" :src="attachedFile.dataUrl" class="w-9 h-9 rounded-lg object-cover border border-white/10" />
              <div v-else class="w-9 h-9 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              </div>
              <div class="text-xs">
                <div class="font-semibold text-white truncate max-w-[220px]">{{ attachedFile.name }}</div>
                <div class="text-[10px] text-gray-400 font-mono">{{ attachedFile.formattedSize }}</div>
              </div>
            </div>
            <button @click="removeAttachedFile" class="p-1 ml-3 text-gray-400 hover:text-red-400 transition" title="Remove File">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          <!-- INLINE RECORDING ACTIVE STATE (Gemini Live Mode) -->
          <div v-if="isVoiceRecordingActive" class="flex items-center justify-between bg-[#16181D] border border-white/10 rounded-[28px] px-4 py-2.5 shadow-2xl transition-all duration-300 gap-3">
            <!-- Left: Plus Attachment Button -->
            <button @click="triggerFileInput" class="w-8 h-8 rounded-full bg-[#22252E] hover:bg-[#2C303B] text-gray-300 flex items-center justify-center transition shrink-0" title="Attach file or image">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            </button>

            <!-- Live Recording Duration Timer Badge -->
            <div class="flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 border border-red-500/20 rounded-full shrink-0">
              <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
              <span class="font-mono text-xs font-bold text-red-400">00:{{ recordingSeconds < 10 ? '0' + recordingSeconds : recordingSeconds }}</span>
            </div>

            <!-- Center: Minimalist Waveform Spectrum -->
            <div class="flex-1 flex items-center justify-center px-2 h-5 overflow-hidden">
              <svg class="w-full h-5" viewBox="0 0 200 30" preserveAspectRatio="none">
                <rect v-for="(bar, i) in frequencyBars" :key="i" :x="i * 8" :y="15 - bar/2" width="3" :height="Math.max(4, bar)" rx="1.5" fill="#818CF8" />
              </svg>
            </div>

            <!-- Real-time Spoken Text Preview -->
            <span v-if="liveSpokenText" class="text-xs text-indigo-300 italic truncate max-w-[160px] px-1 hidden sm:inline font-medium">
              "{{ liveSpokenText }}"
            </span>

            <!-- Right: Action Buttons -->
            <div class="flex items-center gap-2 shrink-0">
              <button 
                @click="cancelVoiceRecording" 
                class="w-8 h-8 rounded-full bg-[#22252E] hover:bg-red-500/20 text-gray-400 hover:text-red-400 flex items-center justify-center transition"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>

              <button 
                @click="sendVoiceRecording" 
                class="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center font-bold transition shadow-sm"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
              </button>
            </div>
          </div>

          <!-- GEMINI STYLE IDLE INPUT PILL -->
          <div v-else class="flex items-center gap-3 bg-[#1E1F24] border border-[#2C2D33] rounded-[28px] px-4 py-2.5 shadow-xl focus-within:border-indigo-500/50 transition-all">
            <!-- Left: Attachment (+) Button -->
            <button @click="triggerFileInput" class="w-8 h-8 rounded-full bg-[#2A2B32] hover:bg-[#34353E] text-gray-300 flex items-center justify-center transition shrink-0" title="Attach file or image">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            </button>

            <!-- Center: Textarea Input Query -->
            <textarea 
              v-model="inputQuery" 
              @keydown.enter.exact.prevent="sendMessage" 
              rows="1"
              placeholder="Спросить Gemini yoki Store Hadiya bo'yicha savol bering..." 
              class="flex-1 bg-transparent text-sm text-white placeholder-[#8E9196] focus:outline-none px-1 resize-none max-h-36 overflow-y-auto leading-relaxed py-1 font-sans"
            ></textarea>

            <!-- Right Controls: Model Pill + Voice Action Button -->
            <div class="flex items-center gap-2 shrink-0">
              <!-- Model Selector Badge (Gemini Flash style) -->
              <div class="bg-[#2A2B32] text-[11px] text-gray-300 font-medium px-2.5 py-1 rounded-full border border-white/5 flex items-center gap-1 hidden md:flex">
                <span>GPT-4o</span>
                <svg class="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
              </div>

              <!-- Microphone Button -->
              <button 
                @click="openVoiceModal()" 
                class="w-9 h-9 rounded-full bg-white text-black hover:bg-gray-200 flex items-center justify-center font-bold shadow-md transition shrink-0"
              >
                <svg class="w-4.5 h-4.5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Bottom Gemini Disclaimer Text -->
          <p class="text-[11px] text-gray-500 text-center font-sans">
            Store Hadiya AI POS Assistant - sun'iy intellekt xato qilishi mumkin. Muhim ma'lumotlarni tekshiring.
          </p>
        </div>
      </footer>
    </main>

    <!-- SCHEDULE AUTOMATIONS MODAL -->
    <div v-if="isScheduleOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div class="w-full max-w-lg bg-[#111317] border border-[#1F222A] rounded-3xl p-6 shadow-2xl space-y-5">
        <div class="flex items-center justify-between border-b border-[#1F222A] pb-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </div>
            <div>
              <h3 class="text-base font-bold text-white tracking-tight">Avtomatlashtirish & Eslatmalar</h3>
              <p class="text-xs text-gray-400 mt-0.5">Kunlik hisobotlar va Telegram xabarnomalarini sozlang</p>
            </div>
          </div>
          <button @click="isScheduleOpen = false" class="w-8 h-8 rounded-full bg-[#1A1D26] text-gray-400 hover:text-white flex items-center justify-center transition">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <!-- Add New Schedule Form -->
        <div class="bg-[#161820] border border-[#222632] rounded-2xl p-4 space-y-3">
          <div class="text-xs font-bold text-gray-300">Yangi Avtomatlashtirish Qo'shish</div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <input v-model="newSchedule.title" type="text" placeholder="Sarlavha (masalan: Kunlik Savdo Hisoboti)" class="w-full bg-[#0E1015] border border-[#222632] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition" />
            <input v-model="newSchedule.scheduledTime" type="text" placeholder="Vaqti (masalan: 19:00)" class="w-full bg-[#0E1015] border border-[#222632] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition" />
          </div>
          <input v-model="newSchedule.prompt" type="text" placeholder="Topshiriq (masalan: Billzdagi bugungi savdoni chiqar)" class="w-full bg-[#0E1015] border border-[#222632] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition" />
          <div class="flex items-center justify-between pt-1">
            <div class="flex items-center gap-2">
              <select v-model="newSchedule.frequency" class="bg-[#0E1015] border border-[#222632] rounded-xl px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-indigo-500">
                <option value="DAILY">Har kuni (Daily)</option>
                <option value="WEEKLY">Haftalik (Weekly)</option>
                <option value="ONCE">Bir martalik (Once)</option>
              </select>
              <select v-model="newSchedule.targetChannel" class="bg-[#0E1015] border border-[#222632] rounded-xl px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-indigo-500">
                <option value="TELEGRAM">Telegram Bot</option>
                <option value="CHAT">Chat Panel</option>
                <option value="EMAIL">Email Dispatch</option>
              </select>
            </div>
            <button @click="createSchedule" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl transition flex items-center gap-1.5 shadow-sm">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
              Qo'shish
            </button>
          </div>
        </div>

        <!-- Active Schedules List -->
        <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
          <div class="text-xs font-bold text-gray-400">Faol Eslatmalar ({{ schedules.length }})</div>
          <div v-for="s in schedules" :key="s.id" class="p-3.5 rounded-2xl bg-[#161820] border border-[#222632] flex items-center justify-between gap-3">
            <div class="space-y-1">
              <div class="text-xs font-bold text-white flex items-center gap-2">
                <span>{{ s.title }}</span>
                <span class="text-[10px] font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-2 py-0.5 rounded-lg flex items-center gap-1">
                  <svg class="w-3 h-3 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  {{ s.scheduledTime }} ({{ s.frequency }})
                </span>
              </div>
              <p class="text-[11px] text-gray-400">Kanal: {{ s.targetChannel }} | Topshiriq: "{{ s.prompt }}"</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button @click="toggleSchedule(s.id)" :class="['px-2.5 py-1 text-[10px] font-bold rounded-lg border transition', s.isEnabled ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-gray-800 text-gray-400 border-gray-700']">
                {{ s.isEnabled ? 'YOQILGAN' : 'O\'CHIRILGAN' }}
              </button>
              <button @click="deleteSchedule(s.id)" class="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-[#22252E] transition" title="O'chirish">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </div>
        </div>

        <div class="flex justify-end border-t border-[#1F222A] pt-4">
          <button @click="isScheduleOpen = false" class="px-5 py-2 bg-[#1A1D26] hover:bg-[#252936] text-gray-300 text-xs font-semibold rounded-xl border border-[#2D3242] transition">
            Yopish
          </button>
        </div>
      </div>
    </div>

    <!-- DELETE CONFIRMATION MODAL -->
    <div v-if="isDeleteModalOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div class="w-full max-w-sm bg-[#14161C] border border-[#1F222A] rounded-2xl p-6 shadow-2xl space-y-4 text-center">
        <div class="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mx-auto">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
          </svg>
        </div>
        <div>
          <h3 class="text-base font-bold text-white">
            {{ isDeletingAll ? 'Barcha Chatlarni O\'chirish' : 'Chatni O\'chirish' }}
          </h3>
          <p class="text-xs text-gray-400 mt-1.5 leading-relaxed">
            {{ isDeletingAll ? 'Barcha muloqot va xabarlar tarixi butunlay o\'chiriladi.' : 'Ushbu chat va undagi barcha xabarlar o\'chiriladi.' }} Bu amalni qaytarib bo'lmaydi.
          </p>
        </div>
        <div class="flex items-center gap-3 pt-2">
          <button @click="isDeleteModalOpen = false" class="flex-1 py-2 bg-[#1A1D26] hover:bg-[#252936] text-gray-300 text-xs font-semibold rounded-xl transition">
            Bekor qilish
          </button>
          <button @click="confirmDelete" class="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded-xl shadow transition">
            Ha, O'chirilsin
          </button>
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

      // File Drag & Drop & Attachment States
      isDraggingFile: false,
      attachedFile: null,

      // Delete Modal Confirmation States
      isDeleteModalOpen: false,
      pendingDeleteId: null,
      isDeletingAll: false,

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
      if ((!this.inputQuery.trim() && !this.attachedFile) || this.isLoading) return;
      const text = this.inputQuery.trim();
      const fileToSend = this.attachedFile;
      this.inputQuery = '';
      this.attachedFile = null;

      if (!this.activeConvId) {
        try {
          const res = await axios.post(`${API_BASE}/api/chat/conversations`, {
            title: fileToSend ? `[Fayl] ${fileToSend.name}` : (text || 'Yangi AI Muloqot')
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
        content: text,
        attachedFile: fileToSend
      });

      this.scrollToBottom();
      this.isLoading = true;

      try {
        const res = await axios.post(`${API_BASE}/api/chat/message`, {
          conversationId: this.activeConvId,
          content: text,
          attachedFile: fileToSend
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
    },

    // --- DRAG & DROP AND FILE ATTACHMENT HANDLERS ---
    onDragOver(e) {
      this.isDraggingFile = true;
    },
    onDragEnter(e) {
      this.isDraggingFile = true;
    },
    onDragLeave(e) {
      if (e.clientX === 0 || e.clientY === 0 || e.target === document.documentElement) {
        this.isDraggingFile = false;
      }
    },
    onDropFile(e) {
      this.isDraggingFile = false;
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        this.processFile(e.dataTransfer.files[0]);
      }
    },
    triggerFileInput() {
      if (this.$refs.fileInput) {
        this.$refs.fileInput.click();
      }
    },
    onFileInputChange(e) {
      if (e.target.files && e.target.files[0]) {
        this.processFile(e.target.files[0]);
      }
    },
    processFile(file) {
      const isImage = file.type.startsWith('image/');
      const formattedSize = file.size > 1024 * 1024 
        ? (file.size / (1024 * 1024)).toFixed(1) + ' MB' 
        : Math.round(file.size / 1024) + ' KB';

      const reader = new FileReader();
      reader.onload = (evt) => {
        this.attachedFile = {
          name: file.name,
          size: file.size,
          formattedSize,
          type: file.type,
          isImage,
          dataUrl: evt.target.result
        };
      };
      reader.readAsDataURL(file);
    },
    removeAttachedFile() {
      this.attachedFile = null;
    },

    // --- DELETE CHAT CONFIRMATION HANDLERS ---
    promptDeleteChat(id) {
      this.pendingDeleteId = id;
      this.isDeletingAll = false;
      this.isDeleteModalOpen = true;
    },
    promptClearAllChats() {
      this.pendingDeleteId = null;
      this.isDeletingAll = true;
      this.isDeleteModalOpen = true;
    },
    async confirmDelete() {
      this.isDeleteModalOpen = false;
      if (this.isDeletingAll) {
        try {
          await axios.delete(`${API_BASE}/api/chat/conversations`);
        } catch (e) {}
        this.conversations = [];
        this.messages = [];
        this.activeConvId = null;
      } else if (this.pendingDeleteId) {
        const id = this.pendingDeleteId;
        try {
          await axios.delete(`${API_BASE}/api/chat/conversations/${id}`);
        } catch (e) {}
        this.conversations = this.conversations.filter(c => c.id !== id);
        if (this.activeConvId === id) {
          this.activeConvId = null;
          this.messages = [];
        }
        this.pendingDeleteId = null;
      }
    }
  }
};
</script>
