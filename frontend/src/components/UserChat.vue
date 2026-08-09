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

    <div v-if="isMobileMenuOpen" @click="isMobileMenuOpen = false" class="fixed inset-0 z-40 bg-black/60 md:hidden"></div>


    <!-- pb-24 on mobile keeps the last nav items clear of the floating bottom bar, which
         sits above the drawer and used to cover them. -->
    <aside :class="['w-72 shrink-0 border-r border-[#1F222A] bg-[#111317] flex flex-col justify-between p-4 pb-24 md:pb-4 z-40 transition-all duration-300 md:static fixed inset-y-0 left-0 h-full overflow-hidden', isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0']">

      <div class="flex items-center justify-between gap-2 px-2 pb-3 border-b border-[#1F222A] shrink-0">
        <!-- min-w-0 + truncate: without them the workspace name wrapped onto three lines
             and pushed the drawer's action buttons out of reach. -->
        <div class="flex items-center gap-3 group cursor-pointer min-w-0">
          <div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-600 to-indigo-700 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 border border-indigo-400/30 shrink-0 group-hover:scale-105 transition-transform duration-300">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
          </div>
          <div class="min-w-0">
            <span class="font-bold text-sm tracking-tight text-white block truncate">Jarvis AI Workspace</span>
            <span class="text-[10px] text-indigo-400 font-mono block truncate">Store Hadiya POS v2</span>
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
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
        <div :class="['flex items-center justify-between px-2 pb-2 pt-1 sticky top-0 z-10 border-b', isLightTheme ? 'bg-white/90 border-slate-200' : 'bg-[#111317] border-[#1F222A]/50']">
          <span :class="['text-[10px] font-bold tracking-widest uppercase', isLightTheme ? 'text-slate-500' : 'text-gray-500']">Mavjud Chatlar</span>
          <button v-if="conversations.length > 0" @click="promptClearAllChats" :class="['text-[10px] transition font-medium', isLightTheme ? 'text-slate-500 hover:text-red-500' : 'text-gray-400 hover:text-red-400']">Tozalash</button>
        </div>

        <div 
          v-for="conv in conversations" 
          :key="conv.id"
          @click="selectConversation(conv.id)"
          :class="[
            'flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs cursor-pointer transition-all border group gap-2', 
            activeConvId === conv.id 
              ? (isLightTheme ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white font-semibold border-indigo-600 shadow-md shadow-indigo-500/20' : 'bg-gradient-to-r from-[#1D212C] to-[#171922] text-white font-semibold border-indigo-500/60 shadow-lg shadow-indigo-500/10')
              : (isLightTheme ? 'bg-white/90 text-slate-800 border-slate-200/80 hover:bg-indigo-50/80 hover:border-indigo-300 hover:text-indigo-900 shadow-sm' : 'bg-[#14161C]/80 text-gray-300 border-[#1F222A] hover:bg-[#1A1D26] hover:border-[#2D3242] hover:text-white')
          ]"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <div :class="['w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-colors', activeConvId === conv.id ? (isLightTheme ? 'bg-white/20 text-white' : 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/40') : (isLightTheme ? 'bg-slate-100 text-slate-500 group-hover:text-indigo-600' : 'bg-[#1A1D26] text-gray-400 group-hover:text-indigo-400')]">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
              </svg>
            </div>
            <span class="truncate font-medium">{{ conv.title }}</span>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button @click.stop="promptDeleteChat(conv.id)" :class="[isLightTheme ? 'text-slate-400 hover:text-red-500 hover:bg-red-50' : 'text-gray-400 hover:text-red-400 hover:bg-[#252834]', 'p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200']" title="Chatni o'chirish">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
            <svg v-if="conv.isPinned" class="w-3.5 h-3.5 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/>
            </svg>
          </div>
        </div>
      </div>

      <!-- Bottom Stack: Primary Navigation & User Profile Card -->
      <div :class="['shrink-0 space-y-2 border-t pt-3', isLightTheme ? 'border-slate-200' : 'border-[#1F222A]']">
        <!-- AI Executive Chat Button -->
        <button 
          @click="toggleViewMode('chat')"
          :class="[
            'w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all duration-200 border group relative overflow-hidden',
            activeViewMode === 'chat'
              ? (isLightTheme ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white border-indigo-600 shadow-md shadow-indigo-500/20' : 'bg-gradient-to-r from-indigo-600/35 via-purple-600/25 to-indigo-600/10 text-white border-indigo-500/70 shadow-xl shadow-indigo-500/15')
              : (isLightTheme ? 'bg-white/80 text-slate-700 border-slate-200 hover:bg-slate-100' : 'bg-[#14161C] text-gray-300 border-[#1F222A] hover:bg-[#1A1D26] hover:border-[#2D3242] hover:text-white')
          ]"
        >
          <div class="flex items-center gap-3">
            <div :class="[
              'w-7 h-7 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 shadow-md',
              activeViewMode === 'chat'
                ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-indigo-500/30'
                : 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-500'
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
              ? (isLightTheme ? 'bg-gradient-to-r from-emerald-600 to-teal-700 text-white border-emerald-600 shadow-md shadow-emerald-500/20' : 'bg-gradient-to-r from-emerald-600/35 via-teal-600/25 to-emerald-600/10 text-white border-emerald-500/70 shadow-xl shadow-emerald-500/15')
              : (isLightTheme ? 'bg-white/80 text-slate-700 border-slate-200 hover:bg-slate-100' : 'bg-[#14161C] text-gray-300 border-[#1F222A] hover:bg-[#1A1D26] hover:border-[#2D3242] hover:text-white')
          ]"
        >
          <div class="flex items-center gap-3">
            <div :class="[
              'w-7 h-7 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 shadow-md',
              activeViewMode === 'calendar'
                ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-emerald-500/30'
                : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-500'
            ]">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
              </svg>
            </div>
            <span class="tracking-tight">Calendar Workspace</span>
          </div>
          <span class="text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 border border-emerald-500/40 shadow-sm flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
            New
          </span>
        </button>

        <!-- My Projects & Knowledge Hub Button -->
        <button 
          @click="toggleViewMode('projects')"
          :class="[
            'w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all duration-200 border group relative overflow-hidden',
            activeViewMode === 'projects'
              ? (isLightTheme ? 'bg-gradient-to-r from-purple-600 to-indigo-700 text-white border-purple-600 shadow-md shadow-purple-500/20' : 'bg-gradient-to-r from-purple-600/35 via-indigo-600/25 to-purple-600/10 text-white border-purple-500/70 shadow-xl shadow-purple-500/15')
              : (isLightTheme ? 'bg-white/80 text-slate-700 border-slate-200 hover:bg-slate-100' : 'bg-[#14161C] text-gray-300 border-[#1F222A] hover:bg-[#1A1D26] hover:border-[#2D3242] hover:text-white')
          ]"
        >
          <div class="flex items-center gap-3">
            <div :class="[
              'w-7 h-7 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 shadow-md',
              activeViewMode === 'projects'
                ? 'bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-purple-500/30'
                : 'bg-purple-500/15 border border-purple-500/30 text-purple-500'
            ]">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
              </svg>
            </div>
            <span class="tracking-tight">My Projects & Knowledge</span>
          </div>
          <span class="text-[9px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-600 border border-purple-500/40">Hub</span>
        </button>

        <!-- User Profile Card -->
        <div @click="isUserSettingsOpen = true" :class="['border-t pt-2.5 flex items-center justify-between px-2 cursor-pointer group p-1.5 rounded-2xl transition-all duration-200 mt-1', isLightTheme ? 'border-slate-200 hover:bg-indigo-50/60' : 'border-[#1F222A] hover:bg-[#161820]']">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-9 h-9 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 border border-indigo-400/40 group-hover:border-indigo-400 flex items-center justify-center font-bold text-white text-xs shadow-lg shadow-indigo-500/20 shrink-0 group-hover:scale-105 transition-transform">
              A
            </div>
            <div class="truncate">
              <div :class="['text-xs font-bold transition truncate', isLightTheme ? 'text-slate-800 group-hover:text-indigo-600' : 'text-white group-hover:text-indigo-300']">Azamjon (Store Hadiya)</div>
              <div class="text-[10px] text-emerald-600 font-mono flex items-center gap-1 font-bold">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                BILLZ POS Admin
              </div>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button @click.stop="$emit('logout')" :class="['p-1.5 rounded-xl transition border', isLightTheme ? 'text-slate-500 hover:text-red-600 hover:bg-red-50 border-slate-200' : 'text-gray-400 hover:text-red-400 hover:bg-red-500/10 border-transparent hover:border-red-500/20']" title="Tizimdan Chiqish (Logout)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
            </button>
          </div>
        </div>
      </div>
    </aside>

    <!-- Main Chat Window -->
    <!-- min-w-0: a flex item defaults to min-width:auto, so this column refused to shrink
         below its widest child and its right edge (action buttons, day columns, the chat
         input) was clipped by the shell's overflow-hidden on narrow windows. -->
    <main class="flex-1 min-w-0 flex flex-col justify-between h-full bg-[#0B0C0E] relative">
      <!-- Header Bar -->
      <header class="min-h-16 pt-[env(safe-area-inset-top)] border-b border-[#1F222A] flex items-center justify-between px-4 sm:px-6 bg-[#111317] z-20">
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
          <!-- Apple / Raycast Style Segmented Theme Switch -->
          <button 
            @click="toggleTheme" 
            class="relative inline-grid grid-cols-2 p-1 rounded-full backdrop-blur-md transition-all duration-300 border shadow-md shrink-0 cursor-pointer select-none group"
            :class="isLightTheme 
              ? 'bg-slate-200/90 border-slate-300/80 hover:border-slate-400' 
              : 'bg-[#161820]/90 border-white/10 hover:border-white/20'"
            :title="isLightTheme ? 'Tungi rejimga o\'tish (Dark)' : 'Kunduzgi rejimga o\'tish (Light)'"
          >
            <!-- Smooth Sliding Thumb Background Indicator -->
            <div 
              class="absolute top-1 bottom-1 rounded-full transition-all duration-300 ease-out shadow-sm border pointer-events-none"
              :class="isLightTheme 
                ? 'left-1 w-[calc(50%-4px)] bg-white border-amber-400/50 shadow-amber-500/20' 
                : 'left-[calc(50%+2px)] w-[calc(50%-4px)] bg-gradient-to-r from-indigo-600 to-purple-600 border-indigo-400/50 shadow-indigo-500/40'"
            ></div>

            <!-- Light Side (Sun) -->
            <div 
              class="relative z-10 flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-full transition-colors duration-300"
              :class="isLightTheme ? 'text-amber-700 font-extrabold' : 'text-gray-400 group-hover:text-gray-200'"
            >
              <svg class="w-3.5 h-3.5 shrink-0 transition-transform duration-300 group-hover:rotate-45" :class="isLightTheme ? 'text-amber-600 stroke-[2.5]' : 'text-gray-400'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <span class="text-xs hidden sm:inline select-none font-bold tracking-tight whitespace-nowrap">Kunduzgi</span>
            </div>

            <!-- Dark Side (Moon) -->
            <div 
              class="relative z-10 flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-full transition-colors duration-300"
              :class="!isLightTheme ? 'text-white font-extrabold' : 'text-slate-500 group-hover:text-slate-700'"
            >
              <svg class="w-3.5 h-3.5 shrink-0 transition-transform duration-300 group-hover:-rotate-12" :class="!isLightTheme ? 'text-white stroke-[2.5]' : 'text-slate-500'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
              <span class="text-xs hidden sm:inline select-none font-bold tracking-tight whitespace-nowrap">Tungi</span>
            </div>
          </button>

          <!-- User Settings Button -->
          <button 
            @click="toggleViewMode('settings')" 
            :class="[
              'text-xs font-bold px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl transition-all shadow-lg flex items-center gap-1.5 border cursor-pointer',
              activeViewMode === 'settings'
                ? 'bg-indigo-600 text-white border-indigo-500 shadow-indigo-600/30'
                : (isLightTheme 
                  ? 'text-slate-800 bg-white/90 border-slate-300 hover:bg-slate-100 hover:border-slate-400' 
                  : 'text-indigo-300 hover:text-white bg-gradient-to-r from-indigo-950/60 to-purple-950/60 hover:from-indigo-900/80 hover:to-purple-900/80 border-indigo-500/30 hover:border-indigo-500/60 shadow-indigo-950/30')
            ]"
          >
            <div class="w-4 h-4 sm:w-5 sm:h-5 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
              <svg class="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
            </div>
            <span class="hidden sm:inline">Sozlamalar</span>
          </button>
        </div>
      </header>

      <!-- CALENDAR WORKSPACE VIEW -->
      <CalendarWorkspace v-if="activeViewMode === 'calendar'" />

      <!-- MY PROJECTS & KNOWLEDGE HUB VIEW -->
      <KnowledgeWorkspace 
        v-else-if="activeViewMode === 'projects'" 
        @switch-to-chat="handleSwitchToChat" 
      />

      <!-- USER SETTINGS WORKSPACE VIEW -->
      <UserSettingsWorkspace 
        v-else-if="activeViewMode === 'settings'" 
        @switch-to-chat="toggleViewMode('chat')" 
      />

      <!-- Message History Container (WHEN IN CHAT VIEW MODE) -->
      <div v-else ref="chatContainer" class="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 max-w-4xl w-full mx-auto scroll-smooth">
        <!-- Welcome Screen -->
        <div v-if="messages.length === 0" class="h-full flex flex-col items-center justify-center text-center my-auto space-y-6 pt-6 pb-10">
          <!-- Glowing AI Hexagon Badge -->
          <div class="relative group">
            <div class="absolute -inset-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500 rounded-3xl blur opacity-25 group-hover:opacity-50 transition duration-500"></div>
            <div :class="['relative w-16 h-16 rounded-2xl border flex items-center justify-center shadow-2xl transition', isLightTheme ? 'bg-white/90 border-slate-300 shadow-slate-400/40 text-indigo-600' : 'bg-[#14161C] border-white/10 text-indigo-400']">
              <svg class="w-8 h-8 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M13 10V3L4 14h7v7l9-11h-7z"/>
              </svg>
            </div>
          </div>

          <div class="space-y-2 max-w-lg">
            <div :class="['inline-flex items-center gap-2 px-3.5 py-1 rounded-full border text-xs font-bold shadow-sm', isLightTheme ? 'bg-white/90 border-indigo-200 text-indigo-700 shadow-slate-300/30' : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-300']">
              <span>Assalomu alaykum, Azamjon! 👋</span>
            </div>
            <h1 :class="['text-2xl sm:text-3xl font-black tracking-tight', isLightTheme ? 'text-slate-900 drop-shadow-sm' : 'text-white']">Jarvis AI Executive Assistant</h1>
            <p :class="['text-xs sm:text-sm max-w-md mx-auto leading-relaxed font-semibold', isLightTheme ? 'text-slate-700' : 'text-gray-400']">
              Biznes integratsiyalaringiz, savdo hisobotlari, mahsulotlar bazasi va avtomatlashtirilgan eslatmalarni boshqaring.
            </p>
          </div>

          <!-- Quick Actions Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5 w-full max-w-xl text-left pt-2">
            <div 
              @click="openVoiceModal()" 
              :class="[
                'p-4 rounded-2xl border transition group shadow-md cursor-pointer',
                isLightTheme 
                  ? 'bg-white/90 backdrop-blur-md border-purple-300 hover:border-purple-500 hover:bg-white shadow-slate-400/20 hover:shadow-lg' 
                  : 'bg-[#161420] border-purple-500/25 hover:bg-[#1D1B2A] hover:border-purple-500/50'
              ]"
            >
              <div :class="['text-xs font-extrabold flex items-center justify-between', isLightTheme ? 'text-purple-950 group-hover:text-purple-700' : 'text-purple-200 group-hover:text-white']">
                <span class="flex items-center gap-2">
                  <svg class="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/>
                  </svg>
                  Ovozli Murojaat (Live Mic)
                </span>
                <span :class="['font-mono text-[9px] px-2 py-0.5 rounded-full border font-extrabold', isLightTheme ? 'bg-purple-100 text-purple-800 border-purple-300' : 'bg-purple-500/20 text-purple-300 border-purple-400/30']">LIVE MIC</span>
              </div>
              <p :class="['text-[11px] mt-2 font-medium', isLightTheme ? 'text-slate-700' : 'text-gray-400']">Mikrofon orqali ovozli topshiriq bering...</p>
            </div>

            <div 
              @click="sendQuick('Do\'kondagi Rolex soatlari narxi va qoldig\'i haqida ma\'lumot ber.')" 
              :class="[
                'p-4 rounded-2xl border transition group shadow-md cursor-pointer',
                isLightTheme 
                  ? 'bg-white/90 backdrop-blur-md border-slate-300 hover:border-emerald-500 hover:bg-white shadow-slate-400/20 hover:shadow-lg' 
                  : 'bg-[#14161C] border-[#1F222A] hover:border-indigo-500/40 hover:bg-[#191C24]'
              ]"
            >
              <div :class="['text-xs font-extrabold flex items-center justify-between', isLightTheme ? 'text-slate-900 group-hover:text-emerald-700' : 'text-white group-hover:text-indigo-300']">
                <span class="flex items-center gap-2">
                  <svg class="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
                  </svg>
                  Mahsulotlar Qoldig'i & Narxi
                </span>
                <svg :class="['w-4 h-4 group-hover:translate-x-1 transition', isLightTheme ? 'text-slate-500' : 'text-gray-500']" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
              </div>
              <p :class="['text-[11px] mt-2 font-medium', isLightTheme ? 'text-slate-700' : 'text-gray-400']">"Do'kondagi mahsulotlar narxi va qoldig'ini tekshir."</p>
            </div>

            <div 
              @click="sendQuick('Bugungi kunlik biznes va savdo hisobotini chiqar.')" 
              :class="[
                'p-4 rounded-2xl border transition group shadow-md cursor-pointer',
                isLightTheme 
                  ? 'bg-white/90 backdrop-blur-md border-slate-300 hover:border-indigo-500 hover:bg-white shadow-slate-400/20 hover:shadow-lg' 
                  : 'bg-[#14161C] border-[#1F222A] hover:border-indigo-500/40 hover:bg-[#191C24]'
              ]"
            >
              <div :class="['text-xs font-extrabold flex items-center justify-between', isLightTheme ? 'text-slate-900 group-hover:text-indigo-700' : 'text-white group-hover:text-indigo-300']">
                <span class="flex items-center gap-2">
                  <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 012-2h2a2 2 0 012 2v6m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
                  </svg>
                  Kunlik Savdo Hisoboti
                </span>
                <svg :class="['w-4 h-4 group-hover:translate-x-1 transition', isLightTheme ? 'text-slate-500' : 'text-gray-500']" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
              </div>
              <p :class="['text-[11px] mt-2 font-medium', isLightTheme ? 'text-slate-700' : 'text-gray-400']">"Bugungi jami savdo va tushumlarni chiqar."</p>
            </div>

            <div 
              @click="sendQuick('Har kuni soat 19:00 da kunlik hisobotni Telegramga yuborib tur.')" 
              :class="[
                'p-4 rounded-2xl border transition group shadow-md cursor-pointer',
                isLightTheme 
                  ? 'bg-white/90 backdrop-blur-md border-slate-300 hover:border-amber-500 hover:bg-white shadow-slate-400/20 hover:shadow-lg' 
                  : 'bg-[#14161C] border-[#1F222A] hover:border-indigo-500/40 hover:bg-[#191C24]'
              ]"
            >
              <div :class="['text-xs font-bold flex items-center justify-between', isLightTheme ? 'text-slate-800 group-hover:text-amber-700' : 'text-white group-hover:text-indigo-300']">
                <span class="flex items-center gap-2">
                  <svg class="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                  </svg>
                  Kunlik Telegram Eslatma
                </span>
                <svg :class="['w-4 h-4 group-hover:translate-x-1 transition', isLightTheme ? 'text-slate-400' : 'text-gray-500']" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
              </div>
              <p :class="['text-[11px] mt-2', isLightTheme ? 'text-slate-600' : 'text-gray-400']">"Har kuni 19:00 da Telegramga savdoni yubor."</p>
            </div>
          </div>
        </div>

        <!-- Chat Messages -->
        <div v-else v-for="msg in messages" :key="msg.id" class="space-y-3">
          <!-- User Bubble -->
          <div v-if="msg.role === 'user'" class="flex justify-end group">
            <div class="space-y-1 max-w-xl">
              <div class="bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm shadow-sm space-y-2.5">
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

              <!-- User Message Action Toolbar (Nusxalash, Javob berish) -->
              <div class="flex items-center justify-end gap-2 opacity-90 hover:opacity-100 transition-all duration-200 text-xs font-semibold select-none pt-1">
                <button 
                  @click="copyMessageText(msg)" 
                  :class="[
                    'px-3 py-1.5 rounded-xl border transition-all duration-200 flex items-center gap-1.5 shadow-sm cursor-pointer',
                    isLightTheme 
                      ? 'bg-white/90 border-slate-200 text-slate-700 hover:text-indigo-600 hover:bg-white hover:border-indigo-300' 
                      : 'bg-[#181A22] border-white/10 text-gray-300 hover:text-white hover:border-indigo-500/40'
                  ]"
                  title="Matnni nusxalash"
                >
                  <svg class="w-3.5 h-3.5 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                  </svg>
                  <span>{{ copiedMessageId === msg.id ? '✓ Nusxalandi' : 'Nusxalash' }}</span>
                </button>

                <button 
                  @click="replyToMsg(msg)" 
                  :class="[
                    'px-3 py-1.5 rounded-xl border transition-all duration-200 flex items-center gap-1.5 shadow-sm cursor-pointer',
                    isLightTheme 
                      ? 'bg-white/90 border-slate-200 text-slate-700 hover:text-indigo-600 hover:bg-white hover:border-indigo-300' 
                      : 'bg-[#181A22] border-white/10 text-gray-300 hover:text-white hover:border-indigo-500/40'
                  ]"
                  title="Ushbu xabarga javob berish"
                >
                  <svg class="w-3.5 h-3.5 text-purple-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
                  </svg>
                  <span>Javob berish</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Assistant Bubble -->
          <div v-else class="flex gap-3 group">
            <div class="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white text-xs shrink-0 shadow-sm">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
              </svg>
            </div>
            <div class="flex-1 space-y-2">
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

              <!-- Message Content with Markdown Parsing -->
              <div class="bg-[#14161C] border border-[#1F222A] rounded-2xl rounded-tl-sm p-4 text-sm text-gray-200 leading-relaxed markdown-body shadow-sm" v-html="renderMarkdown(msg.content)"></div>

              <!-- Contact Disambiguation: AI found 2+ plausible people for the same name and
                   is asking which one, instead of guessing and messaging the wrong person. -->
              <div v-if="msg.clarificationOptions && msg.clarificationOptions.length" class="flex flex-wrap gap-2 pt-1">
                <button
                  v-for="(opt, oi) in msg.clarificationOptions"
                  :key="oi"
                  @click="resolveClarification(msg, opt)"
                  :disabled="msg.clarificationResolved"
                  class="px-3.5 py-2 rounded-xl border border-indigo-500/40 bg-indigo-600/10 text-indigo-300 hover:bg-indigo-600/20 hover:text-white text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {{ opt.label }}
                </button>
              </div>

              <!-- Assistant Message Action Toolbar (Nusxalash, Javob berish, Qayta tahlil qilish) -->
              <div class="flex items-center gap-2 transition-all duration-200 text-xs font-semibold select-none pt-1">
                <button 
                  @click="copyMessageText(msg)" 
                  :class="[
                    'px-3 py-1.5 rounded-xl border transition-all duration-200 flex items-center gap-1.5 shadow-sm cursor-pointer',
                    isLightTheme 
                      ? 'bg-white/90 border-slate-200 text-slate-700 hover:text-indigo-600 hover:bg-white hover:border-indigo-300 hover:shadow' 
                      : 'bg-[#181A22] border-white/10 text-gray-300 hover:text-white hover:border-indigo-500/40 hover:bg-[#1E212C]'
                  ]"
                  title="Javob matnini nusxalash"
                >
                  <svg class="w-3.5 h-3.5 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                  </svg>
                  <span>{{ copiedMessageId === msg.id ? '✓ Nusxalandi' : 'Nusxalash' }}</span>
                </button>

                <button 
                  @click="replyToMsg(msg)" 
                  :class="[
                    'px-3 py-1.5 rounded-xl border transition-all duration-200 flex items-center gap-1.5 shadow-sm cursor-pointer',
                    isLightTheme 
                      ? 'bg-white/90 border-slate-200 text-slate-700 hover:text-indigo-600 hover:bg-white hover:border-indigo-300 hover:shadow' 
                      : 'bg-[#181A22] border-white/10 text-gray-300 hover:text-white hover:border-indigo-500/40 hover:bg-[#1E212C]'
                  ]"
                  title="AI javobiga javob yozish"
                >
                  <svg class="w-3.5 h-3.5 text-purple-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
                  </svg>
                  <span>Javob berish</span>
                </button>

                <button 
                  @click="regenerateMessage(msg)" 
                  :class="[
                    'px-3 py-1.5 rounded-xl border transition-all duration-200 flex items-center gap-1.5 shadow-sm cursor-pointer',
                    isLightTheme 
                      ? 'bg-white/90 border-slate-200 text-slate-700 hover:text-indigo-600 hover:bg-white hover:border-indigo-300 hover:shadow' 
                      : 'bg-[#181A22] border-white/10 text-gray-300 hover:text-white hover:border-indigo-500/40 hover:bg-[#1E212C]'
                  ]"
                  title="Qayta tahlil qilib yangi javob olish"
                >
                  <svg class="w-3.5 h-3.5 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                  </svg>
                  <span>Qayta tahlil qilish</span>
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
            <span class="font-semibold tracking-wide text-indigo-200 transition-all duration-300">{{ loadingStepText || "🧠 So'rov tahlil qilinmoqda..." }}</span>
          </div>
        </div>
      </div>

      <!-- Gemini Style Floating Input Pill Footer -->
      <footer class="p-4 sm:p-6 bg-[#0B0C0E] mb-[76px] md:mb-0 relative z-30">
        <div class="max-w-3xl w-full mx-auto space-y-2">

          <!-- REPLY PREVIEW BAR -->
          <div 
            v-if="replyToMessage" 
            class="flex items-center justify-between px-4 py-2.5 rounded-2xl border transition-all duration-200 shadow-lg select-none mb-2"
            :class="isLightTheme 
              ? 'bg-white/95 border-indigo-300 text-indigo-950 shadow-slate-300/40' 
              : 'bg-[#1A1C26] border-indigo-500/40 text-indigo-200 shadow-xl'"
          >
            <div class="flex items-center gap-2 min-w-0">
              <svg class="w-4 h-4 text-indigo-500 shrink-0 transform -scale-x-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
              </svg>
              <span class="font-extrabold text-xs shrink-0 text-indigo-600 dark:text-indigo-400">{{ replyToMessage.author }} ga javob:</span>
              <span class="text-xs truncate italic" :class="isLightTheme ? 'text-slate-800' : 'text-gray-300'">"{{ replyToMessage.snippet }}"</span>
            </div>
            <button 
              @click="cancelReply" 
              class="p-1 rounded-lg hover:bg-red-500/10 text-gray-400 hover:text-red-500 transition shrink-0 ml-2 cursor-pointer" 
              title="Bekor qilish"
            >
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
          <div 
            :class="[
              'flex items-center gap-3 rounded-[26px] px-3.5 py-2 transition-all border shadow-xl',
              isLightTheme 
                ? 'bg-white border-indigo-500/30 text-slate-800 shadow-indigo-500/10 focus-within:border-indigo-600 focus-within:ring-2 focus-within:ring-indigo-500/20' 
                : 'bg-[#1E1F24] border-[#2C2D33] text-white focus-within:border-indigo-500/50'
            ]"
          >
            <!-- Left: Attachment (+) Button -->
            <button 
              @click="triggerFileInput" 
              :class="[
                'w-8 h-8 rounded-full flex items-center justify-center transition shrink-0 my-auto',
                isLightTheme 
                  ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border border-indigo-200' 
                  : 'bg-[#2A2B32] hover:bg-[#34353E] text-gray-300'
              ]" 
              title="Attach file or image"
            >
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
              :class="[
                'flex-1 bg-transparent text-sm focus:outline-none px-1 resize-none max-h-[300px] overflow-y-auto leading-relaxed py-1 font-sans my-auto',
                isLightTheme ? 'text-slate-800 placeholder-slate-400 font-medium' : 'text-white placeholder-[#8E9196]'
              ]"
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
                :class="[
                  'w-8 h-8 rounded-full flex items-center justify-center font-bold shadow-md transition shrink-0 my-auto',
                  isLightTheme 
                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:opacity-95' 
                    : 'bg-white text-black hover:bg-gray-200'
                ]"
                title="Ovozli Yozish (Voice Mode)"
              >
                <svg :class="['w-4 h-4', isLightTheme ? 'text-white' : 'text-black']" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

      <button @click="toggleViewMode('settings')" class="flex flex-col items-center gap-1 px-3.5 py-1.5 rounded-xl text-[10px] font-semibold transition" :class="activeViewMode === 'settings' ? 'text-indigo-400 bg-indigo-500/10 border border-indigo-500/20' : 'text-gray-400'">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
        <span>Sozlamalar</span>
      </button>
    </nav>
  </div>
