<template>
  <div 
    class="flex h-screen bg-[#0B0C0E] text-gray-100 font-sans overflow-hidden relative"
    @dragover.prevent="onDragOver"
    @dragenter.prevent="onDragEnter"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDropFile"
  >
    <div v-if="isDraggingFile" class="fixed inset-0 z-50 bg-[#0B0C0E]/90 flex flex-col items-center justify-center p-6 border-4 border-dashed border-indigo-500 rounded-3xl backdrop-blur-sm transition-all duration-300 pointer-events-none">
      <div class="w-20 h-20 rounded-3xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 mb-4 animate-bounce">
        <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
        </svg>
      </div>
      <h2 class="text-2xl font-bold text-white tracking-tight">Faylni shu yerga tashlang (Drop File Here)</h2>
      <p class="text-sm text-gray-400 mt-2">Rasm, PDF, Excel, CSV va hisobotlarni tahlil qilish uchun yuklang</p>
    </div>
    <input type="file" ref="fileInput" @change="onFileInputChange" class="hidden" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.json,.xml" />

    <!-- FLOATING SELECTION TOOLBAR (appears when text inside a message is selected) -->
    <div
      v-if="selectionToolbar"
      :style="{ top: selectionToolbar.y + 'px', left: selectionToolbar.x + 'px' }"
      class="fixed z-50 -translate-x-1/2 -translate-y-full flex items-center gap-1 bg-[#1A1D26] border border-[#2D3242] rounded-xl p-1 shadow-2xl"
      @mousedown.prevent
    >
      <button @click="replyToSelection" class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-indigo-300 hover:bg-indigo-600 hover:text-white transition whitespace-nowrap">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6M3 10l6-6"/></svg>
        Shu qismga javob
      </button>
      <div class="w-px h-4 bg-[#2D3242]"></div>
      <button @click="copySelection" class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-emerald-300 hover:bg-emerald-600 hover:text-white transition whitespace-nowrap">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
        Nusxalash
      </button>
    </div>

    <div v-if="isMobileMenuOpen" @click="isMobileMenuOpen = false" class="fixed inset-0 z-40 bg-black/60 md:hidden"></div>


    <aside :class="['w-72 border-r border-[#1F222A] bg-[#111317] flex flex-col justify-between p-4 z-40 transition-all duration-300 md:static fixed inset-y-0 left-0 h-full overflow-hidden', isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0']">

      <div class="flex items-center justify-between px-2 pb-3 border-b border-[#1F222A] shrink-0">
        <div class="flex items-center gap-3 group cursor-pointer">
          <div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-600 to-indigo-700 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 border border-indigo-400/30 shrink-0 group-hover:scale-105 transition-transform duration-300">
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
          <button @click="newChat" class="p-2.5 rounded-xl bg-gradient-to-r from-indigo-600/20 to-purple-600/20 hover:from-indigo-600/40 hover:to-purple-600/40 text-indigo-300 hover:text-white border border-indigo-500/30 hover:border-indigo-500/60 shadow-md shadow-indigo-500/10 transition-all duration-200 group" title="New Chat">
            <svg class="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

      <!-- Dedicated Scrollable Conversation History Container -->
      <div class="flex-1 min-h-0 overflow-y-auto my-3 pr-1 space-y-1.5 custom-scrollbar">
        <div class="flex items-center justify-between px-2 pb-2 pt-1 sticky top-0 bg-[#111317] z-10 border-b border-[#1F222A]/50">
          <span class="text-[10px] font-bold tracking-widest text-gray-500 uppercase">Mavjud Chatlar</span>
          <button v-if="conversations.length > 0" @click="promptClearAllChats" class="text-[10px] text-gray-400 hover:text-red-400 transition font-medium">Tozalash</button>
        </div>

        <div 
          v-for="conv in conversations" 
          :key="conv.id"
          @click="selectConversation(conv.id)"
          :class="[
            'flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs cursor-pointer transition-all border group gap-2', 
            activeConvId === conv.id 
              ? 'bg-gradient-to-r from-[#1D212C] to-[#171922] text-white font-semibold border-indigo-500/60 shadow-lg shadow-indigo-500/10' 
              : 'bg-[#14161C]/80 text-gray-300 border-[#1F222A] hover:bg-[#1A1D26] hover:border-[#2D3242] hover:text-white'
          ]"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <div :class="['w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-colors', activeConvId === conv.id ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/40' : 'bg-[#1A1D26] text-gray-400 group-hover:text-indigo-400']">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
              </svg>
            </div>
            <span class="truncate font-medium">{{ conv.title }}</span>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button @click.stop="promptDeleteChat(conv.id)" class="text-gray-400 hover:text-red-400 p-1 rounded-lg hover:bg-[#252834] opacity-0 group-hover:opacity-100 transition-opacity duration-200" title="Chatni o'chirish">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
            <svg v-if="conv.isPinned" class="w-3.5 h-3.5 text-indigo-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/>
            </svg>
          </div>
        </div>
      </div>

      <!-- Bottom Stack: Primary Navigation & User Profile Card -->
      <div class="shrink-0 space-y-2 border-t border-[#1F222A] pt-3">
        <!-- AI Executive Chat Button -->
        <button 
          @click="toggleViewMode('chat')"
          :class="[
            'w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all duration-200 border group relative overflow-hidden',
            activeViewMode === 'chat'
              ? 'bg-gradient-to-r from-indigo-600/35 via-purple-600/25 to-indigo-600/10 text-white border-indigo-500/70 shadow-xl shadow-indigo-500/15'
              : 'bg-[#14161C] text-gray-300 border-[#1F222A] hover:bg-[#1A1D26] hover:border-[#2D3242] hover:text-white'
          ]"
        >
          <div class="flex items-center gap-3">
            <div :class="[
              'w-7 h-7 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 shadow-md',
              activeViewMode === 'chat'
                ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-indigo-500/30'
                : 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-400'
            ]">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
              </svg>
            </div>
            <span class="tracking-tight">AI Executive Chat</span>
          </div>
          <span v-if="activeViewMode === 'chat'" class="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
        </button>

        <!-- Calendar Workspace Button -->
        <button 
          @click="toggleViewMode('calendar')"
          :class="[
            'w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all duration-200 border group relative overflow-hidden',
            activeViewMode === 'calendar'
              ? 'bg-gradient-to-r from-emerald-600/35 via-teal-600/25 to-emerald-600/10 text-white border-emerald-500/70 shadow-xl shadow-emerald-500/15'
              : 'bg-[#14161C] text-gray-300 border-[#1F222A] hover:bg-[#1A1D26] hover:border-[#2D3242] hover:text-white'
          ]"
        >
          <div class="flex items-center gap-3">
            <div :class="[
              'w-7 h-7 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 shadow-md',
              activeViewMode === 'calendar'
                ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-emerald-500/30'
                : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
            ]">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
              </svg>
            </div>
            <span class="tracking-tight">Calendar Workspace</span>
          </div>
          <span class="text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
            New
          </span>
        </button>

        <!-- My Projects & Knowledge Hub Button -->
        <button 
          @click="toggleViewMode('projects')"
          :class="[
            'w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all duration-200 border group relative overflow-hidden',
            activeViewMode === 'projects'
              ? 'bg-gradient-to-r from-purple-600/35 via-indigo-600/25 to-purple-600/10 text-white border-purple-500/70 shadow-xl shadow-purple-500/15'
              : 'bg-[#14161C] text-gray-300 border-[#1F222A] hover:bg-[#1A1D26] hover:border-[#2D3242] hover:text-white'
          ]"
        >
          <div class="flex items-center gap-3">
            <div :class="[
              'w-7 h-7 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 shadow-md',
              activeViewMode === 'projects'
                ? 'bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-purple-500/30'
                : 'bg-purple-500/15 border border-purple-500/30 text-purple-400'
            ]">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
              </svg>
            </div>
            <span class="tracking-tight">My Projects & Knowledge</span>
          </div>
          <span class="text-[9px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40">Hub</span>
        </button>

        <!-- User Profile Card -->
        <div @click="isUserSettingsOpen = true" class="border-t border-[#1F222A] pt-2.5 flex items-center justify-between px-2 cursor-pointer group hover:bg-[#161820] p-1.5 rounded-2xl transition-all duration-200 mt-1">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 border border-indigo-400/40 group-hover:border-indigo-400 flex items-center justify-center font-bold text-white text-xs shadow-lg shadow-indigo-500/20 shrink-0 group-hover:scale-105 transition-transform">
              A
            </div>
            <div>
              <div class="text-xs font-bold text-white group-hover:text-indigo-300 transition">Azamjon (Store Hadiya)</div>
              <div class="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                BILLZ POS Admin
              </div>
            </div>
          </div>
          <button @click.stop="$emit('logout')" class="p-1.5 rounded-xl text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition border border-transparent hover:border-red-500/20" title="Tizimdan Chiqish (Logout)">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
          </button>
        </div>
      </div>
    </aside>

    <!-- Main Chat Window -->
    <main class="flex-1 flex flex-col justify-between h-full bg-[#0B0C0E] relative">
      <!-- Header Bar -->
      <header class="h-16 border-b border-[#1F222A] flex items-center justify-between px-4 sm:px-6 bg-[#111317] z-20">
        <div class="flex items-center gap-2.5 min-w-0">
          <button @click="isMobileMenuOpen = true" class="p-2 rounded-xl bg-[#1A1D26] text-gray-300 md:hidden shrink-0">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <div class="flex items-center gap-2 min-w-0">
            <div class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0"></div>
            <span class="text-xs font-bold text-gray-200 truncate">Store Hadiya Executive AI</span>
            <span class="text-[10px] bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-indigo-300 px-2.5 py-0.5 rounded-full border border-indigo-500/30 font-semibold shadow-sm hidden md:inline-flex shrink-0">GPT-4o + Claude 3.5</span>
          </div>
        </div>

        <div class="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <!-- Schedule Automations Trigger Button -->
          <button @click="isScheduleOpen = true" class="text-xs font-bold text-emerald-300 hover:text-white bg-gradient-to-r from-emerald-950/60 to-teal-950/60 hover:from-emerald-900/80 hover:to-teal-900/80 border border-emerald-500/30 hover:border-emerald-500/60 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl transition-all shadow-lg shadow-emerald-950/30 flex items-center gap-1.5">
            <div class="w-4 h-4 sm:w-5 sm:h-5 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
              <svg class="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </div>
            <span class="hidden sm:inline">Avtomatlashtirish</span>
            <span class="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-[9px] border border-emerald-500/30 font-bold">{{ schedules.length }}</span>
          </button>

          <!-- Admin Panel Button -->
          <button @click="$emit('switch-view', 'admin')" class="text-xs font-bold text-indigo-300 hover:text-white bg-gradient-to-r from-indigo-950/60 to-purple-950/60 hover:from-indigo-900/80 hover:to-purple-900/80 border border-indigo-500/30 hover:border-indigo-500/60 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl transition-all shadow-lg shadow-indigo-950/30 flex items-center gap-1.5">
            <div class="w-4 h-4 sm:w-5 sm:h-5 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
              <svg class="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
            </div>
            <span class="hidden sm:inline">Admin Panel</span>
          </button>
        </div>
      </header>

      <!-- CALENDAR WORKSPACE VIEW -->
      <CalendarWorkspace v-if="activeViewMode === 'calendar'" />

      <!-- MY PROJECTS & KNOWLEDGE HUB VIEW -->
      <div v-else-if="activeViewMode === 'projects'" class="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 max-w-5xl w-full mx-auto">
        <!-- Hub Header Banner -->
        <div class="bg-gradient-to-r from-[#171A24] via-[#1D2130] to-[#171A24] border border-indigo-500/30 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
          <div class="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>
          <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
            <div class="space-y-1.5">
              <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-semibold">
                <span>📁 Permanent AI Memory & Projects Hub</span>
              </div>
              <h1 class="text-2xl font-bold text-white tracking-tight">My Projects & Knowledge Bank</h1>
              <p class="text-xs text-gray-300 max-w-xl leading-relaxed">
                PDF kitoblar, sotuv strategiyalari va biznes logikalarini AI doimiy xotirasiga yuklang. AI ushbu hujjatlar ustida tahlil va sotuv amallarini bajaradi.
              </p>
            </div>
            <button @click="toggleViewMode('chat')" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg transition flex items-center gap-2 shrink-0">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
              <span>Chat Muloqotiga Qaytish</span>
            </button>
          </div>
        </div>

        <!-- Two Column Workspace: Upload Form & Saved Memory Cards -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          <!-- Left Column: Upload New Knowledge / PDF Book / Strategy -->
          <div class="lg:col-span-5 bg-[#14161C] border border-[#1F222A] rounded-3xl p-5 space-y-4 shadow-xl">
            <div class="flex items-center gap-2 border-b border-[#1F222A] pb-3">
              <div class="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-xs">
                +
              </div>
              <h2 class="text-sm font-bold text-white">Yangi Bilim / PDF Kitob Yuklash</h2>
            </div>

            <div class="space-y-3 text-xs">
              <!-- Title -->
              <div>
                <label class="block text-gray-400 font-medium mb-1">Sarlavha / Nomi</label>
                <input 
                  v-model="newDocTitle" 
                  type="text" 
                  placeholder="masalan: Sotuvni oshirish strategiyasi 2026..." 
                  class="w-full bg-[#1C1F2A] border border-[#2D3242] rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <!-- Category -->
              <div>
                <label class="block text-gray-400 font-medium mb-1">Kategoriya</label>
                <select 
                  v-model="newDocCategory" 
                  class="w-full bg-[#1C1F2A] border border-[#2D3242] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="knowledge">📚 PDF Kitob / Bilim Bazasi</option>
                  <option value="business">📊 Sotuv Logikasi & Strategiya</option>
                  <option value="project">🚀 Yangi Loyiha / Project</option>
                  <option value="architecture">🏗️ Texnik Arxitektura & Qoidalar</option>
                </select>
              </div>

              <!-- File Upload Picker -->
              <div>
                <label class="block text-gray-400 font-medium mb-1">Fayl Yuklash (.pdf, .txt, .md, .doc)</label>
                <input 
                  type="file" 
                  @change="handleKnowledgeFileUpload" 
                  accept=".pdf,.txt,.md,.doc,.docx,.json" 
                  class="w-full text-gray-400 text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-indigo-600/20 file:text-indigo-300 hover:file:bg-indigo-600/30 cursor-pointer"
                />
              </div>

              <!-- Text Content Input -->
              <div>
                <label class="block text-gray-400 font-medium mb-1">Matn / Qoidalar / Logikalar</label>
                <textarea 
                  v-model="newDocContent" 
                  rows="6" 
                  placeholder="PDF matni, sotuv qoidalari yoki loyiha bo'yicha ko'rsatmalaringizni beravering..." 
                  class="w-full bg-[#1C1F2A] border border-[#2D3242] rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none font-sans"
                ></textarea>
              </div>

              <!-- Submit Button -->
              <button 
                @click="submitMemoryUpload" 
                :disabled="isUploadingMemory || !newDocTitle.trim() || !newDocContent.trim()" 
                class="w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white font-semibold text-xs shadow-lg transition flex items-center justify-center gap-2"
              >
                <span v-if="isUploadingMemory">AI Xotirasiga Saqlanmoqda...</span>
                <span v-else>🧠 AI Doimiy Xotirasiga Saqlash</span>
              </button>
            </div>
          </div>

          <!-- Right Column: Stored Memory Bank Cards -->
          <div class="lg:col-span-7 space-y-4">
            <div class="flex items-center justify-between border-b border-[#1F222A] pb-3">
              <h2 class="text-sm font-bold text-white flex items-center gap-2">
                <span>📚 AI Xotirasidagi Loyihalar va Kitoblar</span>
                <span class="text-xs font-mono bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full">({{ memoryItems.length }})</span>
              </h2>
              <button @click="fetchMemoryItems" class="text-xs text-indigo-400 hover:text-indigo-300 transition">Yangilash 🔄</button>
            </div>

            <div v-if="memoryItems.length === 0" class="bg-[#14161C] border border-[#1F222A] rounded-3xl p-8 text-center space-y-3">
              <div class="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto text-xl font-bold">📚</div>
              <div class="text-sm font-semibold text-white">Hozircha xotirada ma'lumot yo'q</div>
              <p class="text-xs text-gray-400 max-w-sm mx-auto">
                Chap tarafdagi shakl orqali sotuv logikalari, PDF kitoblar yoki loyiha ko'rsatmalarini saqlang.
              </p>
            </div>

            <div v-else class="space-y-3 max-h-[600px] overflow-y-auto pr-1">
              <div 
                v-for="item in memoryItems" 
                :key="item._id || item.key"
                class="bg-[#14161C] border border-[#1F222A] hover:border-indigo-500/40 rounded-2xl p-4 space-y-2.5 transition shadow-md group"
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                        {{ item.category || 'knowledge' }}
                      </span>
                      <span class="text-[10px] text-gray-500 font-mono">{{ new Date(item.updatedAt).toLocaleDateString() }}</span>
                    </div>
                    <h3 class="text-sm font-bold text-white group-hover:text-indigo-300 transition mt-1">{{ item.title }}</h3>
                  </div>

                  <button @click="deleteMemoryCard(item._id)" class="text-gray-500 hover:text-red-400 p-1 transition" title="Xotiradan o'chirish">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                  </button>
                </div>

                <p class="text-xs text-gray-300 line-clamp-3 leading-relaxed bg-[#1A1D26] p-2.5 rounded-xl border border-[#252936]">
                  {{ item.content }}
                </p>

                <div class="flex items-center justify-between pt-1 text-xs">
                  <span class="text-[10px] text-gray-400 font-mono" v-if="item.metadata && item.metadata.fileName">📄 {{ item.metadata.fileName }}</span>
                  <button 
                    @click="queryAiAboutMemory(item)" 
                    class="px-3 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/30 text-[11px] font-semibold transition ml-auto flex items-center gap-1.5"
                  >
                    <span>🤖 AI Tahlil & Muloqot</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      <!-- Message History Container (WHEN IN CHAT VIEW MODE) -->
      <div v-else ref="chatContainer" @mouseup="onTextSelected" @touchend="onTextSelected" class="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 max-w-4xl w-full mx-auto scroll-smooth">
        <!-- Welcome Screen -->
        <div v-if="messages.length === 0" class="h-full flex flex-col items-center justify-center text-center my-auto space-y-6 pt-6 pb-10">
          <!-- Glowing AI Hexagon Badge -->
          <div class="relative group">
            <div class="absolute -inset-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500 rounded-3xl blur opacity-25 group-hover:opacity-50 transition duration-500"></div>
            <div class="relative w-16 h-16 rounded-2xl bg-[#14161C] border border-white/10 flex items-center justify-center text-indigo-400 shadow-2xl">
              <svg class="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M13 10V3L4 14h7v7l9-11h-7z"/>
              </svg>
            </div>
          </div>

          <div class="space-y-2 max-w-lg">
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium">
              <span>Assalomu alaykum, Azamjon! 👋</span>
            </div>
            <h1 class="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Jarvis AI Executive Assistant</h1>
            <p class="text-xs sm:text-sm text-gray-400 max-w-md mx-auto leading-relaxed">
              Biznes integratsiyalaringiz, savdo hisobotlari, mahsulotlar bazasi va avtomatlashtirilgan eslatmalarni boshqaring.
            </p>
          </div>



          <!-- Quick Actions Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5 w-full max-w-xl text-left pt-2">
            <div @click="openVoiceModal()" class="p-4 rounded-2xl border border-purple-500/25 bg-[#161420] hover:bg-[#1D1B2A] hover:border-purple-500/50 cursor-pointer transition group shadow-lg">
              <div class="text-xs font-bold text-purple-200 group-hover:text-white flex items-center justify-between">
                <span class="flex items-center gap-2">
                  <svg class="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/>
                  </svg>
                  Ovozli Murojaat (Live Mic)
                </span>
                <span class="text-purple-300 font-mono text-[9px] bg-purple-500/20 px-2 py-0.5 rounded-full border border-purple-400/30 font-bold">LIVE MIC</span>
              </div>
              <p class="text-[11px] text-gray-400 mt-2">Mikrofon orqali ovozli topshiriq bering...</p>
            </div>

            <div @click="sendQuick('Do\'kondagi Rolex soatlari narxi va qoldig\'i haqida ma\'lumot ber.')" class="p-4 rounded-2xl border border-[#1F222A] bg-[#14161C] hover:border-indigo-500/40 hover:bg-[#191C24] cursor-pointer transition group shadow-lg">
              <div class="text-xs font-bold text-white group-hover:text-indigo-300 flex items-center justify-between">
                <span class="flex items-center gap-2">
                  <svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
                  </svg>
                  Mahsulotlar Qoldig'i & Narxi
                </span>
                <svg class="w-4 h-4 text-gray-500 group-hover:translate-x-1 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
              </div>
              <p class="text-[11px] text-gray-400 mt-2">"Do'kondagi mahsulotlar narxi va qoldig'ini tekshir."</p>
            </div>

            <div @click="sendQuick('Bugungi kunlik biznes va savdo hisobotini chiqar.')" class="p-4 rounded-2xl border border-[#1F222A] bg-[#14161C] hover:border-indigo-500/40 hover:bg-[#191C24] cursor-pointer transition group shadow-lg">
              <div class="text-xs font-bold text-white group-hover:text-indigo-300 flex items-center justify-between">
                <span class="flex items-center gap-2">
                  <svg class="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 012-2h2a2 2 0 012 2v6m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
                  </svg>
                  Kunlik Savdo Hisoboti
                </span>
                <svg class="w-4 h-4 text-gray-500 group-hover:translate-x-1 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
              </div>
              <p class="text-[11px] text-gray-400 mt-2">"Bugungi jami savdo va tushumlarni chiqar."</p>
            </div>

            <div @click="sendQuick('Har kuni soat 19:00 da kunlik hisobotni Telegramga yuborib tur.')" class="p-4 rounded-2xl border border-[#1F222A] bg-[#14161C] hover:border-indigo-500/40 hover:bg-[#191C24] cursor-pointer transition group shadow-lg">
              <div class="text-xs font-bold text-white group-hover:text-indigo-300 flex items-center justify-between">
                <span class="flex items-center gap-2">
                  <svg class="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                  </svg>
                  Kunlik Telegram Eslatma
                </span>
                <svg class="w-4 h-4 text-gray-500 group-hover:translate-x-1 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
              </div>
              <p class="text-[11px] text-gray-400 mt-2">"Har kuni 19:00 da Telegramga savdoni yubor."</p>
            </div>
          </div>
        </div>

        <!-- Chat Messages -->
        <div
          v-else
          v-for="msg in messages"
          :key="msg.id"
          :data-msg-id="msg.id"
          :data-msg-role="msg.role"
          class="space-y-3 group/msg"
        >
          <!-- User Bubble -->
          <div v-if="msg.role === 'user'" class="flex justify-end">
            <div class="max-w-xl bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm shadow-sm space-y-2.5">
              <!-- Quoted excerpt this message replies to -->
              <div v-if="msg.replyTo" class="border-l-2 border-white/50 pl-2.5 py-0.5 text-[11px] text-indigo-100/90">
                <div class="font-bold opacity-80 mb-0.5">{{ msg.replyTo.role === 'user' ? 'Siz' : 'Jarvis AI' }}</div>
                <div class="line-clamp-3 italic">{{ msg.replyTo.snippet }}</div>
              </div>
              <div v-if="msg.attachedFile" class="p-2.5 rounded-xl bg-black/30 border border-white/15 flex items-center gap-3">
                <img 
                  v-if="msg.attachedFile.isImage" 
                  :src="msg.attachedFile.dataUrl" 
                  @click="openImagePreview(msg.attachedFile.dataUrl)" 
                  class="w-16 h-16 rounded-lg object-cover border border-white/20 shrink-0 cursor-zoom-in hover:opacity-90 transition transform hover:scale-105 shadow" 
                  title="Kattalashtirib ko'rish uchun bosing" 
                />
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
            <!-- Hover actions -->
            <div class="flex flex-col gap-1 self-end pb-1 pr-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
              <button @click="startReply(msg)" class="p-1.5 rounded-lg text-gray-400 hover:text-indigo-300 hover:bg-[#1A1D26] transition" title="Javob berish (Reply)">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6M3 10l6-6"/></svg>
              </button>
              <button @click="copyMessage(msg)" class="p-1.5 rounded-lg text-gray-400 hover:text-emerald-300 hover:bg-[#1A1D26] transition" :title="copiedMsgId === msg.id ? 'Nusxalandi!' : 'Nusxalash'">
                <svg v-if="copiedMsgId === msg.id" class="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
              </button>
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

              <!-- Quoted excerpt this message replies to -->
              <div v-if="msg.replyTo" class="border-l-2 border-indigo-500/60 pl-3 py-0.5 text-[11px] text-gray-400">
                <div class="font-bold text-indigo-300 mb-0.5">{{ msg.replyTo.role === 'user' ? 'Siz' : 'Jarvis AI' }}</div>
                <div class="line-clamp-3 italic">{{ msg.replyTo.snippet }}</div>
              </div>

              <!-- Message Content with Markdown Parsing -->
              <MarkdownMessage
                :content="msg.content"
                class="bg-[#14161C] border border-[#1F222A] rounded-2xl rounded-tl-sm p-4 text-sm text-gray-200 leading-relaxed"
              />

              <!-- Message Actions -->
              <div class="flex items-center gap-1.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                <button @click="startReply(msg)" class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-gray-400 hover:text-indigo-300 hover:bg-[#1A1D26] border border-transparent hover:border-[#262A36] transition">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6M3 10l6-6"/></svg>
                  Javob berish
                </button>
                <button @click="copyMessage(msg)" class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-gray-400 hover:text-emerald-300 hover:bg-[#1A1D26] border border-transparent hover:border-[#262A36] transition">
                  <svg v-if="copiedMsgId === msg.id" class="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                  <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                  {{ copiedMsgId === msg.id ? 'Nusxalandi!' : 'Markdown nusxalash' }}
                </button>
              </div>

              <!-- Interactive Action Confirmation Card (Allow / Cancel) -->
              <div v-if="msg.requiresApproval || (msg.content && (msg.content.includes('Biroz kuting') || msg.content.includes('ko\'rib chiqaman')))" class="mt-3 bg-gradient-to-r from-[#171922] via-[#1D212F] to-[#171922] border border-indigo-500/40 rounded-2xl p-4 space-y-3 shadow-xl">
                <div class="flex items-center gap-2.5">
                  <div class="w-7 h-7 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center font-bold text-xs shrink-0">
                    🛡️
                  </div>
                  <div>
                    <h4 class="text-xs font-bold text-white tracking-wide">Tizim Amali Uchun Ruxsat So'ralmoqda</h4>
                    <p class="text-[11px] text-gray-300">Notion workspace va Billz 2.0 API orqali barcha ma'lumotlar olinib, real hisobot shakllantirilsinmi?</p>
                  </div>
                </div>

                <!-- Action Confirmation Buttons -->
                <div class="flex items-center gap-2 pt-1">
                  <button 
                    @click="confirmActionAndContinue(msg)" 
                    class="flex-1 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                    <span>✅ Ruxsat berish (Allow & Continue)</span>
                  </button>

                  <button 
                    @click="cancelAction(msg)" 
                    class="px-4 py-2 rounded-xl bg-[#222530] hover:bg-[#2C3040] text-gray-300 font-semibold text-xs border border-[#343848] transition flex items-center justify-center gap-1.5"
                  >
                    <span>❌ Bekor qilish</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Gemini-style Interactive Progress Indicator -->
        <div v-if="isLoading" class="flex items-center gap-3 pt-2">
          <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center font-bold text-white text-xs shrink-0 shadow-lg shadow-indigo-500/20">
            <svg class="w-4 h-4 animate-spin text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
          </div>
          <div class="bg-[#14161C] border border-indigo-500/30 rounded-2xl px-4 py-2.5 text-xs text-indigo-300 flex items-center gap-2.5 shadow-xl">
            <span class="flex items-center gap-1.5 shrink-0">
              <span class="w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
              <span class="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></span>
            </span>
            <span class="font-semibold tracking-wide text-indigo-200 transition-all duration-300">{{ loadingStepText || "📡 Billz 2.0 POS API serveridan Store Hadiya ma'lumotlari olinmoqda..." }}</span>
          </div>
        </div>
      </div>

      <!-- Gemini Style Floating Input Pill Footer -->
      <footer class="p-4 sm:p-6 bg-[#0B0C0E] mb-[76px] md:mb-0 relative z-30">
        <div class="max-w-3xl w-full mx-auto space-y-2">

          <!-- ACTIVE REPLY QUOTE BAR -->
          <div v-if="replyTo" class="flex items-start justify-between gap-3 bg-[#161820] border-l-[3px] border-indigo-500 border-y border-r border-[#262A36] rounded-xl px-3.5 py-2 shadow-lg">
            <div class="min-w-0">
              <div class="text-[10px] font-bold text-indigo-300 flex items-center gap-1.5">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6M3 10l6-6"/></svg>
                {{ replyTo.role === 'user' ? 'Sizning xabaringizga' : 'Jarvis AI javobiga' }} javob berilmoqda
              </div>
              <div class="text-[11px] text-gray-400 italic line-clamp-2 mt-0.5">{{ replyTo.snippet }}</div>
            </div>
            <button @click="cancelReply" class="p-1 text-gray-500 hover:text-red-400 transition shrink-0" title="Javobni bekor qilish">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

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

          <!-- VOICE TRANSCRIBING LOADING STATE (OpenAI Whisper) -->
          <div v-if="isTranscribingVoice" class="flex items-center justify-between bg-gradient-to-r from-[#171822] via-[#1D1F2D] to-[#171822] border border-indigo-500/50 rounded-[28px] px-5 py-3 shadow-2xl transition-all duration-300 gap-3">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center text-indigo-400 shrink-0">
                <svg class="w-4 h-4 text-indigo-400 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
              </div>
              <div>
                <div class="text-xs font-bold text-white flex items-center gap-2">
                  <span>🧠 OpenAI Whisper AI ovozni matnga o'girmoqda...</span>
                  <span class="w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
                </div>
                <div class="text-[10px] text-indigo-300 font-mono">Audio golos formatida yuborildi & Whisper API transkripsiya qilmoqda...</div>
              </div>
            </div>
            <span class="text-xs font-mono px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-bold animate-pulse">TRANSCRIBING...</span>
          </div>

          <!-- INLINE RECORDING ACTIVE STATE (Gemini Live Mode) -->
          <div v-else-if="isVoiceRecordingActive" class="flex items-center justify-between bg-[#16181D] border border-white/10 rounded-[28px] px-4 py-2.5 shadow-2xl transition-all duration-300 gap-3">
            <!-- Left: Plus Attachment Button -->
            <button @click="triggerFileInput" class="w-8 h-8 rounded-full bg-[#22252E] hover:bg-[#2C303B] text-gray-300 flex items-center justify-center transition shrink-0" title="Attach file or image">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            </button>

            <!-- Live Recording Duration Timer Badge -->
            <div class="flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 border border-red-500/20 rounded-full shrink-0">
              <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
              <span class="font-mono text-xs font-bold text-red-400">{{ formattedRecordingTime }}</span>
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
          <div v-else class="flex items-center gap-3 bg-[#1E1F24] border border-[#2C2D33] rounded-[26px] px-3.5 py-2 shadow-xl focus-within:border-indigo-500/50 transition-all">
            <!-- Left: Attachment (+) Button -->
            <button @click="triggerFileInput" class="w-8 h-8 rounded-full bg-[#2A2B32] hover:bg-[#34353E] text-gray-300 flex items-center justify-center transition shrink-0 my-auto" title="Attach file or image">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            </button>

            <!-- Center: Textarea Input Query (Default small 1 line, expands up to 300px) -->
            <textarea 
              ref="inputQueryRef"
              v-model="inputQuery" 
              @input="adjustTextareaHeight"
              @keydown.enter.exact.prevent="sendMessage" 
              rows="1"
              placeholder="Спросить Gemini yoki Store Hadiya bo'yicha savol bering..." 
              class="flex-1 bg-transparent text-sm text-white placeholder-[#8E9196] focus:outline-none px-1 resize-none max-h-[300px] overflow-y-auto leading-relaxed py-1 font-sans my-auto"
            ></textarea>

            <!-- Right Controls: Send Button (if text or file attached) OR Microphone Button (if input empty) -->
            <div class="flex items-center gap-2 shrink-0 my-auto">
              <!-- Send Button (when input has text or attached file) -->
              <button 
                v-if="inputQuery.trim() || attachedFile"
                @click="sendMessage" 
                class="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center font-bold shadow-md transition shrink-0 my-auto"
                title="Jo'natish (Send)"
              >
                <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/>
                </svg>
              </button>

              <!-- Microphone Button (when input is empty) -->
              <button 
                v-else
                @click="openVoiceModal()" 
                class="w-8 h-8 rounded-full bg-white text-black hover:bg-gray-200 flex items-center justify-center font-bold shadow-sm transition shrink-0 my-auto"
                title="Ovozli Yozish (Voice Mode)"
              >
                <svg class="w-4 h-4 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

    <!-- USER SETTINGS MODAL -->
    <div v-if="isUserSettingsOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div class="w-full max-w-md bg-[#111317] border border-[#1F222A] rounded-3xl p-6 shadow-2xl space-y-5">
        <!-- Header -->
        <div class="flex items-center justify-between border-b border-[#1F222A] pb-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white text-sm shadow-md">
              A
            </div>
            <div>
              <h3 class="text-base font-bold text-white tracking-tight">Azamjon (Store Hadiya)</h3>
              <p class="text-xs text-emerald-400 font-mono">BILLZ POS Admin &bull; admin@hadiya.uz</p>
            </div>
          </div>
          <button @click="isUserSettingsOpen = false" class="w-8 h-8 rounded-full bg-[#1A1D26] text-gray-400 hover:text-white flex items-center justify-center transition">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <!-- User Preferences & Owner Personality Persona -->
        <div class="space-y-4 text-xs">
          <!-- Executive Name / Title -->
          <div>
            <label class="block font-bold text-gray-300 mb-1">Mening Ismim / Unvonim (Owner Profile Title)</label>
            <input 
              v-model="ownerTitle" 
              type="text" 
              placeholder="masalan: Azamjon (Store Hadiya & Hadiya Agency CEO)..." 
              class="w-full bg-[#161820] border border-[#222632] rounded-xl px-3.5 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <!-- Personality Character Rules Textarea -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="font-bold text-gray-300">Mening Xarakterim va Muloqot Qoidalarim</label>
              <span v-if="ownerProfileSavedBadge" class="text-[10px] text-emerald-400 font-bold font-mono animate-bounce">✓ Xotiraga Saqlandi!</span>
            </div>
            <textarea 
              v-model="ownerCharacterPrompt" 
              rows="4" 
              placeholder="Men qisqa, aniq, faktlar va raqamlar bilan gapiradigan insonman. Ortqcha emotsiya va xushomad kerak emas..." 
              class="w-full bg-[#161820] border border-[#222632] rounded-xl px-3.5 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none font-sans leading-relaxed"
            ></textarea>
          </div>

          <!-- Presets Chips -->
          <div>
            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Tezkor Xarakter Shablonlari:</div>
            <div class="flex flex-wrap gap-1.5">
              <button 
                @click="applyCharacterPreset('Mening xarakterim: Men qisqa, aniq, faktlar va raqamlar bilan gapiradigan insonman. Ortqcha emotsiya va xushomad kerak emas. Aniq yechim taklif qil.')" 
                class="px-2.5 py-1 rounded-lg bg-[#1A1D26] hover:bg-[#252936] text-indigo-300 border border-indigo-500/20 text-[10px] font-semibold transition"
              >
                ⚡ Qisqa & Faktlar Bilan
              </button>
              <button 
                @click="applyCharacterPreset('Mening xarakterim: Men analitik, moliyaviy raqamlarga, konversiya va ROI ko\'rsatkichlariga birinchi o\'rinda e\'tibor beruvchi biznes egasiman.')" 
                class="px-2.5 py-1 rounded-lg bg-[#1A1D26] hover:bg-[#252936] text-purple-300 border border-purple-500/20 text-[10px] font-semibold transition"
              >
                📊 Analitik & Raqamlar Bilan
              </button>
              <button 
                @click="applyCharacterPreset('Mening xarakterim: Men CTO va COO darajasidagi texnik va operatsion ijrochiman. Menga darhol tayyor action-plan va arxitektura taqdim qil.')" 
                class="px-2.5 py-1 rounded-lg bg-[#1A1D26] hover:bg-[#252936] text-emerald-300 border border-emerald-500/20 text-[10px] font-semibold transition"
              >
                🧠 CTO / COO Ijrochi Uslubi
              </button>
            </div>
          </div>

          <!-- Save Owner Profile Button -->
          <button 
            @click="saveOwnerProfile" 
            :disabled="isSavingOwnerProfile" 
            class="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md transition flex items-center justify-center gap-2"
          >
            <span v-if="isSavingOwnerProfile">Saqlanmoqda...</span>
            <span v-else>💾 Xarakter va Profilni AI Xotirasiga Saqlash</span>
          </button>

          <!-- Voice Recognition Language Picker -->
          <div class="pt-2 border-t border-[#1F222A]">
            <label class="block font-bold text-gray-300 mb-1">Ovozli Tanib Olish Tili (Speech Language)</label>
            <select v-model="selectedVoiceLang" @change="saveUserLang" class="w-full bg-[#161820] border border-[#222632] rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-indigo-500">
              <option value="en-US">English (en-US) - Standard Voice Mode</option>
              <option value="uz-UZ">O'zbekcha (uz-UZ) - O'zbek Tili</option>
              <option value="ru-RU">Русский (ru-RU) - Русский Язык</option>
            </select>
          </div>

          <div class="pt-2 flex items-center justify-between border-t border-[#1F222A]">
            <button @click="$emit('logout')" class="px-4 py-2 bg-red-600/20 text-red-400 hover:bg-red-600 hover:text-white border border-red-500/30 rounded-xl font-semibold transition flex items-center gap-1.5">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
              Tizimdan Chiqish
            </button>
            <button @click="isUserSettingsOpen = false" class="px-4 py-2 bg-[#1A1D26] hover:bg-[#252936] text-gray-300 font-semibold rounded-xl border border-[#2D3242] transition">
              Yopish
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- FULLSCREEN IMAGE LIGHTBOX MODAL -->
    <div v-if="isPreviewImageOpen" @click="isPreviewImageOpen = false" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md cursor-zoom-out">
      <div class="relative max-w-5xl max-h-[90vh] flex flex-col items-center justify-center" @click.stop>
        <button @click="isPreviewImageOpen = false" class="absolute -top-12 right-0 p-2 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full backdrop-blur transition" title="Yopish (Esc)">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
        <img :src="previewImageSrc" class="max-w-full max-h-[85vh] rounded-2xl object-contain shadow-2xl border border-white/10" />
      </div>
    </div>
    <!-- MOBILE FLOATING NAVIGATION BAR -->
    <nav class="md:hidden fixed bottom-3 left-3 right-3 z-40 bg-[#111317]/90 backdrop-blur-xl border border-[#262A36] rounded-2xl p-1.5 flex items-center justify-around shadow-2xl">
      <button @click="toggleViewMode('chat')" :class="['flex flex-col items-center gap-1 px-3.5 py-1.5 rounded-xl text-[10px] font-semibold transition', activeViewMode === 'chat' ? 'text-indigo-400 bg-indigo-500/10 border border-indigo-500/20' : 'text-gray-400']">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
        <span>Chat</span>
      </button>

      <button @click="toggleViewMode('calendar')" :class="['flex flex-col items-center gap-1 px-3.5 py-1.5 rounded-xl text-[10px] font-semibold transition relative', activeViewMode === 'calendar' ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20' : 'text-gray-400']">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
        <span>Calendar</span>
        <span class="absolute top-1 right-3 w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
      </button>

      <button @click="toggleViewMode('projects')" :class="['flex flex-col items-center gap-1 px-3.5 py-1.5 rounded-xl text-[10px] font-semibold transition', activeViewMode === 'projects' ? 'text-indigo-400 bg-indigo-500/10 border border-indigo-500/20' : 'text-gray-400']">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
        <span>Hub</span>
      </button>

      <button @click="$emit('switch-view', 'admin')" class="flex flex-col items-center gap-1 px-3.5 py-1.5 rounded-xl text-[10px] font-semibold text-gray-400 hover:text-white transition">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/></svg>
        <span>Admin</span>
      </button>
    </nav>
  </div>
</template>

<script>
import { nextTick } from 'vue';
import { VoiceController, RECORDING_STATE } from '../services/voiceController';
import { chatService } from '../services/chatService';
import { scheduleService } from '../services/scheduleService';
import CalendarWorkspace from './CalendarWorkspace.vue';
import MarkdownMessage from './MarkdownMessage.vue';

const MAX_TEXT_CHARS = 20000;
const MAX_IMAGE_EDGE = 1568;
const TEXT_EXTENSIONS = /\.(txt|md|csv|tsv|json|xml|ya?ml|log|html?|js|ts|css|sql)$/i;

function isTextReadable(file) {
  return file.type.startsWith('text/') ||
    file.type === 'application/json' ||
    file.type === 'application/xml' ||
    TEXT_EXTENSIONS.test(file.name);
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Re-encodes an image so the long edge is at most MAX_IMAGE_EDGE. Falls back to the
// original data URL if the browser cannot decode it (e.g. an exotic format).
async function downscaleImage(file) {
  const original = await readFileAsDataUrl(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = original;
    });

    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
    if (scale === 1 && original.length < 1_500_000) return original;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

    // PNG screenshots of text re-encode much smaller as JPEG with no meaningful loss.
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (err) {
    return original;
  }
}

export default {
  components: {
    CalendarWorkspace,
    MarkdownMessage
  },
  data() {
    return {
      activeConvId: null,
      isMobileMenuOpen: false,
      conversations: [],
      messages: [],
      schedules: [],
      inputQuery: '',
      isLoading: false,

      // Reply / quote & copy states
      replyTo: null,
      selectionToolbar: null,
      copiedMsgId: null,

      // Image Lightbox Preview States
      isPreviewImageOpen: false,
      previewImageSrc: null,

      // File Drag & Drop & Attachment States
      isDraggingFile: false,
      dragDepth: 0,
      loadingStepText: '',
      loadingTimer: null,
      attachedFile: null,

      // Delete Modal Confirmation States
      isDeleteModalOpen: false,
      pendingDeleteId: null,
      isDeletingAll: false,

      // View Mode (chat vs projects) & Memory Upload States
      activeViewMode: 'chat',
      memoryItems: [],
      newDocTitle: '',
      newDocCategory: 'knowledge',
      newDocContent: '',
      newDocFileName: '',
      isUploadingMemory: false,

      // Owner Personality Persona States
      ownerTitle: 'Azamjon (Store Hadiya CEO)',
      ownerCharacterPrompt: "Mening xarakterim: Men qisqa, aniq, faktlar va raqamlar bilan gapiradigan insonman. Ortqcha emotsiya va xushomad kerak emas. Biznes qarorlarini darhol taklif qil va muammolarni yechishga yo'naltirilgan bo'l.",
      isSavingOwnerProfile: false,
      ownerProfileSavedBadge: false,

      // Voice Controller & Modal States
      isVoiceRecordingActive: false,
      isTranscribingVoice: false,
      // Owner's choice: dictate in English. Whatever is picked in settings is
      // remembered via saveUserLang().
      selectedVoiceLang: localStorage.getItem('jarvis-voice-lang') || 'en-US',
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
  computed: {
    // The old inline template hardcoded a "00:" minute prefix, so anything over a
    // minute displayed as 00:73.
    formattedRecordingTime() {
      const m = Math.floor(this.recordingSeconds / 60);
      const s = this.recordingSeconds % 60;
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
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
    this.fetchOwnerProfile();
    document.addEventListener('mousedown', this.dismissSelectionToolbar);
  },
  beforeUnmount() {
    document.removeEventListener('mousedown', this.dismissSelectionToolbar);
    if (this.voiceController) {
      this.voiceController.cancel();
    }
  },
  methods: {
    toggleViewMode(mode) {
      this.activeViewMode = mode;
      if (mode === 'projects') {
        this.fetchMemoryItems();
      }
    },
    async fetchMemoryItems() {
      try {
        const data = await chatService.getMemoryItems();
        if (data && data.items) {
          this.memoryItems = data.items;
        }
      } catch (e) {}
    },
    handleKnowledgeFileUpload(event) {
      const file = event.target.files[0];
      if (!file) return;
      this.newDocFileName = file.name;
      if (!this.newDocTitle) {
        this.newDocTitle = file.name.replace(/\.[^/.]+$/, "");
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        this.newDocContent = e.target.result || '';
      };
      reader.readAsText(file);
    },
    async submitMemoryUpload() {
      if (!this.newDocTitle.trim() || !this.newDocContent.trim() || this.isUploadingMemory) return;
      this.isUploadingMemory = true;
      try {
        await chatService.uploadMemoryItem({
          title: this.newDocTitle.trim(),
          category: this.newDocCategory,
          content: this.newDocContent.trim(),
          fileName: this.newDocFileName || 'Knowledge Document'
        });
        this.newDocTitle = '';
        this.newDocContent = '';
        this.newDocFileName = '';
        await this.fetchMemoryItems();
      } catch (e) {
        alert("Xotiraga yuklashda xatolik: " + (e.response?.data?.error || e.message));
      } finally {
        this.isUploadingMemory = false;
      }
    },
    async deleteMemoryCard(id) {
      try {
        await chatService.deleteMemoryItem(id);
        await this.fetchMemoryItems();
      } catch (e) {}
    },
    queryAiAboutMemory(item) {
      this.activeViewMode = 'chat';
      this.inputQuery = `"${item.title}" xotira hujjati bo'yicha tahlil bering va undagi sotuv logikalarini tushuntiring.`;
    },
    async fetchOwnerProfile() {
      try {
        const data = await chatService.getOwnerProfile();
        if (data && data.profile) {
          this.ownerTitle = data.profile.title || this.ownerTitle;
          this.ownerCharacterPrompt = data.profile.content || this.ownerCharacterPrompt;
        }
      } catch (e) {}
    },
    async saveOwnerProfile() {
      this.isSavingOwnerProfile = true;
      try {
        await chatService.saveOwnerProfile({
          title: this.ownerTitle,
          content: this.ownerCharacterPrompt
        });
        this.ownerProfileSavedBadge = true;
        setTimeout(() => { this.ownerProfileSavedBadge = false; }, 3000);
      } catch (e) {
        alert("Xarakter sozlamasini saqlashda xatolik: " + e.message);
      } finally {
        this.isSavingOwnerProfile = false;
      }
    },
    applyCharacterPreset(presetText) {
      this.ownerCharacterPrompt = presetText;
    },
    adjustTextareaHeight() {
      nextTick(() => {
        const el = this.$refs.inputQueryRef;
        if (el) {
          el.style.height = 'auto';
          if (this.inputQuery && this.inputQuery.trim()) {
            const targetHeight = Math.min(el.scrollHeight, 300);
            el.style.height = targetHeight + 'px';
          }
        }
      });
    },
    openImagePreview(src) {
      if (!src) return;
      this.previewImageSrc = src;
      this.isPreviewImageOpen = true;
    },
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
        this.conversations = await chatService.getConversations();
      } catch (e) {}
    },
    async fetchMessages(convId) {
      this.activeConvId = convId;
      try {
        this.messages = await chatService.getMessages(convId);
        this.scrollToBottom();
      } catch (e) {}
    },
    async fetchSchedules() {
      try {
        this.schedules = await scheduleService.getSchedules();
      } catch (e) {}
    },

    // --- CHATGPT VOICE WORKFLOW CONTROLLER ---
    changeVoiceLang(lang) {
      this.selectedVoiceLang = lang;
      this.saveUserLang();
    },
    // Bound to the language <select> in the settings modal. Without it the change
    // handler resolved to undefined and every language switch threw.
    saveUserLang() {
      try {
        localStorage.setItem('jarvis-voice-lang', this.selectedVoiceLang);
      } catch (e) {}
      if (this.voiceController) {
        this.voiceController.setLanguage(this.selectedVoiceLang);
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
          if (text) {
            this.inputQuery = text;
          }
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
          this.voiceStatusBadge = `⚠️ ${err}`;
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
      let audioBlob = null;
      if (this.voiceController) {
        await this.voiceController.finish();
        audioBlob = this.voiceController.getAudioBlob();
      }

      this.isVoiceRecordingActive = false;
      this.isTranscribingVoice = true;

      let textToSend = (this.liveSpokenText || this.inputQuery || '').trim();

      try {
        const reader = new FileReader();
        const base64Audio = audioBlob ? await new Promise((resolve) => {
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(audioBlob);
        }) : null;

        if (base64Audio || textToSend) {
          const trData = await chatService.transcribeAudio({
            spokenText: textToSend,
            audioBase64: base64Audio,
            lang: this.selectedVoiceLang
          });

          if (trData && trData.transcribedText) {
            textToSend = trData.transcribedText;
          }
        }
      } catch (err) {
        console.warn('Voice transcription error:', err);
      } finally {
        this.isTranscribingVoice = false;
      }

      if (!textToSend) {
        this.inputQuery = '';
        this.voiceStatusBadge = "🎙️ Ovozingizni eshita olmadim. Qaytadan gapiring.";
        return;
      }

      this.inputQuery = textToSend;
      await this.sendMessage();
    },

    // --- SCHEDULE & CHAT METHODS ---
    async createSchedule() {
      if (!this.newSchedule.title || !this.newSchedule.prompt) return;
      try {
        await scheduleService.createSchedule(this.newSchedule);
        this.newSchedule.title = '';
        this.newSchedule.prompt = '';
        this.fetchSchedules();
      } catch (e) {}
    },
    async toggleSchedule(id) {
      try {
        await scheduleService.toggleSchedule(id);
        this.fetchSchedules();
      } catch (e) {}
    },
    async deleteSchedule(id) {
      try {
        await scheduleService.deleteSchedule(id);
        this.fetchSchedules();
      } catch (e) {}
    },
    async newChat() {
      try {
        const newConv = await chatService.createConversation('Yangi AI Muloqot');
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
      const replyToSend = this.replyTo;
      this.inputQuery = '';
      this.attachedFile = null;
      this.replyTo = null;
      this.adjustTextareaHeight();

      if (!this.activeConvId) {
        try {
          const newConv = await chatService.createConversation(
            fileToSend ? `[Fayl] ${fileToSend.name}` : (text || 'Yangi AI Muloqot')
          );
          this.activeConvId = newConv.id;
          this.conversations.unshift(newConv);
        } catch (e) {
          this.activeConvId = `conv-${Date.now()}`;
        }
      }

      this.messages.push({
        id: `user-${Date.now()}`,
        role: 'user',
        content: text,
        attachedFile: fileToSend,
        replyTo: replyToSend
      });

      this.scrollToBottom();
      this.isLoading = true;
      this.startLoadingSteps();

      try {
        const data = await chatService.sendMessage({
          conversationId: this.activeConvId,
          content: text,
          attachedFile: fileToSend,
          replyTo: replyToSend
        });

        this.messages.push({
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: data.assistantResponse,
          toolCalls: JSON.stringify(data.executedTools || [])
        });

        if (data.executedTools && data.executedTools.some(t => t.tool && t.tool.includes('calendar'))) {
          window.dispatchEvent(new CustomEvent('calendar-updated'));
        }
        
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
        this.stopLoadingSteps();
        this.scrollToBottom();
      }
    },
    async confirmActionAndContinue(msg) {
      if (this.isLoading) return;
      msg.requiresApproval = false;

      const userMsgIdx = this.messages.findIndex(m => m.id === msg.id);
      let userPrompt = "Kechagi va oxirgi kiritilgan barcha qo'shimchalarni Notion va MongoDB bazasidan o'qib ber";
      if (userMsgIdx > 0 && this.messages[userMsgIdx - 1] && this.messages[userMsgIdx - 1].role === 'user') {
        userPrompt = this.messages[userMsgIdx - 1].content;
      }

      this.isLoading = true;
      this.startLoadingSteps();

      try {
        const data = await chatService.sendMessage({
          conversationId: this.activeConvId,
          content: userPrompt,
          confirmed: true
        });

        msg.content = data.assistantResponse;
        msg.toolCalls = JSON.stringify(data.executedTools || []);

        await this.fetchConversations();
        this.fetchSchedules();
        this.scrollToBottom();
      } catch (err) {
        msg.content = "Xatolik yuz berdi: Backend server bilan ulanishni tekshiring.";
      } finally {
        this.isLoading = false;
        this.stopLoadingSteps();
        this.scrollToBottom();
      }
    },
    cancelAction(msg) {
      msg.requiresApproval = false;
      msg.content = "❌ So'rov foydalanuvchi tomonidan bekor qilindi.";
    },
    startLoadingSteps() {
      const steps = [
        "📡 Billz 2.0 POS API serveriga ulanilmoqda...",
        "📦 Store Hadiya 1,522 ta mahsulot va narxlari o'qilmoqda...",
        "📊 Tanlangan davr sotuv tushumlari va qoldiqlar tahlil qilinmoqda...",
        "🧠 Dual Ensemble GPT-4o executive hisobot shakllantirmoqda..."
      ];
      let idx = 0;
      this.loadingStepText = steps[0];
      if (this.loadingTimer) clearInterval(this.loadingTimer);
      this.loadingTimer = setInterval(() => {
        idx = (idx + 1) % steps.length;
        this.loadingStepText = steps[idx];
      }, 1100);
    },
    stopLoadingSteps() {
      if (this.loadingTimer) clearInterval(this.loadingTimer);
      this.loadingTimer = null;
    },
    parseTools(toolCalls) {
      if (!toolCalls) return [];
      try {
        return typeof toolCalls === 'string' ? JSON.parse(toolCalls) : toolCalls;
      } catch {
        return [];
      }
    },
    onDragOver(e) {
      if (this.isDraggingFile) return;
      this.isDraggingFile = true;
    },
    // dragenter/dragleave also fire when the pointer crosses child elements, so track
    // nesting depth instead of clearing on the first leave (which made the overlay flicker).
    onDragEnter(e) {
      this.dragDepth += 1;
      this.isDraggingFile = true;
    },
    onDragLeave(e) {
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (this.dragDepth === 0) {
        this.isDraggingFile = false;
      }
    },
    onDropFile(e) {
      this.dragDepth = 0;
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
    async processFile(file) {
      const isImage = file.type.startsWith('image/');
      const formattedSize = file.size > 1024 * 1024
        ? (file.size / (1024 * 1024)).toFixed(1) + ' MB'
        : Math.round(file.size / 1024) + ' KB';

      const base = {
        name: file.name,
        size: file.size,
        formattedSize,
        type: file.type,
        isImage
      };

      try {
        if (isImage) {
          // Downscale before upload: a phone screenshot is several MB of base64 otherwise,
          // and the vision model gains nothing above ~1568px on the long edge.
          this.attachedFile = { ...base, dataUrl: await downscaleImage(file) };
          return;
        }

        if (isTextReadable(file)) {
          const text = await readFileAsText(file);
          this.attachedFile = {
            ...base,
            textContent: text.slice(0, MAX_TEXT_CHARS),
            truncated: text.length > MAX_TEXT_CHARS
          };
          return;
        }

        // Binary formats we cannot parse in the browser (PDF, DOCX, XLSX). Send the
        // metadata only and flag it so the AI says so instead of inventing contents.
        this.attachedFile = { ...base, unreadable: true };
      } catch (err) {
        console.warn('File read failed:', err);
        this.attachedFile = { ...base, unreadable: true };
      }
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
          await chatService.clearAllConversations();
        } catch (e) {}
        this.conversations = [];
        this.messages = [];
        this.activeConvId = null;
      } else if (this.pendingDeleteId) {
        const id = this.pendingDeleteId;
        try {
          await chatService.deleteConversation(id);
        } catch (e) {}
        this.conversations = this.conversations.filter(c => c.id !== id);
        if (this.activeConvId === id) {
          this.activeConvId = null;
          this.messages = [];
        }
        this.pendingDeleteId = null;
      }
    },
    // --- REPLY / QUOTE & COPY ---
    // The toolbar itself suppresses mousedown, so any other press means "dismiss".
    dismissSelectionToolbar() {
      if (this.selectionToolbar) this.selectionToolbar = null;
    },
    makeSnippet(text) {
      const clean = String(text || '').replace(/\s+/g, ' ').trim();
      return clean.length > 220 ? clean.slice(0, 220) + '…' : clean;
    },
    startReply(msg, snippet = null) {
      this.replyTo = {
        messageId: msg.id,
        role: msg.role,
        snippet: this.makeSnippet(snippet || msg.content)
      };
      this.selectionToolbar = null;
      nextTick(() => {
        const el = this.$refs.inputQueryRef;
        if (el) el.focus();
      });
    },
    cancelReply() {
      this.replyTo = null;
    },
    onTextSelected() {
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : '';
      if (!text) {
        this.selectionToolbar = null;
        return;
      }

      // Only offer the toolbar for selections that live inside a rendered message.
      const anchorEl = selection.anchorNode && (selection.anchorNode.nodeType === 1
        ? selection.anchorNode
        : selection.anchorNode.parentElement);
      const msgEl = anchorEl && anchorEl.closest('[data-msg-id]');
      if (!msgEl) {
        this.selectionToolbar = null;
        return;
      }

      const rect = selection.getRangeAt(0).getBoundingClientRect();
      this.selectionToolbar = {
        text,
        msgId: msgEl.dataset.msgId,
        role: msgEl.dataset.msgRole,
        x: rect.left + rect.width / 2,
        y: rect.top - 8
      };
    },
    replyToSelection() {
      if (!this.selectionToolbar) return;
      const { msgId, role, text } = this.selectionToolbar;
      this.startReply({ id: msgId, role, content: text }, text);
      window.getSelection().removeAllRanges();
    },
    async copySelection() {
      if (!this.selectionToolbar) return;
      await this.writeClipboard(this.selectionToolbar.text);
      this.selectionToolbar = null;
      window.getSelection().removeAllRanges();
    },
    async copyMessage(msg) {
      // Copies the raw markdown source, so pasting into Notion/Telegram keeps the structure.
      const ok = await this.writeClipboard(msg.content || '');
      if (ok) {
        this.copiedMsgId = msg.id;
        setTimeout(() => {
          if (this.copiedMsgId === msg.id) this.copiedMsgId = null;
        }, 2000);
      }
    },
    async writeClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        // Clipboard API needs a secure context; fall back to the legacy path.
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand('copy');
          document.body.removeChild(ta);
          return ok;
        } catch (e) {
          return false;
        }
      }
    }
  }
};
</script>

<style>
.markdown-body {
  color: #E2E8F0;
  font-size: 0.875rem;
  line-height: 1.625;
}
.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 {
  color: #FFFFFF;
  font-weight: 700;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
}
.markdown-body h1 { font-size: 1.25rem; border-bottom: 1px solid #2D3748; padding-bottom: 0.25rem; }
.markdown-body h2 { font-size: 1.1rem; }
.markdown-body h3 { font-size: 0.95rem; }
.markdown-body p {
  margin-bottom: 0.75rem;
}
.markdown-body p:last-child {
  margin-bottom: 0;
}
.markdown-body ul {
  list-style-type: disc;
  padding-left: 1.25rem;
  margin-bottom: 0.75rem;
}
.markdown-body ol {
  list-style-type: decimal;
  padding-left: 1.25rem;
  margin-bottom: 0.75rem;
}
.markdown-body li {
  margin-bottom: 0.25rem;
}
.markdown-body a {
  color: #818CF8;
  text-decoration: underline;
}
.markdown-body a:hover {
  color: #A5B4FC;
}
.markdown-body code {
  background-color: #1E222D;
  color: #F472B6;
  padding: 0.15rem 0.35rem;
  border-radius: 0.375rem;
  font-family: monospace;
  font-size: 0.8em;
}
.markdown-body pre {
  background-color: #0F1117;
  border: 1px solid #1F222A;
  padding: 0.75rem 1rem;
  border-radius: 0.75rem;
  overflow-x: auto;
  margin-bottom: 0.75rem;
}
.markdown-body pre code {
  background-color: transparent;
  color: #E2E8F0;
  padding: 0;
}
.markdown-body blockquote {
  border-left: 3px solid #6366F1;
  padding-left: 0.75rem;
  color: #94A3B8;
  font-style: italic;
  margin-bottom: 0.75rem;
}
.markdown-body table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 0.75rem;
}
.markdown-body th, .markdown-body td {
  border: 1px solid #2D3748;
  padding: 0.4rem 0.75rem;
  text-align: left;
}
.markdown-body th {
  background-color: #1A1D26;
  font-weight: 600;
}
</style>
