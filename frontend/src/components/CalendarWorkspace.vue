<template>
  <div :class="['flex-1 flex flex-col h-full overflow-hidden relative transition-colors duration-200', isLightTheme ? 'bg-[#F4F6FB] text-slate-800' : 'bg-canvas text-gray-100']">

    <!-- DEDICATED DAY PLANNER PAGE (takes over the workspace) -->
    <DayPlanner
      v-if="plannerDayKey"
      :day-key="plannerDayKey"
      :events="eventsByDate[plannerDayKey] || []"
      @back="closePlanner"
      @navigate="plannerDayKey = $event"
      @changed="fetchStripTasks"
      @edit-event="openEditModal"
    />

    <template v-else>
    <!-- TOP EXECUTIVE HEADER BAR -->
    <header :class="['border-b px-4 sm:px-6 py-3 z-10 shrink-0 backdrop-blur-xl transition-colors', isLightTheme ? 'bg-white/85 border-slate-200/80 shadow-sm' : 'bg-surface/90 border-line']">
      <div class="max-w-7xl mx-auto space-y-2.5">

        <!-- Row 1: view switcher · counters · primary action.
             Everything shares one 32px height so the row reads as a single band. -->
        <div class="flex items-center justify-between gap-3">
          <div :class="['flex items-center gap-0.5 p-0.5 rounded-xl border shrink-0', isLightTheme ? 'bg-slate-100 border-slate-200' : 'bg-raised border-line']">
            <button
              v-for="tab in viewTabs"
              :key="tab.key"
              @click="currentViewTab = tab.key"
              :class="[
                'h-8 px-3.5 rounded-[10px] text-xs font-semibold transition-all',
                currentViewTab === tab.key
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                  : (isLightTheme ? 'text-slate-500 hover:text-slate-900' : 'text-gray-400 hover:text-white')
              ]"
            >
              {{ tab.label }}
            </button>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <!-- Counters are the first thing to go when the row gets tight: they are a
                 summary, while the tabs and the create button are controls. -->
            <div class="hidden xl:flex items-center gap-1.5">
              <span
                v-for="stat in headerStats"
                :key="stat.label"
                :class="['flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-[11px] font-medium tabular-nums', stat.chipClass]"
              >
                <span :class="['w-1.5 h-1.5 rounded-full', stat.dotClass]"></span>
                <span class="font-bold">{{ stat.value }}</span>
                <span class="opacity-70">{{ stat.label }}</span>
              </span>
            </div>

            <button
              @click="openCreateModal"
              class="h-8 pl-2.5 pr-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-sm shadow-indigo-600/30 transition flex items-center gap-1.5 shrink-0"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14"/>
              </svg>
              Event
            </button>
          </div>
        </div>

        <!-- Row 2: category filters -->
        <div class="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          <button
            v-for="cat in categories"
            :key="cat"
            @click="selectedCategoryFilter = cat"
            :class="[
              'h-7 px-3 rounded-lg text-[11px] font-semibold transition shrink-0 border',
              selectedCategoryFilter === cat
                ? 'bg-indigo-600 text-white border-indigo-600'
                : (isLightTheme ? 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300 hover:text-indigo-600' : 'bg-card text-gray-400 border-line hover:border-indigo-500/40 hover:text-white')
            ]"
          >
            {{ cat }}
          </button>
        </div>
      </div>
    </header>

    <!-- MAIN CALENDAR WORKSPACE AREA -->
    <main class="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar">
      <div class="max-w-7xl mx-auto">
        
        <!-- MONTH VIEW — the weekly task board is the view; the month grid was removed
             on request, and the strip's own ‹ / › navigation covers moving between weeks. -->
        <div v-if="currentViewTab === 'month'" class="space-y-4">
          <!-- PER-DAY TASK TABLE — the calendar sits above it, the days run across it. -->
          <WeekTaskStrip
            :days="stripDays"
            :selected-date-key="selectedDateKey"
            :is-light-theme="isLightTheme"
            @open-day="openPlanner"
            @cycle-status="cycleTaskStatus"
            @open-event="openEditModal"
            @shift-days="shiftStripDays"
          />
        </div>

        <!-- WEEK VIEW -->
        <div v-else-if="currentViewTab === 'week'" class="space-y-4">
          <div :class="['flex items-center justify-between border rounded-2xl p-4 shadow-sm transition-colors', isLightTheme ? 'bg-white border-slate-200' : 'bg-surface border-line shadow-xl']">
            <h2 :class="['text-sm font-bold', isLightTheme ? 'text-slate-900' : 'text-white']">Haftalik Rejalar & Uchrashuvlar Jadvali</h2>
            <div :class="['text-xs font-mono', isLightTheme ? 'text-slate-500' : 'text-gray-400']">Hozirgi hafta bugun bilan birga</div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-7 gap-3">
            <div
              v-for="day in weekDaysList"
              :key="day.dateKey"
              :class="[
                'border rounded-2xl p-3 flex flex-col gap-3 min-h-[300px] transition-colors',
                day.dateKey === todayDateKey
                  ? (isLightTheme ? 'bg-indigo-50/70 border-indigo-400 ring-1 ring-indigo-400' : 'bg-[#1A1E2B] border-indigo-500/60 ring-1 ring-indigo-500/30')
                  : (isLightTheme ? 'bg-white border-slate-200 hover:border-slate-300' : 'bg-card border-line hover:border-line-hover')
              ]"
            >
              <button
                @click="openPlanner(day.dateKey)"
                :class="['border-b pb-2 text-center w-full group focus:outline-none rounded-lg', isLightTheme ? 'border-slate-200' : 'border-line']"
                :title="day.dayName + ' kunlik planneri'"
              >
                <div class="text-[10px] font-extrabold uppercase tracking-wider text-indigo-600">{{ day.dayName }}</div>
                <div :class="['text-xs font-bold font-mono mt-0.5 group-hover:text-indigo-600 transition', isLightTheme ? 'text-slate-900' : 'text-white']">{{ day.dateStr }}</div>
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
                    <span class="font-bold truncate">{{ evt.title }}</span>
                    <span class="text-[9px] font-mono opacity-80 shrink-0">{{ evt.startTime }}</span>
                  </div>
                </div>

                <div v-if="day.events.length === 0" :class="['h-full flex items-center justify-center text-[10px] italic', isLightTheme ? 'text-slate-400' : 'text-gray-500']">
                  Vazifa yo'q
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- DAY VIEW & SELECTED EVENTS LIST -->
        <!-- Month view has its own per-day table (WeekTaskStrip), so this detailed event
             stream is the Day tab's own content and no longer duplicates below the grid. -->
        <div
          v-if="currentViewTab === 'day'"
          class="space-y-4"
        >
          <div :class="['flex items-center justify-between border rounded-2xl p-4 shadow-sm gap-3 transition-colors', isLightTheme ? 'bg-white border-slate-200' : 'bg-surface border-line shadow-xl']">
            <div class="flex items-center gap-3 min-w-0">
              <span class="w-3 h-3 rounded-full bg-indigo-500 animate-pulse shrink-0"></span>
              <div class="min-w-0">
                <h2 :class="['text-sm font-bold truncate', isLightTheme ? 'text-slate-900' : 'text-white']">{{ selectedDayLabel }}</h2>
                <p :class="['text-[11px] font-mono', isLightTheme ? 'text-slate-500' : 'text-gray-400']">
                  {{ selectedDayEvents.length }} ta vazifa
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                @click="openPlanner(selectedDateKey || todayDateKey)"
                class="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold shadow-md transition flex items-center gap-1.5"
              >
                Kunlik planner
              </button>
              <button @click="openCreateModalWithDate(selectedDateKey || todayDateKey)" class="text-xs text-indigo-600 hover:text-indigo-700 font-bold px-2 py-1 rounded-lg">
                + Event
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <!-- Event Cards Stream -->
            <div class="lg:col-span-8 space-y-3">
              <div 
                v-for="evt in selectedDayEvents" 
                :key="evt.id"
                :class="[
                  'border rounded-2xl p-4 transition-all shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4 group',
                  isLightTheme ? 'bg-white border-slate-200 hover:border-indigo-400 hover:shadow-indigo-500/10' : 'bg-card border-line hover:border-indigo-500/50 shadow-lg'
                ]"
              >
                <div class="space-y-1.5 flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span :class="['px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase font-mono', getPriorityBadgeClass(evt.priority)]">
                      {{ evt.priority }}
                    </span>
                    <span :class="['text-[10px] font-medium px-2 py-0.5 rounded-md border flex items-center gap-1', isLightTheme ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-muted text-gray-300 border-line-hover']">
                      <Icon name="tag" size="xs" />
                      {{ evt.category }}
                    </span>
                  </div>

                  <h3 :class="['text-sm font-bold truncate transition', isLightTheme ? 'text-slate-900 group-hover:text-indigo-600' : 'text-white group-hover:text-indigo-300']">{{ evt.title }}</h3>
                  <p v-if="evt.description" :class="['text-xs line-clamp-2', isLightTheme ? 'text-slate-600' : 'text-gray-400']">{{ evt.description }}</p>

                  <div :class="['flex items-center gap-4 text-[11px] font-mono pt-1', isLightTheme ? 'text-slate-500' : 'text-gray-400']">
                    <span class="flex items-center gap-1">
                      <Icon name="clock" size="xs" />
                      {{ evt.startTime }} - {{ evt.endTime }}
                    </span>
                    <span class="flex items-center gap-1">
                      <Icon name="calendar" size="xs" />
                      {{ evt.startDate }}
                    </span>
                  </div>
                </div>

                <!-- Actions -->
                <div :class="['flex items-center gap-2 shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0', isLightTheme ? 'border-slate-200' : 'border-line']">
                  <button 
                    @click="toggleStatus(evt)"
                    :class="['px-3 py-1.5 rounded-xl text-xs font-bold transition border', getStatusClass(evt.status)]"
                  >
                    {{ evt.status }}
                  </button>
                  <button @click="openEditModal(evt)" :class="['p-2 rounded-xl transition', isLightTheme ? 'bg-slate-100 hover:bg-slate-200 text-slate-600' : 'bg-muted hover:bg-hover text-gray-300']" title="Tahrirlash">
                    <Icon name="edit" size="sm" />
                  </button>
                  <button @click="deleteEventItem(evt.id)" :class="['p-2 rounded-xl transition', isLightTheme ? 'bg-red-50 hover:bg-red-100 text-red-600' : 'bg-muted hover:bg-red-500/20 text-red-400']" title="O'chirish">
                    <Icon name="delete" size="sm" />
                  </button>
                </div>
              </div>

              <div v-if="selectedDayEvents.length === 0" :class="['border rounded-2xl p-8 text-center space-y-3', isLightTheme ? 'bg-white border-slate-200' : 'bg-card border-line']">
                <div class="w-12 h-12 rounded-2xl bg-indigo-600/10 text-indigo-600 flex items-center justify-center mx-auto">
                  <Icon name="calendar" size="lg" />
                </div>
                <h4 :class="['text-sm font-bold', isLightTheme ? 'text-slate-900' : 'text-white']">Ushbu kunga rejalashtirilgan vazifa yo'q</h4>
                <p :class="['text-xs max-w-sm mx-auto', isLightTheme ? 'text-slate-500' : 'text-gray-400']">Yangi vazifa yaratish uchun yuqoridagi tugmani bosing yoki AI Chatga "Ertaga meeting bor" deb yozing.</p>
              </div>
            </div>

            <!-- Side Reminders & Integration Status -->
            <div class="lg:col-span-4 space-y-4">
              <div :class="['border rounded-2xl p-4 space-y-3 shadow-md', isLightTheme ? 'bg-white border-slate-200' : 'bg-card border-line shadow-xl']">
                <div :class="['flex items-center justify-between border-b pb-2', isLightTheme ? 'border-slate-200' : 'border-line']">
                  <span :class="['text-xs font-bold flex items-center gap-2', isLightTheme ? 'text-slate-900' : 'text-white']">
                    <Icon name="bell" size="sm" />
                    Yaqinlashayotgan AI Eslatmalar
                  </span>
                  <span class="text-[9px] bg-emerald-500/20 text-emerald-600 px-2 py-0.5 rounded font-mono font-bold">Telegram Active</span>
                </div>

                <div class="space-y-2 text-xs">
                  <div v-for="evt in upcomingReminders.slice(0, 3)" :key="evt.id" :class="['p-2.5 rounded-xl border space-y-1', isLightTheme ? 'bg-slate-50 border-slate-200' : 'bg-muted border-line-strong']">
                    <div :class="['font-bold truncate', isLightTheme ? 'text-slate-800' : 'text-white']">{{ evt.title }}</div>
                    <div :class="['text-[10px] flex items-center justify-between', isLightTheme ? 'text-slate-500' : 'text-gray-400']">
                      <span class="flex items-center gap-1">
                        <Icon name="clock" size="xs" />
                        {{ evt.startDate }} ({{ evt.startTime }})
                      </span>
                      <span class="text-amber-600 font-mono font-bold">30 min oldin</span>
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
            <Icon name="calendar" size="md" />
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
import taskService from '../services/taskService';
import DayPlanner from './DayPlanner.vue';
import WeekTaskStrip from './WeekTaskStrip.vue';
import {
  MONTH_NAMES,
  WEEKDAY_NAMES,
  toDateKey,
  parseDateKey,
  errorText
} from '../utils/date';

