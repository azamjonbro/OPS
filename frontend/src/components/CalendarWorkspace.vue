<template>
  <div class="flex-1 flex flex-col h-full bg-canvas text-gray-100 overflow-hidden relative">

    <!-- DEDICATED DAY PLANNER PAGE (takes over the workspace) -->
    <DayPlanner
      v-if="plannerDayKey"
      :day-key="plannerDayKey"
      @back="closePlanner"
      @navigate="plannerDayKey = $event"
      @changed="fetchTaskCounts"
    />

    <template v-else>
    <!-- TOP EXECUTIVE HEADER BAR -->
    <header class="border-b border-line bg-surface p-4 sm:px-6 z-10 shrink-0">
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 max-w-7xl mx-auto">
        
        <!-- Left: Title & Quick Stats -->
        <div>
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 shrink-0">
              <Icon name="calendar" size="lg" />
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h1 class="text-xl font-bold text-white tracking-tight">AI Executive Calendar</h1>
              </div>
              <p class="text-xs text-gray-400">Rejalar, uchrashuvlar va AI tomonidan avtomatik taqvim topshiriqlari</p>
            </div>
          </div>
        </div>

        <!-- Middle: View Switcher (Month / Week / Day) -->
        <div class="flex items-center gap-1 bg-raised p-1 rounded-2xl border border-line self-start lg:self-auto">
          <button 
            @click="currentViewTab = 'month'" 
            :class="['px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all', currentViewTab === 'month' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-hover']"
          >
            Month View
          </button>
          <button 
            @click="currentViewTab = 'week'" 
            :class="['px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all', currentViewTab === 'week' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-hover']"
          >
            Week View
          </button>
          <button 
            @click="currentViewTab = 'day'" 
            :class="['px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all', currentViewTab === 'day' ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-hover']"
          >
            Day View
          </button>
        </div>

        <!-- Right: Actions (Sync & Create) -->
        <div class="flex items-center gap-2">
          <button
            @click="openCreateModal" 
            class="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/25 transition flex items-center gap-2"
          >
            <Icon name="add" size="md" />
            <span>+ Event Yaratish</span>
          </button>
        </div>

      </div>

      <!-- Quick Category Filters & AI Input Banner -->
      <div class="max-w-7xl mx-auto mt-4 pt-3 border-t border-line flex flex-col md:flex-row md:items-center justify-between gap-3">
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
                : 'bg-card text-gray-400 border-line hover:bg-muted hover:text-white'
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
    <div class="bg-card border-b border-line p-3 px-4 sm:px-6">
      <div class="max-w-7xl mx-auto flex items-center gap-3">
        <div class="w-7 h-7 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center shrink-0">
          <Icon name="logo" size="md" />
        </div>
        <form @submit.prevent="submitAiQuickAdd" class="flex-1 flex items-center gap-2">
          <input 
            v-model="aiQuickAddText" 
            type="text" 
            placeholder="AI Quick Add: Tabiiy tilda yozing (masalan: 'Juma kuni soat 15:00 da investor bilan meeting')" 
            class="flex-1 bg-canvas border border-line-strong focus:border-indigo-500 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 outline-none transition"
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
          <div class="flex items-center justify-between bg-surface border border-line rounded-2xl p-4 shadow-xl">
            <div class="flex items-center gap-3">
              <button @click="changeMonth(-1)" class="p-2 rounded-xl bg-muted hover:bg-hover text-gray-300 transition">
                <Icon name="prev" size="md" />
              </button>
              <h2 class="text-lg font-bold text-white tracking-tight font-mono">{{ currentMonthName }} {{ currentYear }}</h2>
              <button @click="changeMonth(1)" class="p-2 rounded-xl bg-muted hover:bg-hover text-gray-300 transition">
                <Icon name="next" size="md" />
              </button>
            </div>
            <button @click="goToToday" class="px-3.5 py-1.5 rounded-xl bg-muted hover:bg-hover text-xs font-semibold text-indigo-300 border border-indigo-500/20 transition">
              Bugun (Today)
            </button>
          </div>

          <!-- Month Grid -->
          <div class="bg-surface border border-line rounded-3xl p-4 shadow-2xl">
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
                  cell.isCurrentMonth ? 'bg-card border-line hover:border-indigo-500/40 hover:bg-raised' : 'bg-sunken/50 border-transparent text-gray-600',
                  cell.isToday ? 'ring-2 ring-indigo-500 bg-[#1A1E2B]' : '',
                  selectedDateKey === cell.dateKey ? 'border-indigo-500/80 bg-[#1B1F2D]' : ''
                ]"
              >
                <!-- Day Number Header -->
                <div class="flex items-center justify-between mb-1 gap-1">
                  <span :class="['text-xs font-bold font-mono', cell.isToday ? 'text-indigo-400' : 'text-gray-300']">
                    {{ cell.dayNum }}
                  </span>
                  <div class="flex items-center gap-1 shrink-0">
                    <span v-if="cell.events.length > 0" class="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30">
                      {{ cell.events.length }}
                    </span>
                    <span
                      v-if="cell.tasks"
                      class="text-[9px] font-mono px-1.5 py-0.5 rounded-full font-semibold border flex items-center gap-0.5"
                      :class="cell.tasks.done === cell.tasks.total
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        : 'bg-amber-500/20 text-amber-300 border-amber-500/30'"
                      :title="`${cell.tasks.done}/${cell.tasks.total} vazifa bajarildi`"
                    >
                      ☑ {{ cell.tasks.done }}/{{ cell.tasks.total }}
                    </span>
                  </div>
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
          <div class="flex items-center justify-between bg-surface border border-line rounded-2xl p-4 shadow-xl">
            <h2 class="text-sm font-bold text-white">Haftalik Rejalar & Uchrashuvlar Jadvali</h2>
            <div class="text-xs text-gray-400 font-mono">Hozirgi hafta bugun bilan birga</div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-7 gap-3">
            <div
              v-for="day in weekDaysList"
              :key="day.dateKey"
              :class="[
                'border rounded-2xl p-3 flex flex-col gap-3 min-h-[300px] transition-colors',
                day.dateKey === todayDateKey
                  ? 'bg-[#1A1E2B] border-indigo-500/60 ring-1 ring-indigo-500/30'
                  : 'bg-card border-line hover:border-line-hover'
              ]"
            >
              <button
                @click="openPlanner(day.dateKey)"
                class="border-b border-line pb-2 text-center w-full group focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-lg"
                :title="day.dayName + ' kunlik planneri'"
              >
                <div class="text-[10px] font-bold uppercase tracking-wider text-indigo-400">{{ day.dayName }}</div>
                <div class="text-xs font-bold text-white font-mono mt-0.5 group-hover:text-indigo-300 transition">{{ day.dateStr }}</div>
                <div
                  v-if="taskCounts[day.dateKey]"
                  class="mt-1 inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded-full border"
                  :class="taskCounts[day.dateKey].done === taskCounts[day.dateKey].total
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-300 border-amber-500/30'"
                >
                  ☑ {{ taskCounts[day.dateKey].done }}/{{ taskCounts[day.dateKey].total }}
                </div>
              </button>

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
        <!-- Rendered as a sibling (not v-else-if) so that clicking a day in Month/Week view
             also reveals that day's full task list below the grid. -->
        <div
          v-if="currentViewTab === 'day' || selectedDateKey"
          :class="['space-y-4', currentViewTab === 'day' ? '' : 'mt-6 pt-6 border-t border-line']"
        >
          <div class="flex items-center justify-between bg-surface border border-line rounded-2xl p-4 shadow-xl gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <span class="w-3 h-3 rounded-full bg-indigo-500 animate-pulse shrink-0"></span>
              <div class="min-w-0">
                <h2 class="text-sm font-bold text-white truncate">{{ selectedDayLabel }}</h2>
                <p class="text-[11px] text-gray-400 font-mono">
                  {{ selectedDayEvents.length }} ta vazifa
                  <span v-if="selectedCategoryFilter !== 'All'"> ({{ selectedCategoryFilter }} filtri bo'yicha)</span>
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                @click="openPlanner(selectedDateKey || todayDateKey)"
                class="px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition flex items-center gap-1.5"
              >
                <Icon name="board" size="sm" />
                Kunlik planner
              </button>
              <button @click="openCreateModalWithDate(selectedDateKey || todayDateKey)" class="text-xs text-indigo-400 hover:text-white font-semibold flex items-center gap-1">
                + Event
              </button>
              <button
                v-if="currentViewTab !== 'day' && selectedDateKey"
                @click="selectedDateKey = ''"
                class="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-line transition"
                title="Kun ko'rinishini yopish"
              >
                <Icon name="close" size="md" />
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <!-- Event Cards Stream -->
            <div class="lg:col-span-8 space-y-3">
              <div 
                v-for="evt in selectedDayEvents" 
                :key="evt.id"
                class="bg-card border border-line hover:border-indigo-500/50 rounded-2xl p-4 transition-all shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
              >
                <div class="space-y-1.5 flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span :class="['px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase font-mono', getPriorityBadgeClass(evt.priority)]">
                      {{ evt.priority }}
                    </span>
                    <span class="text-[10px] font-medium bg-muted text-gray-300 px-2 py-0.5 rounded-md border border-line-hover">
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
                      <Icon name="clock" size="sm" class="text-indigo-400" />
                      {{ evt.startTime }} - {{ evt.endTime }}
                    </span>
                    <span>🗓️ {{ evt.startDate }}</span>
                  </div>
                </div>

                <!-- Actions -->
                <div class="flex items-center gap-2 shrink-0 border-t sm:border-t-0 border-line pt-2 sm:pt-0">
                  <button 
                    @click="toggleStatus(evt)"
                    :class="['px-3 py-1.5 rounded-xl text-xs font-semibold transition border', getStatusClass(evt.status)]"
                  >
                    {{ evt.status }}
                  </button>
                  <button @click="openEditModal(evt)" class="p-2 rounded-xl bg-muted hover:bg-hover text-gray-300 transition" title="Tahrirlash">
                    <Icon name="edit" size="md" />
                  </button>
                  <button @click="deleteEventItem(evt.id)" class="p-2 rounded-xl bg-muted hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition" title="O'chirish">
                    <Icon name="delete" size="md" />
                  </button>
                </div>
              </div>

              <div v-if="selectedDayEvents.length === 0" class="bg-card border border-line rounded-2xl p-8 text-center space-y-3">
                <div class="w-12 h-12 rounded-2xl bg-indigo-600/10 text-indigo-400 flex items-center justify-center mx-auto">
                  📅
                </div>
                <h4 class="text-sm font-bold text-white">Ushbu kunga rejalashtirilgan vazifa yo'q</h4>
                <p class="text-xs text-gray-400 max-w-sm mx-auto">Yangi vazifa yaratish uchun yuqoridagi tugmani bosing yoki AI Chatga "Ertaga meeting bor" deb yozing.</p>
              </div>
            </div>

            <!-- Side Reminders & Integration Status -->
            <div class="lg:col-span-4 space-y-4">
              <div class="bg-card border border-line rounded-2xl p-4 space-y-3 shadow-xl">
                <div class="flex items-center justify-between border-b border-line pb-2">
                  <span class="text-xs font-bold text-white flex items-center gap-2">
                    <Icon name="bell" size="md" class="text-emerald-400" />
                    Yaqinlashayotgan AI Eslatmalar
                  </span>
                  <span class="text-[9px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-mono">Telegram Active</span>
                </div>

                <div class="space-y-2 text-xs">
                  <div v-for="evt in upcomingReminders.slice(0, 3)" :key="evt.id" class="p-2.5 rounded-xl bg-muted border border-line-strong space-y-1">
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
    </template>

    <!-- EVENT CREATE / EDIT MODAL -->
    <div v-if="isModalOpen" class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-card border border-line-strong rounded-3xl w-full max-w-lg p-6 space-y-5 shadow-2xl relative animate-in fade-in zoom-in duration-200">
        
        <div class="flex items-center justify-between border-b border-line pb-3">
          <h3 class="text-base font-bold text-white flex items-center gap-2">
            <span>📅</span>
            <span>{{ isEditMode ? 'Eventni Tahrirlash' : 'Yangi Event Yaratish' }}</span>
          </h3>
          <button @click="isModalOpen = false" class="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-line">
            <Icon name="close" size="lg" />
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
              class="w-full bg-canvas border border-line-strong focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-white outline-none"
            />
          </div>

          <!-- Description -->
          <div>
            <label class="block font-semibold text-gray-300 mb-1">Tavsif (Description)</label>
            <textarea 
              v-model="modalForm.description" 
              rows="2"
              placeholder="Vazifa tafsilotlari va kun tartibi..." 
              class="w-full bg-canvas border border-line-strong focus:border-indigo-500 rounded-xl px-3.5 py-2 text-white outline-none"
            ></textarea>
          </div>

          <!-- Date & Times -->
          <div class="grid grid-cols-3 gap-3">
            <div>
              <label class="block font-semibold text-gray-300 mb-1">Sana *</label>
              <input v-model="modalForm.startDate" type="date" required class="w-full bg-canvas border border-line-strong rounded-xl px-3 py-2 text-white outline-none" />
            </div>
            <div>
              <label class="block font-semibold text-gray-300 mb-1">Boshlanish *</label>
              <input v-model="modalForm.startTime" type="time" required class="w-full bg-canvas border border-line-strong rounded-xl px-3 py-2 text-white outline-none" />
            </div>
            <div>
              <label class="block font-semibold text-gray-300 mb-1">Tugash *</label>
              <input v-model="modalForm.endTime" type="time" required class="w-full bg-canvas border border-line-strong rounded-xl px-3 py-2 text-white outline-none" />
            </div>
          </div>

          <!-- Category & Priority -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block font-semibold text-gray-300 mb-1">Kategoriya</label>
              <select v-model="modalForm.category" class="w-full bg-canvas border border-line-strong rounded-xl px-3 py-2 text-white outline-none">
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
              <select v-model="modalForm.priority" class="w-full bg-canvas border border-line-strong rounded-xl px-3 py-2 text-white outline-none">
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
            <select v-model="modalForm.status" class="w-full bg-canvas border border-line-strong rounded-xl px-3 py-2 text-white outline-none">
              <option value="Pending">Pending (Kutilmoqda)</option>
              <option value="In Progress">In Progress (Bajarilmoqda)</option>
              <option value="Completed">Completed (Bajarildi)</option>
            </select>
          </div>

          <!-- Footer Buttons -->
          <div class="pt-3 border-t border-line flex items-center justify-end gap-2">
            <button
              v-if="isEditMode"
              type="button"
              @click="deleteFromModal"
              class="mr-auto px-4 py-2 rounded-xl bg-red-600/15 text-red-400 font-semibold border border-red-500/30 hover:bg-red-600 hover:text-white transition"
            >
              O'chirish
            </button>
            <button type="button" @click="isModalOpen = false" class="px-4 py-2 rounded-xl bg-line text-gray-300 font-semibold hover:bg-line-hover transition">
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
import chatService from '../services/chatService';
import taskService from '../services/taskService';
import DayPlanner from './DayPlanner.vue';
import {
  MONTH_NAMES,
  WEEKDAY_NAMES,
  toDateKey,
  parseDateKey,
  errorText
} from '../utils/date';

export default {
  name: 'CalendarWorkspace',
  components: { DayPlanner },
  data() {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const todayKey = toDateKey(today);

    return {
      events: [],
      currentViewTab: 'month', // 'month', 'week', 'day'
      currentYear: year,
      currentMonth: month,
      selectedDateKey: todayKey,
      todayDateKey: todayKey,
      selectedCategoryFilter: 'All',
      categories: ['All', 'Meeting', 'Work', 'Deadline', 'Call', 'Personal', 'Project'],

      // When set, the Trello-style day planner takes over the whole workspace.
      plannerDayKey: null,
      // { '2026-08-01': { total, done } } — powers the per-day task indicators.
      taskCounts: {},
      isLoadingEvents: true,

      // Quick AI Add
      aiQuickAddText: '',
      isAiProcessing: false,
      
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
      return MONTH_NAMES[this.currentMonth];
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
      // The grid always starts on the Monday on/before the 1st and runs whole weeks, so
      // every cell is derived from a real Date — no manual month/year arithmetic that
      // breaks at the January (month 0) and December (month 13) boundaries.
      const firstDay = new Date(this.currentYear, this.currentMonth, 1);
      const leadingBlanks = (firstDay.getDay() + 6) % 7; // Mon = 0
      const daysInMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();
      const totalCells = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;

      const cells = [];
      for (let i = 0; i < totalCells; i++) {
        const cellDate = new Date(this.currentYear, this.currentMonth, i - leadingBlanks + 1);
        const dateKey = toDateKey(cellDate);
        cells.push({
          dateKey,
          dayNum: cellDate.getDate(),
          isCurrentMonth: cellDate.getMonth() === this.currentMonth,
          isToday: dateKey === this.todayDateKey,
          events: this.eventsByDate[dateKey] || [],
          tasks: this.taskCounts[dateKey] || null
        });
      }
      return cells;
    },
    // Bucket once per render instead of re-filtering the whole list for all 42 cells.
    eventsByDate() {
      return this.filteredEvents.reduce((acc, evt) => {
        (acc[evt.startDate] = acc[evt.startDate] || []).push(evt);
        return acc;
      }, {});
    },
    weekDaysList() {
      const baseDate = parseDateKey(this.selectedDateKey || this.todayDateKey);
      const monday = new Date(baseDate);
      monday.setDate(baseDate.getDate() - ((baseDate.getDay() + 6) % 7));

      const dayNames = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];
      const result = [];

      for (let i = 0; i < 7; i++) {
        const curr = new Date(monday);
        curr.setDate(monday.getDate() + i);
        const dateKey = toDateKey(curr);
        result.push({
          dateKey,
          dayName: dayNames[i],
          // Label the day with its own month, not whichever month the grid is scrolled to.
          dateStr: `${curr.getDate()}-${MONTH_NAMES[curr.getMonth()].slice(0, 3)}`,
          events: this.eventsByDate[dateKey] || []
        });
      }

      return result;
    },
    selectedDayEvents() {
      const key = this.selectedDateKey || this.todayDateKey;
      return (this.eventsByDate[key] || [])
        .slice()
        .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    },
    selectedDayLabel() {
      const key = this.selectedDateKey || this.todayDateKey;
      const d = parseDateKey(key);
      const suffix = key === this.todayDateKey ? ' — Bugun' : '';
      return `${d.getDate()}-${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}, ${WEEKDAY_NAMES[d.getDay()]}${suffix}`;
    },
    upcomingReminders() {
      // "Upcoming" means still ahead of us — past unfinished events are not reminders.
      return this.events
        .filter(e => e.status !== 'Completed' && e.startDate >= this.todayDateKey)
        .sort((a, b) => (a.startDate + a.startTime).localeCompare(b.startDate + b.startTime));
    }
  },
  async mounted() {
    await Promise.all([this.fetchEvents(), this.fetchTaskCounts()]);
    window.addEventListener('calendar-updated', this.fetchEvents);
  },
  beforeUnmount() {
    window.removeEventListener('calendar-updated', this.fetchEvents);
  },
  watch: {
    // Grid scrolled to another month — reload the indicators for the new range.
    currentMonth: 'fetchTaskCounts',
    currentYear: 'fetchTaskCounts'
  },
  methods: {
    async fetchEvents() {
      this.isLoadingEvents = true;
      try {
        this.events = await calendarService.getEvents();
      } catch (e) {
        this.events = [];
      } finally {
        this.isLoadingEvents = false;
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
      // Clicking a leading/trailing cell scrolls the grid to the month it belongs to.
      const d = parseDateKey(dateKey);
      if (d.getMonth() !== this.currentMonth || d.getFullYear() !== this.currentYear) {
        this.currentMonth = d.getMonth();
        this.currentYear = d.getFullYear();
      }
    },
    openPlanner(dateKey) {
      this.plannerDayKey = dateKey || this.todayDateKey;
    },
    closePlanner() {
      this.plannerDayKey = null;
      this.fetchTaskCounts();
    },
    async fetchTaskCounts() {
      // Pad the range so the leading/trailing cells of the month grid are covered too.
      const from = toDateKey(new Date(this.currentYear, this.currentMonth, -7));
      const to = toDateKey(new Date(this.currentYear, this.currentMonth + 1, 14));
      try {
        this.taskCounts = await taskService.getCounts(from, to);
      } catch (e) {
        this.taskCounts = {};
      }
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
        // Keep the day panel pointed at the day the event actually landed on.
        this.selectedDateKey = this.modalForm.startDate;
        await this.fetchEvents();
      } catch (e) {
        alert('Event saqlashda xatolik yuz berdi: ' + errorText(e));
      }
    },
    async deleteFromModal() {
      const id = this.editingId;
      if (!id) return;
      await this.deleteEventItem(id);
      if (!this.events.some(e => e.id === id)) {
        this.isModalOpen = false;
      }
    },
    async toggleStatus(evt) {
      const nextStatus = evt.status === 'Completed' ? 'Pending' : 'Completed';
      try {
        await calendarService.updateEvent(evt.id, { status: nextStatus });
        await this.fetchEvents();
      } catch (e) {
        alert('Holatni yangilab bo\'lmadi: ' + errorText(e));
      }
    },
    async deleteEventItem(id) {
      const evt = this.events.find(e => e.id === id);
      const name = evt ? `"${evt.title}"` : 'ushbu event';
      if (!confirm(`${name} taqvimdan o'chirilsinmi? Bu amalni qaytarib bo'lmaydi.`)) return;
      try {
        await calendarService.deleteEvent(id);
        await this.fetchEvents();
      } catch (e) {
        alert('Eventni o\'chirib bo\'lmadi: ' + errorText(e));
      }
    },
    async submitAiQuickAdd() {
      if (!this.aiQuickAddText.trim()) return;
      this.isAiProcessing = true;
      try {
        await chatService.sendMessage({
          conversationId: 'conv-calendar-quick',
          content: this.aiQuickAddText
        });
        this.aiQuickAddText = '';
        await this.fetchEvents();
      } catch (e) {
        alert('AI Quick Add bajarilmadi: ' + errorText(e));
      } finally {
        this.isAiProcessing = false;
      }
    }
  }
};
</script>
