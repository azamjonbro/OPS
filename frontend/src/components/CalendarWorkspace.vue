<template>
  <div class="flex-1 flex flex-col h-full bg-[#0B0C0E] text-gray-100 overflow-hidden relative">
    
    <!-- TOP EXECUTIVE HEADER BAR -->
    <header class="border-b border-[#1F222A] bg-[#111317] p-4 sm:px-6 z-10 shrink-0">
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 max-w-7xl mx-auto">
        
        <!-- Left: Title & Quick Stats -->
        <div>
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 shrink-0">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
              </svg>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h1 class="text-xl font-bold text-white tracking-tight">AI Executive Calendar</h1>
                <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Google Calendar Synced</span>
              </div>
              <p class="text-xs text-gray-400">Rejalar, uchrashuvlar va AI tomonidan avtomatik taqvim topshiriqlari</p>
            </div>
          </div>
        </div>

        <!-- Middle: View Switcher (Month / Week / Day) -->
        <div class="flex items-center gap-1 bg-[#161820] p-1 rounded-2xl border border-[#232733] self-start lg:self-auto">
          <button 
            @click="currentViewTab = 'month'" 
            :class="['px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all', currentViewTab === 'month' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-[#202430]']"
          >
            Month View
          </button>
          <button 
            @click="currentViewTab = 'week'" 
            :class="['px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all', currentViewTab === 'week' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-[#202430]']"
          >
            Week View
          </button>
          <button 
            @click="currentViewTab = 'day'" 
            :class="['px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all', currentViewTab === 'day' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-[#202430]']"
          >
            Day View
          </button>
        </div>

        <!-- Right: Actions (Sync & Create) -->
        <div class="flex items-center gap-2">
          <button 
            @click="triggerGoogleSync" 
            :disabled="isSyncing"
            class="px-3.5 py-2 rounded-xl bg-[#161922] hover:bg-[#1E2330] border border-indigo-500/20 text-indigo-300 hover:text-white text-xs font-semibold transition flex items-center gap-2"
          >
            <svg :class="['w-4 h-4 text-indigo-400', isSyncing ? 'animate-spin' : '']" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            <span class="hidden sm:inline">{{ isSyncing ? 'Sinxronlanmoqda...' : 'Google Sync' }}</span>
          </button>

          <button 
            @click="openCreateModal" 
            class="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/25 transition flex items-center gap-2"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
            </svg>
            <span>+ Event Yaratish</span>
          </button>
        </div>

      </div>

      <!-- Quick Category Filters & AI Input Banner -->
      <div class="max-w-7xl mx-auto mt-4 pt-3 border-t border-[#1F222A] flex flex-col md:flex-row md:items-center justify-between gap-3">
        <!-- Category Filters -->
        <div class="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none text-xs">
          <button 
            v-for="cat in categories" 
            :key="cat"
            @click="selectedCategoryFilter = cat"
            :class="[
              'px-3 py-1 rounded-lg font-medium transition shrink-0 border',
              selectedCategoryFilter === cat 
                ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500/60 font-semibold' 
                : 'bg-[#14161C] text-gray-400 border-[#1F222A] hover:bg-[#1A1D26] hover:text-white'
            ]"
          >
            {{ cat }}
          </button>
        </div>

        <!-- Stats Bar -->
        <div class="flex items-center gap-4 text-[11px] text-gray-400 font-mono shrink-0">
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-400"></span> {{ completedCount }} Completed</span>
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-amber-400"></span> {{ pendingCount }} Pending</span>
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-rose-400"></span> {{ urgentCount }} Urgent/High</span>
        </div>
      </div>
    </header>

    <!-- AI QUICK ADD BAR -->
    <div class="bg-[#14161C] border-b border-[#1F222A] p-3 px-4 sm:px-6">
      <div class="max-w-7xl mx-auto flex items-center gap-3">
        <div class="w-7 h-7 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center shrink-0">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
          </svg>
        </div>
        <form @submit.prevent="submitAiQuickAdd" class="flex-1 flex items-center gap-2">
          <input 
            v-model="aiQuickAddText" 
            type="text" 
            placeholder="AI Quick Add: Tabiiy tilda yozing (masalan: 'Juma kuni soat 15:00 da investor bilan meeting')" 
            class="flex-1 bg-[#0B0C0E] border border-[#262A36] focus:border-indigo-500 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 outline-none transition"
          />
          <button 
            type="submit" 
            :disabled="!aiQuickAddText.trim() || isAiProcessing"
            class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs transition shrink-0"
          >
            {{ isAiProcessing ? 'AI Tahlil...' : 'AI Add' }}
          </button>
        </form>
      </div>
    </div>

    <!-- MAIN CALENDAR WORKSPACE AREA -->
    <main class="flex-1 overflow-y-auto p-4 sm:p-6">
      <div class="max-w-7xl mx-auto">
        
        <!-- MONTH VIEW -->
        <div v-if="currentViewTab === 'month'" class="space-y-4">
          <!-- Month Header Controls -->
          <div class="flex items-center justify-between bg-[#111317] border border-[#1F222A] rounded-2xl p-4 shadow-xl">
            <div class="flex items-center gap-3">
              <button @click="changeMonth(-1)" class="p-2 rounded-xl bg-[#1A1D26] hover:bg-[#252936] text-gray-300 transition">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
              </button>
              <h2 class="text-lg font-bold text-white tracking-tight font-mono">{{ currentMonthName }} {{ currentYear }}</h2>
              <button @click="changeMonth(1)" class="p-2 rounded-xl bg-[#1A1D26] hover:bg-[#252936] text-gray-300 transition">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
              </button>
            </div>
            <button @click="goToToday" class="px-3.5 py-1.5 rounded-xl bg-[#1A1D26] hover:bg-[#252936] text-xs font-semibold text-indigo-300 border border-indigo-500/20 transition">
              Bugun (Today)
            </button>
          </div>

          <!-- Month Grid -->
          <div class="bg-[#111317] border border-[#1F222A] rounded-3xl p-4 shadow-2xl">
            <!-- Day of week headers -->
            <div class="grid grid-cols-7 gap-2 mb-2 text-center text-[11px] font-bold text-gray-400 uppercase tracking-wider">
              <span>Dush</span><span>Sesh</span><span>Chor</span><span>Pay</span><span>Jum</span><span>Shan</span><span>Yak</span>
            </div>

            <!-- Calendar Days Grid -->
            <div class="grid grid-cols-7 gap-2">
              <div 
                v-for="cell in monthGridCells" 
                :key="cell.dateKey"
                @click="selectCellDate(cell.dateKey)"
                :class="[
                  'min-h-[110px] p-2 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between group relative overflow-hidden',
                  cell.isCurrentMonth ? 'bg-[#14161C] border-[#1F222A] hover:border-indigo-500/40 hover:bg-[#181B24]' : 'bg-[#0E1014]/50 border-transparent text-gray-600',
                  cell.isToday ? 'ring-2 ring-indigo-500 bg-[#1A1E2B]' : '',
                  selectedDateKey === cell.dateKey ? 'border-indigo-500/80 bg-[#1B1F2D]' : ''
                ]"
              >
                <!-- Day Number Header -->
                <div class="flex items-center justify-between mb-1">
                  <span :class="['text-xs font-bold font-mono', cell.isToday ? 'text-indigo-400' : 'text-gray-300']">
                    {{ cell.dayNum }}
                  </span>
                  <span v-if="cell.events.length > 0" class="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30">
                    {{ cell.events.length }} task
                  </span>
                </div>

                <!-- Event badges in cell -->
                <div class="space-y-1 overflow-y-auto max-h-[70px] scrollbar-none">
                  <div 
                    v-for="evt in cell.events.slice(0, 3)" 
                    :key="evt.id"
                    @click.stop="openEditModal(evt)"
                    :class="[
                      'px-2 py-1 rounded-lg text-[10px] font-medium truncate flex items-center justify-between border transition',
                      getPriorityBadgeClass(evt.priority)
                    ]"
                  >
                    <span class="truncate">{{ evt.title }}</span>
                    <span class="text-[8px] opacity-75 font-mono ml-1 shrink-0">{{ evt.startTime }}</span>
                  </div>
                  <div v-if="cell.events.length > 3" class="text-[9px] text-gray-400 font-mono text-center">
                    +{{ cell.events.length - 3 }} ko'proq
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>

        <!-- WEEK VIEW -->
        <div v-else-if="currentViewTab === 'week'" class="space-y-4">
          <div class="flex items-center justify-between bg-[#111317] border border-[#1F222A] rounded-2xl p-4 shadow-xl">
            <h2 class="text-sm font-bold text-white">Haftalik Rejalar & Uchrashuvlar Jadvali</h2>
            <div class="text-xs text-gray-400 font-mono">Hozirgi hafta bugun bilan birga</div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-7 gap-3">
            <div 
              v-for="day in weekDaysList" 
              :key="day.dateKey"
              class="bg-[#14161C] border border-[#1F222A] rounded-2xl p-3 flex flex-col gap-3 min-h-[300px]"
            >
              <div class="border-b border-[#1F222A] pb-2 text-center">
                <div class="text-[10px] font-bold uppercase tracking-wider text-indigo-400">{{ day.dayName }}</div>
                <div class="text-xs font-bold text-white font-mono mt-0.5">{{ day.dateStr }}</div>
              </div>

              <div class="space-y-2 flex-1">
                <div 
                  v-for="evt in day.events" 
                  :key="evt.id"
                  @click="openEditModal(evt)"
                  :class="[
                    'p-2.5 rounded-xl border text-xs cursor-pointer transition flex flex-col gap-1.5 group',
                    getPriorityBadgeClass(evt.priority)
                  ]"
                >
                  <div class="flex items-center justify-between">
                    <span class="font-bold truncate text-white">{{ evt.title }}</span>
                    <span class="text-[9px] font-mono opacity-80 shrink-0">{{ evt.startTime }}</span>
                  </div>
                  <div class="flex items-center justify-between text-[10px]">
                    <span class="opacity-75 font-mono">{{ evt.category }}</span>
                    <span :class="['px-1.5 py-0.5 rounded text-[8px] font-bold uppercase', getStatusClass(evt.status)]">{{ evt.status }}</span>
                  </div>
                </div>

                <div v-if="day.events.length === 0" class="h-full flex items-center justify-center text-[10px] text-gray-500 italic">
                  Vazifa yo'q
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- DAY VIEW & SELECTED EVENTS LIST -->
        <div v-else-if="currentViewTab === 'day' || selectedDateKey" class="space-y-4">
          <div class="flex items-center justify-between bg-[#111317] border border-[#1F222A] rounded-2xl p-4 shadow-xl">
            <div class="flex items-center gap-3">
              <span class="w-3 h-3 rounded-full bg-indigo-500 animate-pulse"></span>
              <h2 class="text-sm font-bold text-white">Kunlik Vazifalar Timeline ({{ selectedDateKey || todayDateKey }})</h2>
            </div>
            <button @click="openCreateModalWithDate(selectedDateKey || todayDateKey)" class="text-xs text-indigo-400 hover:text-white font-semibold flex items-center gap-1">
              + Ushbu kunga task qo'shish
            </button>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <!-- Event Cards Stream -->
            <div class="lg:col-span-8 space-y-3">
              <div 
                v-for="evt in selectedDayEvents" 
                :key="evt.id"
                class="bg-[#14161C] border border-[#1F222A] hover:border-indigo-500/50 rounded-2xl p-4 transition-all shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
              >
                <div class="space-y-1.5 flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span :class="['px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase font-mono', getPriorityBadgeClass(evt.priority)]">
                      {{ evt.priority }}
                    </span>
                    <span class="text-[10px] font-medium bg-[#1D212C] text-gray-300 px-2 py-0.5 rounded-md border border-[#2D3242]">
                      🏷️ {{ evt.category }}
                    </span>
                    <span v-if="evt.source === 'AI'" class="text-[9px] font-mono bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/30">
                      ⚡ AI Auto-Detected
                    </span>
                  </div>

                  <h3 class="text-sm font-bold text-white truncate group-hover:text-indigo-300 transition">{{ evt.title }}</h3>
                  <p v-if="evt.description" class="text-xs text-gray-400 line-clamp-2">{{ evt.description }}</p>

                  <div class="flex items-center gap-4 text-[11px] text-gray-400 font-mono pt-1">
                    <span class="flex items-center gap-1">
                      <svg class="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                      {{ evt.startTime }} - {{ evt.endTime }}
                    </span>
                    <span>🗓️ {{ evt.startDate }}</span>
                  </div>
                </div>

                <!-- Actions -->
                <div class="flex items-center gap-2 shrink-0 border-t sm:border-t-0 border-[#1F222A] pt-2 sm:pt-0">
                  <button 
                    @click="toggleStatus(evt)"
                    :class="['px-3 py-1.5 rounded-xl text-xs font-semibold transition border', getStatusClass(evt.status)]"
                  >
                    {{ evt.status }}
                  </button>
                  <button @click="openEditModal(evt)" class="p-2 rounded-xl bg-[#1A1D26] hover:bg-[#252936] text-gray-300 transition" title="Tahrirlash">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                  </button>
                  <button @click="deleteEventItem(evt.id)" class="p-2 rounded-xl bg-[#1A1D26] hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition" title="O'chirish">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                  </button>
                </div>
              </div>

              <div v-if="selectedDayEvents.length === 0" class="bg-[#14161C] border border-[#1F222A] rounded-2xl p-8 text-center space-y-3">
                <div class="w-12 h-12 rounded-2xl bg-indigo-600/10 text-indigo-400 flex items-center justify-center mx-auto">
                  📅
                </div>
                <h4 class="text-sm font-bold text-white">Ushbu kunga rejalashtirilgan vazifa yo'q</h4>
                <p class="text-xs text-gray-400 max-w-sm mx-auto">Yangi vazifa yaratish uchun yuqoridagi tugmani bosing yoki AI Chatga "Ertaga meeting bor" deb yozing.</p>
              </div>
            </div>

            <!-- Side Reminders & Integration Status -->
            <div class="lg:col-span-4 space-y-4">
              <div class="bg-[#14161C] border border-[#1F222A] rounded-2xl p-4 space-y-3 shadow-xl">
                <div class="flex items-center justify-between border-b border-[#1F222A] pb-2">
                  <span class="text-xs font-bold text-white flex items-center gap-2">
                    <svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 01-6 0v-1m6 0H9"/></svg>
                    Yaqinlashayotgan AI Eslatmalar
                  </span>
                  <span class="text-[9px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-mono">Telegram Active</span>
                </div>

                <div class="space-y-2 text-xs">
                  <div v-for="evt in upcomingReminders.slice(0, 3)" :key="evt.id" class="p-2.5 rounded-xl bg-[#1A1D26] border border-[#262A36] space-y-1">
                    <div class="font-bold text-white truncate">{{ evt.title }}</div>
                    <div class="text-[10px] text-gray-400 flex items-center justify-between">
                      <span>🕒 {{ evt.startDate }} ({{ evt.startTime }})</span>
                      <span class="text-amber-400 font-mono font-bold">30 min oldin</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </main>

    <!-- EVENT CREATE / EDIT MODAL -->
    <div v-if="isModalOpen" class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-[#14161C] border border-[#262A36] rounded-3xl w-full max-w-lg p-6 space-y-5 shadow-2xl relative animate-in fade-in zoom-in duration-200">
        
        <div class="flex items-center justify-between border-b border-[#1F222A] pb-3">
          <h3 class="text-base font-bold text-white flex items-center gap-2">
            <span>📅</span>
            <span>{{ isEditMode ? 'Eventni Tahrirlash' : 'Yangi Event Yaratish' }}</span>
          </h3>
          <button @click="isModalOpen = false" class="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-[#1F222A]">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <form @submit.prevent="saveModalEvent" class="space-y-4 text-xs">
          <!-- Title -->
          <div>
            <label class="block font-semibold text-gray-300 mb-1">Vazifa / Meeting Nomi *</label>
            <input 
              v-model="modalForm.title" 
              type="text" 
              required
              placeholder="Masalan: SwissWatch Client Meeting" 
              class="w-full bg-[#0B0C0E] border border-[#262A36] focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-white outline-none"
            />
          </div>

          <!-- Description -->
          <div>
            <label class="block font-semibold text-gray-300 mb-1">Tavsif (Description)</label>
            <textarea 
              v-model="modalForm.description" 
              rows="2"
              placeholder="Vazifa tafsilotlari va kun tartibi..." 
              class="w-full bg-[#0B0C0E] border border-[#262A36] focus:border-indigo-500 rounded-xl px-3.5 py-2 text-white outline-none"
            ></textarea>
          </div>

          <!-- Date & Times -->
          <div class="grid grid-cols-3 gap-3">
            <div>
              <label class="block font-semibold text-gray-300 mb-1">Sana *</label>
              <input v-model="modalForm.startDate" type="date" required class="w-full bg-[#0B0C0E] border border-[#262A36] rounded-xl px-3 py-2 text-white outline-none" />
            </div>
            <div>
              <label class="block font-semibold text-gray-300 mb-1">Boshlanish *</label>
              <input v-model="modalForm.startTime" type="time" required class="w-full bg-[#0B0C0E] border border-[#262A36] rounded-xl px-3 py-2 text-white outline-none" />
            </div>
            <div>
              <label class="block font-semibold text-gray-300 mb-1">Tugash *</label>
              <input v-model="modalForm.endTime" type="time" required class="w-full bg-[#0B0C0E] border border-[#262A36] rounded-xl px-3 py-2 text-white outline-none" />
            </div>
          </div>

          <!-- Category & Priority -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block font-semibold text-gray-300 mb-1">Kategoriya</label>
              <select v-model="modalForm.category" class="w-full bg-[#0B0C0E] border border-[#262A36] rounded-xl px-3 py-2 text-white outline-none">
                <option value="Meeting">Meeting (Uchrashuv)</option>
                <option value="Work">Work (Ish/Audit)</option>
                <option value="Deadline">Deadline (Topshirish)</option>
                <option value="Call">Call (Qo'ng'iroq)</option>
                <option value="Personal">Personal (Shaxsiy)</option>
                <option value="Project">Project (Loyiha)</option>
              </select>
            </div>
            <div>
              <label class="block font-semibold text-gray-300 mb-1">Prioritet</label>
              <select v-model="modalForm.priority" class="w-full bg-[#0B0C0E] border border-[#262A36] rounded-xl px-3 py-2 text-white outline-none">
                <option value="Low">Low (Past)</option>
                <option value="Medium">Medium (O'rta)</option>
                <option value="High">High (Yuqori)</option>
                <option value="Urgent">Urgent (Shoshilinch)</option>
              </select>
            </div>
          </div>

          <!-- Status -->
          <div>
            <label class="block font-semibold text-gray-300 mb-1">Holati (Status)</label>
            <select v-model="modalForm.status" class="w-full bg-[#0B0C0E] border border-[#262A36] rounded-xl px-3 py-2 text-white outline-none">
              <option value="Pending">Pending (Kutilmoqda)</option>
              <option value="In Progress">In Progress (Bajarilmoqda)</option>
              <option value="Completed">Completed (Bajarildi)</option>
            </select>
          </div>

          <!-- Footer Buttons -->
          <div class="pt-3 border-t border-[#1F222A] flex items-center justify-end gap-2">
            <button type="button" @click="isModalOpen = false" class="px-4 py-2 rounded-xl bg-[#1F222A] text-gray-300 font-semibold hover:bg-[#2A2E3B] transition">
              Bekor qilish
            </button>
            <button type="submit" class="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-lg transition">
              {{ isEditMode ? 'Saqlash' : 'Yaratish' }}
            </button>
          </div>
        </form>

      </div>
    </div>

  </div>
</template>

<script>
import calendarService from '../services/calendarService';
import axios from 'axios';
import { API_BASE } from '../services/api';

export default {
  name: 'CalendarWorkspace',
  data() {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const todayKey = today.toISOString().split('T')[0];

    return {
      events: [],
      currentViewTab: 'month', // 'month', 'week', 'day'
      currentYear: year,
      currentMonth: month,
      selectedDateKey: todayKey,
      todayDateKey: todayKey,
      selectedCategoryFilter: 'All',
      categories: ['All', 'Meeting', 'Work', 'Deadline', 'Call', 'Personal', 'Project'],
      
      // Quick AI Add
      aiQuickAddText: '',
      isAiProcessing: false,
      
      // Sync
      isSyncing: false,

      // Modal State
      isModalOpen: false,
      isEditMode: false,
      editingId: null,
      modalForm: {
        title: '',
        description: '',
        startDate: todayKey,
        startTime: '10:00',
        endTime: '11:00',
        priority: 'Medium',
        category: 'Work',
        status: 'Pending'
      }
    };
  },
  computed: {
    currentMonthName() {
      const months = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
      return months[this.currentMonth];
    },
    filteredEvents() {
      if (this.selectedCategoryFilter === 'All') return this.events;
      return this.events.filter(e => e.category === this.selectedCategoryFilter);
    },
    completedCount() {
      return this.events.filter(e => e.status === 'Completed').length;
    },
    pendingCount() {
      return this.events.filter(e => e.status === 'Pending' || e.status === 'In Progress').length;
    },
    urgentCount() {
      return this.events.filter(e => e.priority === 'Urgent' || e.priority === 'High').length;
    },
    monthGridCells() {
      const firstDay = new Date(this.currentYear, this.currentMonth, 1);
      const lastDay = new Date(this.currentYear, this.currentMonth + 1, 0);
      
      let startingDay = firstDay.getDay() - 1; // Mon=0
      if (startingDay < 0) startingDay = 6;

      const cells = [];
      const totalDays = lastDay.getDate();

      // Prev month days
      const prevMonthLastDay = new Date(this.currentYear, this.currentMonth, 0).getDate();
      for (let i = startingDay - 1; i >= 0; i--) {
        const d = prevMonthLastDay - i;
        const dateKey = `${this.currentYear}-${String(this.currentMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        cells.push({
          dateKey,
          dayNum: d,
          isCurrentMonth: false,
          isToday: false,
          events: []
        });
      }

      // Current month days
      for (let d = 1; d <= totalDays; d++) {
        const monthStr = String(this.currentMonth + 1).padStart(2, '0');
        const dayStr = String(d).padStart(2, '0');
        const dateKey = `${this.currentYear}-${monthStr}-${dayStr}`;
        const isToday = dateKey === this.todayDateKey;
        const dayEvts = this.filteredEvents.filter(e => e.startDate === dateKey);

        cells.push({
          dateKey,
          dayNum: d,
          isCurrentMonth: true,
          isToday,
          events: dayEvts
        });
      }

      // Next month padding
      const remaining = (7 - (cells.length % 7)) % 7;
      for (let d = 1; d <= remaining; d++) {
        const nextMonth = this.currentMonth + 2;
        const dateKey = `${this.currentYear}-${String(nextMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        cells.push({
          dateKey,
          dayNum: d,
          isCurrentMonth: false,
          isToday: false,
          events: []
        });
      }

      return cells;
    },
    weekDaysList() {
      const baseDate = new Date(this.selectedDateKey || this.todayDateKey);
      const dayOfWeek = baseDate.getDay();
      const diffToMon = (dayOfWeek + 6) % 7;
      const monday = new Date(baseDate);
      monday.setDate(baseDate.getDate() - diffToMon);

      const dayNames = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];
      const result = [];

      for (let i = 0; i < 7; i++) {
        const curr = new Date(monday);
        curr.setDate(monday.getDate() + i);
        const dateKey = curr.toISOString().split('T')[0];
        const dayEvts = this.filteredEvents.filter(e => e.startDate === dateKey);
        result.push({
          dateKey,
          dayName: dayNames[i],
          dateStr: `${curr.getDate()}-${this.currentMonthName.slice(0,3)}`,
          events: dayEvts
        });
      }

      return result;
    },
    selectedDayEvents() {
      const key = this.selectedDateKey || this.todayDateKey;
      return this.filteredEvents.filter(e => e.startDate === key);
    },
    upcomingReminders() {
      return this.events.filter(e => e.status !== 'Completed');
    }
  },
  async mounted() {
    await this.fetchEvents();
    window.addEventListener('calendar-updated', this.fetchEvents);
  },
  beforeUnmount() {
    window.removeEventListener('calendar-updated', this.fetchEvents);
  },
  methods: {
    async fetchEvents() {
      try {
        this.events = await calendarService.getEvents();
      } catch (e) {
        console.error('Error fetching calendar:', e);
      }
    },
    changeMonth(delta) {
      let m = this.currentMonth + delta;
      if (m < 0) {
        this.currentMonth = 11;
        this.currentYear -= 1;
      } else if (m > 11) {
        this.currentMonth = 0;
        this.currentYear += 1;
      } else {
        this.currentMonth = m;
      }
    },
    goToToday() {
      const today = new Date();
      this.currentYear = today.getFullYear();
      this.currentMonth = today.getMonth();
      this.selectedDateKey = this.todayDateKey;
    },
    selectCellDate(dateKey) {
      this.selectedDateKey = dateKey;
    },
    getPriorityBadgeClass(p) {
      if (p === 'Urgent') return 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-rose-500/10';
      if (p === 'High') return 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-amber-500/10';
      if (p === 'Medium') return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 shadow-indigo-500/10';
      return 'bg-gray-500/20 text-gray-300 border-gray-500/40';
    },
    getStatusClass(s) {
      if (s === 'Completed') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
      if (s === 'In Progress') return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
      return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    },
    openCreateModal() {
      this.isEditMode = false;
      this.editingId = null;
      this.modalForm = {
        title: '',
        description: '',
        startDate: this.selectedDateKey || this.todayDateKey,
        startTime: '10:00',
        endTime: '11:00',
        priority: 'Medium',
        category: 'Work',
        status: 'Pending'
      };
      this.isModalOpen = true;
    },
    openCreateModalWithDate(dateKey) {
      this.openCreateModal();
      this.modalForm.startDate = dateKey;
    },
    openEditModal(evt) {
      this.isEditMode = true;
      this.editingId = evt.id;
      this.modalForm = {
        title: evt.title,
        description: evt.description || '',
        startDate: evt.startDate,
        startTime: evt.startTime || '10:00',
        endTime: evt.endTime || '11:00',
        priority: evt.priority || 'Medium',
        category: evt.category || 'Work',
        status: evt.status || 'Pending'
      };
      this.isModalOpen = true;
    },
    async saveModalEvent() {
      if (!this.modalForm.title || !this.modalForm.title.trim()) {
        alert('Iltimos, event sarlavhasini (Title) kiriting.');
        return;
      }
      try {
        if (this.isEditMode && this.editingId) {
          await calendarService.updateEvent(this.editingId, this.modalForm);
        } else {
          await calendarService.createEvent(this.modalForm);
        }
        this.isModalOpen = false;
        await this.fetchEvents();
      } catch (e) {
        const msg = (e.response && e.response.data && e.response.data.error) ? e.response.data.error : e.message;
        alert('Event saqlashda xatolik yuz berdi: ' + msg);
      }
    },
    async toggleStatus(evt) {
      const nextStatus = evt.status === 'Completed' ? 'Pending' : 'Completed';
      try {
        await calendarService.updateEvent(evt.id, { status: nextStatus });
        await this.fetchEvents();
      } catch (e) {}
    },
    async deleteEventItem(id) {
      if (!confirm("Ushbu eventni taqvimdan o'chirmoqchimisiz?")) return;
      try {
        await calendarService.deleteEvent(id);
        await this.fetchEvents();
      } catch (e) {}
    },
    async triggerGoogleSync() {
      this.isSyncing = true;
      try {
        await calendarService.syncGoogleCalendar();
        await this.fetchEvents();
      } catch (e) {
      } finally {
        this.isSyncing = false;
      }
    },
    async submitAiQuickAdd() {
      if (!this.aiQuickAddText.trim()) return;
      this.isAiProcessing = true;
      try {
        await axios.post(`${API_BASE}/api/chat/message`, {
          conversationId: 'conv-calendar-quick',
          content: this.aiQuickAddText
        });
        this.aiQuickAddText = '';
        await this.fetchEvents();
      } catch (e) {
        console.error('AI Quick Add failed:', e);
      } finally {
        this.isAiProcessing = false;
      }
    }
  }
};
</script>