</template>

<script>
import axios from 'axios';
import { nextTick } from 'vue';
import { marked } from 'marked';
import { VoiceController, RECORDING_STATE } from '../services/voiceController';
import { API_BASE } from '../services/api';
import chatService from '../services/chatService';
import themeService from '../services/themeService';
import CalendarWorkspace from './CalendarWorkspace.vue';
import KnowledgeWorkspace from './KnowledgeWorkspace.vue';
import UserSettingsWorkspace from './UserSettingsWorkspace.vue';

marked.setOptions({
  gfm: true,
  breaks: true
});

/**
 * Swaps the emoji the backend writes for line-art icons (Lucide geometry) once the
 * markdown is HTML.
 *
 * The emoji stay in the stored message and in every other channel (Telegram, e-mail),
 * so this is a rendering upgrade only — nothing downstream depends on the markup.
 * Each entry is the icon's inner geometry; `tone` picks the accent so a report reads
 * as one system: money green, warnings amber, returns rose, everything else indigo.
 */
const MD_ICONS = {
  '📅': { tone: 'accent', d: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>' },
  '📆': { tone: 'accent', d: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/>' },
  '🏪': { tone: 'accent', d: '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/>' },
  '🏬': { tone: 'accent', d: '<path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/><path d="M6 18h12"/><path d="M6 14h12"/><rect width="12" height="12" x="6" y="10"/>' },
  '🧾': { tone: 'accent', d: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>' },
  '📦': { tone: 'accent', d: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>' },
  '🛒': { tone: 'accent', d: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>' },
  '💳': { tone: 'accent', d: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>' },
  '💰': { tone: 'money', d: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>' },
  '💵': { tone: 'money', d: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>' },
  '📈': { tone: 'money', d: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>' },
  '📊': { tone: 'accent', d: '<path d="M3 3v18h18"/><rect width="4" height="7" x="7" y="10" rx="1"/><rect width="4" height="12" x="15" y="5" rx="1"/>' },
  '↩️': { tone: 'warn2', d: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>' },
  '⚠️': { tone: 'warn', d: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>' },
  'ℹ️': { tone: 'accent', d: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>' },
  '📬': { tone: 'accent', d: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>' },
  '📝': { tone: 'accent', d: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>' },
  '👤': { tone: 'accent', d: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' },
  '👥': { tone: 'accent', d: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
  '🕒': { tone: 'accent', d: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
  '📎': { tone: 'accent', d: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>' },
  '📄': { tone: 'accent', d: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>' },
  '🗂️': { tone: 'accent', d: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>' },
  '💬': { tone: 'accent', d: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
  '⬅️': { tone: 'accent', d: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>' },
  '➡️': { tone: 'money', d: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>' },
  '🔍': { tone: 'accent', d: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>' },
  '✅': { tone: 'money', d: '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>' },
  '❌': { tone: 'warn2', d: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>' }
};

const MD_ICON_RE = new RegExp(
  Object.keys(MD_ICONS).map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'g'
);

function decorateIcons(html) {
  // Leave code samples alone — an emoji inside <code>/<pre> is content, not decoration.
  return html.split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/).map((chunk, i) => {
    if (i % 2 === 1) return chunk;
    return chunk.replace(MD_ICON_RE, (emoji) => {
      const icon = MD_ICONS[emoji];
      return `<svg class="md-icon md-icon--${icon.tone}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
             `stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon.d}</svg>`;
    });
  }).join('');
}

export default {
  components: {
    CalendarWorkspace,
    KnowledgeWorkspace,
    UserSettingsWorkspace
  },
  data() {
    return {
      activeConvId: null,
      isMobileMenuOpen: false,
      isLightTheme: themeService.getTheme() === 'light',
      conversations: [],
      messages: [],
      schedules: [],
      inputQuery: '',
      isLoading: false,

      // Reply & Copy States
      replyToMessage: null,
      copiedMessageId: null,

      // Image Lightbox Preview States
      isPreviewImageOpen: false,
      previewImageSrc: null,

      // File Drag & Drop & Attachment States
      isLoading: false,
      loadingStepText: '',
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
    themeService.initTheme();
    this.isLightTheme = themeService.getTheme() === 'light';
    this.fetchConversations();
    this.activeConvId = null;
    this.messages = [];
    this.fetchSchedules();
    this.fetchOwnerProfile();
  },
  beforeUnmount() {
    if (this.voiceController) {
      this.voiceController.cancel();
    }
  },
  methods: {
    toggleTheme() {
      const next = themeService.toggleTheme();
      this.isLightTheme = next === 'light';
    },
    toggleViewMode(mode) {
      this.activeViewMode = mode;
      if (mode === 'projects') {
        this.fetchMemoryItems();
      }
    },
    async fetchMemoryItems() {
      try {
        const res = await axios.get(`${API_BASE}/api/chat/memory/items`);
        if (res.data && res.data.items) {
          this.memoryItems = res.data.items;
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
        await axios.post(`${API_BASE}/api/chat/memory/upload`, {
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
        await axios.delete(`${API_BASE}/api/chat/memory/items/${id}`);
        await this.fetchMemoryItems();
      } catch (e) {}
    },
    handleSwitchToChat(prompt) {
      this.activeViewMode = 'chat';
      if (prompt && typeof prompt === 'string') {
        this.inputQuery = prompt;
      }
    },
    queryAiAboutMemory(item) {
      this.activeViewMode = 'chat';
      this.inputQuery = `"${item.title}" xotira hujjati bo'yicha tahlil bering va undagi sotuv logikalarini tushuntiring.`;
    },
    async fetchOwnerProfile() {
      try {
        const res = await axios.get(`${API_BASE}/api/chat/owner/profile`);
        if (res.data && res.data.profile) {
          this.ownerTitle = res.data.profile.title || this.ownerTitle;
          this.ownerCharacterPrompt = res.data.profile.content || this.ownerCharacterPrompt;
        }
      } catch (e) {}
    },
    async saveOwnerProfile() {
      this.isSavingOwnerProfile = true;
      try {
        await axios.post(`${API_BASE}/api/chat/owner/profile`, {
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
          const trRes = await axios.post(`${API_BASE}/api/chat/transcribe-audio`, {
            spokenText: textToSend,
            audioBase64: base64Audio,
            lang: this.selectedVoiceLang
          });

          if (trRes.data && trRes.data.transcribedText) {
            textToSend = trRes.data.transcribedText;
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
    copyMessageText(msg) {
      if (!msg || !msg.content) return;
      const rawText = msg.content.replace(/<[^>]*>/g, '');
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(rawText).then(() => {
          this.copiedMessageId = msg.id;
          setTimeout(() => {
            if (this.copiedMessageId === msg.id) this.copiedMessageId = null;
          }, 2000);
        }).catch(() => {
          this.fallbackCopy(rawText, msg.id);
        });
      } else {
        this.fallbackCopy(rawText, msg.id);
      }
    },
    fallbackCopy(text, msgId) {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        this.copiedMessageId = msgId;
        setTimeout(() => {
          if (this.copiedMessageId === msgId) this.copiedMessageId = null;
        }, 2000);
      } catch (err) {}
      document.body.removeChild(textArea);
    },
    replyToMsg(msg) {
      if (!msg) return;
      const author = msg.role === 'user' ? 'Azamjon' : 'Jarvis AI Assistant';
      const snippet = (msg.content || '').replace(/\s+/g, ' ').trim();
      const truncatedSnippet = snippet.length > 80 ? snippet.slice(0, 80) + '...' : snippet;
      this.replyToMessage = {
        id: msg.id,
        role: msg.role,
        author,
        snippet: truncatedSnippet,
        rawSnippet: snippet
      };
      nextTick(() => {
        if (this.$refs.inputQueryRef) {
          this.$refs.inputQueryRef.focus();
        }
      });
    },
    cancelReply() {
      this.replyToMessage = null;
    },
    async regenerateMessage(msg) {
      if (this.isLoading) return;
      const msgIdx = this.messages.findIndex(m => m.id === msg.id);
      let promptText = '';
      if (msgIdx > 0 && this.messages[msgIdx - 1] && this.messages[msgIdx - 1].role === 'user') {
        promptText = this.messages[msgIdx - 1].content;
      }
      if (!promptText) promptText = "Qayta tahlil qilib javob ber";
      
      this.inputQuery = promptText;
      await this.sendMessage();
    },
    async reloadChatHistory() {
      if (this.activeConvId) {
        await this.fetchMessages(this.activeConvId);
      } else {
        await this.fetchConversations();
      }
    },
    async sendMessage() {
      if ((!this.inputQuery.trim() && !this.attachedFile) || this.isLoading) return;
      const text = this.inputQuery.trim();
      const fileToSend = this.attachedFile;
      const replyPayload = this.replyToMessage ? {
        id: this.replyToMessage.id,
        role: this.replyToMessage.role,
        snippet: this.replyToMessage.rawSnippet || this.replyToMessage.snippet
      } : null;

      this.inputQuery = '';
      this.attachedFile = null;
      this.replyToMessage = null;
      this.adjustTextareaHeight();

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
      this.loadingStepText = "🧠 So'rov tahlil qilinmoqda...";

      try {
        const data = await chatService.sendMessageStream({
          conversationId: this.activeConvId,
          content: text,
          attachedFile: fileToSend,
          replyTo: replyPayload
        }, (evt) => this.handleProgressEvent(evt));

        this.messages.push({
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: data.assistantResponse,
          toolCalls: JSON.stringify(data.executedTools || []),
          clarificationOptions: data.clarificationOptions || null,
          pendingSendText: data.pendingSendText || ''
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
        this.loadingStepText = '';
        this.scrollToBottom();
      }
    },
    async resolveClarification(msg, option) {
      if (msg.clarificationResolved || this.isLoading) return;
      msg.clarificationResolved = true;
      this.isLoading = true;
      this.loadingStepText = '📨 Yuborilmoqda...';

      try {
        const data = await chatService.resolveSend({
          conversationId: this.activeConvId,
          chatIds: option.chatIds,
          text: msg.pendingSendText,
          label: option.label
        });

        this.messages.push({
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: data.assistantResponse,
          toolCalls: JSON.stringify(data.executedTools || [])
        });
      } catch (err) {
        this.messages.push({
          id: `ai-err-${Date.now()}`,
          role: 'assistant',
          content: 'Yuborishda xatolik yuz berdi. Qaytadan urinib ko\'ring.'
        });
      } finally {
        this.isLoading = false;
        this.loadingStepText = '';
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
      this.loadingStepText = "🧠 So'rov tahlil qilinmoqda...";

      try {
        const data = await chatService.sendMessageStream({
          conversationId: this.activeConvId,
          content: userPrompt,
          confirmed: true
        }, (evt) => this.handleProgressEvent(evt));

        msg.content = data.assistantResponse;
        msg.toolCalls = JSON.stringify(data.executedTools || []);

        await this.fetchConversations();
        this.fetchSchedules();
        this.scrollToBottom();
      } catch (err) {
        msg.content = "Xatolik yuz berdi: Backend server bilan ulanishni tekshiring.";
      } finally {
        this.isLoading = false;
        this.loadingStepText = '';
        this.scrollToBottom();
      }
    },
    cancelAction(msg) {
      msg.requiresApproval = false;
      msg.content = "❌ So'rov foydalanuvchi tomonidan bekor qilindi.";
    },
    // Real backend progress (which tool is running, which model is answering) replaces
    // the old canned Billz-flavored loading strings — the backend already sends a
    // human-readable Uzbek `label` for every phase (see TOOL_LABELS in aiEngine.js).
    handleProgressEvent(evt) {
      if (evt && evt.label) this.loadingStepText = evt.label;
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
      // Excel/CSV of newly-arrived goods — flagged so the backend parses rows out of the
      // base64 payload instead of treating it as an opaque, unreadable attachment.
      const isSpreadsheet = /\.(xlsx|xls|csv)$/i.test(file.name);
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
          isSpreadsheet,
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
    },
    renderMarkdown(content) {
      if (!content) return '';
      try {
        const html = decorateIcons(marked.parse(content));
        // Wide report tables (many columns / long product names) must scroll inside their
        // own box instead of squeezing every column unreadably thin on a phone screen.
        return html.replace(/<table>[\s\S]*?<\/table>/g, (table) => `<div class="md-table-scroll">${table}</div>`);
      } catch (err) {
        return content;
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
/* Table sizes to its own content (not squeezed to 100%) so wide tables overflow the
   wrapper instead of cramming every column unreadably thin; min-width keeps a narrow
   table (few columns) stretched to fill the card instead of looking stranded. */
.md-table-scroll {
  overflow-x: auto;
  max-width: 100%;
  margin-bottom: 0.75rem;
  border: 1px solid #2D3748;
  border-radius: 0.6rem;
}
.markdown-body table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  margin-bottom: 0;
}
.md-table-scroll table {
  border: none;
}
.markdown-body th, .markdown-body td {
  border: 1px solid #2D3748;
  padding: 0.3rem 0.55rem;
  font-size: 0.8rem;
  text-align: left;
  white-space: nowrap;
}
.markdown-body th {
  background-color: #1A1D26;
  font-weight: 600;
}

/* Returned goods — money going back out — read red and bold wherever they appear
   (summary line, day headings, and every cell of a returns table). */
.markdown-body .md-danger,
.markdown-body .md-danger * {
  color: #FB7185;
  font-weight: 700;
}
.markdown-body summary .md-danger {
  color: #FB7185;
}
.markdown-body td .md-danger {
  font-weight: 600;
}

html.light .markdown-body .md-danger,
html.light .markdown-body .md-danger * {
  color: #E11D48;
}
html.light .markdown-body summary .md-danger {
  color: #E11D48;
}

/* Line-art icons swapped in for the report emoji (see decorateIcons). */
.markdown-body .md-icon {
  display: inline-block;
  width: 1.05em;
  height: 1.05em;
  vertical-align: -0.18em;
  margin-right: 0.45em;
  color: #818CF8;
  opacity: 0.95;
}
.markdown-body h1 .md-icon,
.markdown-body h2 .md-icon,
.markdown-body h3 .md-icon {
  width: 1em;
  height: 1em;
  vertical-align: -0.12em;
  stroke-width: 2;
}
.markdown-body summary .md-icon {
  width: 0.95em;
  height: 0.95em;
  margin-right: 0.35em;
  color: inherit;
  opacity: 0.85;
}
.markdown-body .md-icon--money { color: #34D399; }
.markdown-body .md-icon--warn { color: #FBBF24; }
.markdown-body .md-icon--warn2 { color: #FB7185; }

/* Headings are white for the dark theme; without this they vanish on a light page. */
html.light .markdown-body h1,
html.light .markdown-body h2,
html.light .markdown-body h3,
html.light .markdown-body h4 {
  color: #0F172A;
}
html.light .markdown-body h1 { border-bottom-color: #E2E8F0; }

html.light .markdown-body .md-icon { color: #4F46E5; }
html.light .markdown-body .md-icon--money { color: #059669; }
html.light .markdown-body .md-icon--warn { color: #D97706; }
html.light .markdown-body .md-icon--warn2 { color: #E11D48; }

/* Collapsible report sections (per-day product tables in Billz period reports). */
.markdown-body details {
  border: 1px solid #262A36;
  border-radius: 0.75rem;
  background-color: #101219;
  margin-bottom: 0.75rem;
  overflow: hidden;
}
.markdown-body details > summary {
  cursor: pointer;
  padding: 0.5rem 0.75rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: #A5B4FC;
  background-color: #171A22;
  list-style: none;
  user-select: none;
  transition: background-color 0.15s;
}
.markdown-body details > summary:hover {
  background-color: #1E2230;
  color: #FFFFFF;
}
.markdown-body details > summary::-webkit-details-marker {
  display: none;
}
.markdown-body details > summary::before {
  content: '▸ ';
  display: inline-block;
  transition: transform 0.15s;
}
.markdown-body details[open] > summary::before {
  content: '▾ ';
}
.markdown-body details[open] > summary {
  border-bottom: 1px solid #262A36;
}
/* Everything after the summary is the panel body. */
.markdown-body details > *:not(summary) {
  margin: 0.6rem 0.75rem;
}
/* `details > *:not(summary)` above already gives the wrapping .md-table-scroll its
   inset margin, same as any other panel content. */

html.light .markdown-body details {
  border-color: #E2E8F0;
  background: #FFFFFF;
}
html.light .markdown-body details > summary {
  background: #F1F5F9;
  color: #4338CA;
}
html.light .markdown-body details > summary:hover {
  background: #E2E8F0;
  color: #1E1B4B;
}
html.light .markdown-body details[open] > summary {
  border-bottom-color: #E2E8F0;
}
</style>