// How many day columns the strip renders, and how far the ‹ / › buttons slide it.
const STRIP_DAY_COUNT = 7;
const STRIP_SHIFT_DAYS = 3;

export default {
  name: 'CalendarWorkspace',
  components: { DayPlanner, WeekTaskStrip },
  data() {
    const today = new Date();
    const todayKey = toDateKey(today);

    return {
      events: [],
      currentViewTab: 'month', // 'month', 'week', 'day'
      // The 'month' tab holds the per-day task board now that the month grid is gone,
      // so it is labelled for what it shows rather than for a calendar span.
      viewTabs: [
        { key: 'month', label: 'Vazifalar' },
        { key: 'week', label: 'Haftalik' },
        { key: 'day', label: 'Kunlik' }
      ],
      selectedDateKey: todayKey,
      todayDateKey: todayKey,
      selectedCategoryFilter: 'All',
      categories: ['All', 'Meeting', 'Work', 'Deadline', 'Call', 'Personal', 'Project'],

      // When set, the Trello-style day planner takes over the whole workspace.
      plannerDayKey: null,
      // { '2026-08-01': [task, ...] } — the full cards behind the day table below the grid.
      tasksByDay: {},
      // Which week the day table shows; the grid above can be scrolled independently.
      stripAnchorKey: todayKey,
      isLoadingEvents: true,

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
      },
      isLightTheme: document.documentElement.classList.contains('light')
    };
  },
  computed: {
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
    headerStats() {
      return [
        {
          label: 'bajarildi',
          value: this.completedCount,
          dotClass: 'bg-emerald-500',
          chipClass: this.isLightTheme
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
        },
        {
          label: 'kutilmoqda',
          value: this.pendingCount,
          dotClass: 'bg-amber-500',
          chipClass: this.isLightTheme
            ? 'bg-amber-50 border-amber-200 text-amber-700'
            : 'bg-amber-500/10 border-amber-500/25 text-amber-300'
        },
        {
          label: 'shoshilinch',
          value: this.urgentCount,
          dotClass: 'bg-rose-500',
          chipClass: this.isLightTheme
            ? 'bg-rose-50 border-rose-200 text-rose-700'
            : 'bg-rose-500/10 border-rose-500/25 text-rose-300'
        }
      ];
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
    // The day columns start AT the anchor (today by default) and run forward, so the
    // current day always sits flush left and the week opens out to the right —
    // a Monday-first window would bury today mid-scroll on a Thursday.
    stripDays() {
      const start = parseDateKey(this.stripAnchorKey || this.todayDateKey);
      const dayNames = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
      const days = [];

      for (let i = 0; i < STRIP_DAY_COUNT; i++) {
        const curr = new Date(start);
        curr.setDate(start.getDate() + i);
        const dateKey = toDateKey(curr);
        const tasks = this.tasksByDay[dateKey] || [];
        const doneCount = tasks.filter(t => t.status === 'Done').length;

        days.push({
          dateKey,
          // Indexed by the real weekday, not by column position, now that the window
          // can start on any day.
          dayName: dayNames[curr.getDay()],
          dateStr: `${curr.getDate()}-${MONTH_NAMES[curr.getMonth()]}`,
          isToday: dateKey === this.todayDateKey,
          tasks,
          events: this.eventsByDate[dateKey] || [],
          doneCount,
          completionRate: tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0
        });
      }

      return days;
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
  // One hook per lifecycle event: the options object previously declared `mounted` and
  // `beforeUnmount` twice, so the later pair silently replaced the earlier one and the
  // theme observer never ran — the workspace stayed on whatever theme it loaded with.
  async mounted() {
    this.themeObserver = new MutationObserver(() => {
      this.isLightTheme = document.documentElement.classList.contains('light');
    });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    window.addEventListener('calendar-updated', this.fetchEvents);
    await Promise.all([this.fetchEvents(), this.fetchStripTasks()]);
  },
  beforeUnmount() {
    if (this.themeObserver) this.themeObserver.disconnect();
    window.removeEventListener('calendar-updated', this.fetchEvents);
  },
  watch: {
    // The day table follows whichever day is selected in the grid.
    selectedDateKey(key) {
      if (key) this.stripAnchorKey = key;
    },
    stripAnchorKey: 'fetchStripTasks'
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
    openPlanner(dateKey) {
      this.plannerDayKey = dateKey || this.todayDateKey;
    },
    closePlanner() {
      this.plannerDayKey = null;
      this.fetchStripTasks();
    },
    /** Loads the cards for the seven columns currently shown under the calendar. */
    async fetchStripTasks() {
      const days = this.stripDays;
      if (!days.length) return;
      try {
        const tasks = await taskService.getTasksForRange(days[0].dateKey, days[days.length - 1].dateKey);
        const grouped = {};
        for (const task of tasks) {
          (grouped[task.dayKey] = grouped[task.dayKey] || []).push(task);
        }
        this.tasksByDay = grouped;
      } catch (e) {
        this.tasksByDay = {};
      }
    },
    /** delta 0 snaps back to today; otherwise the window slides three days at a time. */
    shiftStripDays(delta) {
      if (delta === 0) {
        this.stripAnchorKey = this.todayDateKey;
        return;
      }
      const d = parseDateKey(this.stripAnchorKey || this.todayDateKey);
      d.setDate(d.getDate() + delta * STRIP_SHIFT_DAYS);
      this.stripAnchorKey = toDateKey(d);
    },
    /**
     * Todo → Doing → Done → Todo. The full board is one click away, but moving a card
     * one step forward is the common case and shouldn't need a page change.
     */
    async cycleTaskStatus(task) {
      const next = { Todo: 'Doing', Doing: 'Done', Done: 'Todo' }[task.status] || 'Todo';
      const previous = task.status;
      task.status = next; // optimistic — the column re-renders immediately
      try {
        await taskService.updateTask(task.id, { status: next });
        await this.fetchStripTasks();
      } catch (e) {
        task.status = previous;
        alert('Vazifa holatini yangilab bo\'lmadi: ' + errorText(e));
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
  }
};
</script>
