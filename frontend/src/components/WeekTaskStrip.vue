<template>
  <section :class="['border rounded-3xl shadow-md overflow-hidden transition-colors', isLightTheme ? 'bg-white border-slate-200' : 'bg-surface border-line shadow-2xl']">

    <!-- STRIP HEADER -->
    <div :class="['flex items-center justify-between gap-3 px-4 py-3 border-b', isLightTheme ? 'border-slate-200 bg-slate-50/70' : 'border-line bg-raised/60']">
      <div class="min-w-0">
        <h3 :class="['text-sm font-bold tracking-tight', isLightTheme ? 'text-slate-900' : 'text-white']">
          Kunlar bo'yicha vazifalar
        </h3>
        <p :class="['text-[11px] mt-0.5', isLightTheme ? 'text-slate-500' : 'text-gray-400']">
          Sanani bosing — o'sha kunning Trello taxtasi ochiladi. Status belgisini bosib holatni almashtiring.
        </p>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <button
          @click="$emit('shift-days', -1)"
          :class="['w-8 h-8 rounded-xl transition', isLightTheme ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'bg-muted hover:bg-hover text-gray-300']"
          title="3 kun orqaga"
          aria-label="3 kun orqaga"
        >‹</button>
        <button
          @click="$emit('shift-days', 0)"
          :class="['h-8 px-3 rounded-xl text-[11px] font-bold transition border', isLightTheme ? 'bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100' : 'bg-muted hover:bg-hover text-indigo-300 border-indigo-500/20']"
          title="Bugunga qaytish"
        >Bugun</button>
        <button
          @click="$emit('shift-days', 1)"
          :class="['w-8 h-8 rounded-xl transition', isLightTheme ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'bg-muted hover:bg-hover text-gray-300']"
          title="3 kun oldinga"
          aria-label="3 kun oldinga"
        >›</button>
      </div>
    </div>

    <!-- DAY COLUMNS -->
    <div ref="scroller" class="flex gap-3 p-3 overflow-x-auto custom-scrollbar items-stretch">
      <div
        v-for="day in days"
        :key="day.dateKey"
        :class="[
          'w-[248px] shrink-0 rounded-2xl border flex flex-col overflow-hidden transition-all',
          day.isToday
            ? (isLightTheme ? 'border-indigo-400 ring-1 ring-indigo-300 bg-indigo-50/40' : 'border-indigo-500/60 ring-1 ring-indigo-500/25 bg-[#161A26]')
            : (isLightTheme ? 'bg-slate-50/60 border-slate-200 hover:border-indigo-300' : 'bg-card border-line hover:border-line-hover'),
          day.dateKey === selectedDateKey ? (isLightTheme ? 'shadow-md' : 'shadow-lg shadow-indigo-900/20') : ''
        ]"
      >
        <!-- Header: the whole date is the door into that day's board. -->
        <button
          @click="$emit('open-day', day.dateKey)"
          :class="[
            'w-full text-left px-3 py-2.5 border-b transition group focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500',
            isLightTheme ? 'bg-white border-slate-200 hover:bg-indigo-50/60' : 'bg-raised border-line hover:bg-hover'
          ]"
          :title="day.dateStr + ' — kunlik vazifalar taxtasini ochish'"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div :class="['text-[10px] font-extrabold uppercase tracking-wider', day.isToday ? 'text-indigo-500' : (isLightTheme ? 'text-slate-400' : 'text-gray-500')]">
                {{ day.dayName }}
              </div>
              <div :class="['text-sm font-bold font-mono truncate transition', isLightTheme ? 'text-slate-900 group-hover:text-indigo-600' : 'text-white group-hover:text-indigo-300']">
                {{ day.dateStr }}
              </div>
            </div>

            <div class="flex flex-col items-end gap-1 shrink-0">
              <span v-if="day.isToday" class="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-indigo-600 text-white font-bold">BUGUN</span>
              <span
                v-if="day.tasks.length"
                :class="['text-[9px] font-mono px-1.5 py-0.5 rounded-full font-bold border', isLightTheme ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-muted text-gray-300 border-line-strong']"
              >{{ day.doneCount }}/{{ day.tasks.length }}</span>
            </div>
          </div>

          <!-- Completion bar: the day's shape at a glance, no numbers to read. -->
          <div v-if="day.tasks.length" :class="['h-1 rounded-full mt-2 overflow-hidden', isLightTheme ? 'bg-slate-200' : 'bg-muted']">
            <div
              class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
              :style="{ width: day.completionRate + '%' }"
            ></div>
          </div>
        </button>

        <!-- Task table -->
        <div class="flex-1 min-h-[190px] max-h-[380px] overflow-y-auto custom-scrollbar p-2 space-y-1.5">
          <div
            v-for="task in day.tasks"
            :key="task.id"
            :class="[
              'rounded-xl border px-2.5 py-2 transition group/task',
              isLightTheme ? 'bg-white border-slate-200 hover:border-indigo-300' : 'bg-raised border-line hover:border-indigo-500/40'
            ]"
          >
            <div class="flex items-start gap-2">
              <span :class="['w-1.5 h-1.5 rounded-full mt-1.5 shrink-0', priorityDot(task.priority)]" :title="'Prioritet: ' + task.priority"></span>

              <button
                @click="$emit('open-day', day.dateKey)"
                :class="[
                  'flex-1 text-left text-[11px] font-semibold leading-snug min-w-0 transition',
                  task.status === 'Done'
                    ? (isLightTheme ? 'text-slate-400 line-through' : 'text-gray-500 line-through')
                    : (isLightTheme ? 'text-slate-800 hover:text-indigo-600' : 'text-gray-100 hover:text-indigo-300')
                ]"
              >{{ task.title }}</button>
            </div>

            <!-- Status sits next to the task and cycles Todo → Doing → Done on click. -->
            <div class="flex items-center justify-between gap-2 mt-1.5 pl-3.5">
              <button
                @click="$emit('cycle-status', task)"
                :class="['px-2 py-0.5 rounded-lg text-[9px] font-bold border transition', statusClass(task.status)]"
                :title="'Holat: ' + statusLabel(task.status) + ' — keyingisiga o\'tkazish uchun bosing'"
              >
                {{ statusLabel(task.status) }}
              </button>
              <span v-if="task.deadline" :class="['text-[9px] font-mono', isLightTheme ? 'text-slate-400' : 'text-gray-500']">
                {{ shortTime(task.deadline) }}
              </span>
            </div>
          </div>

          <!-- Calendar events for the same day stay visible, clearly separated from tasks. -->
          <div v-if="day.events.length" class="pt-1.5 space-y-1">
            <div :class="['text-[9px] font-bold uppercase tracking-wider px-0.5', isLightTheme ? 'text-slate-400' : 'text-gray-500']">
              Taqvim eventlari
            </div>
            <div
              v-for="evt in day.events"
              :key="evt.id"
              @click="$emit('open-event', evt)"
              :class="[
                'rounded-lg px-2 py-1.5 text-[10px] cursor-pointer flex items-center justify-between gap-2 border transition',
                isLightTheme ? 'bg-indigo-50/60 border-indigo-100 text-slate-700 hover:border-indigo-300' : 'bg-muted/60 border-line-strong text-gray-300 hover:border-indigo-500/40'
              ]"
            >
              <span class="truncate font-semibold">{{ evt.title }}</span>
              <span class="font-mono opacity-70 shrink-0">{{ evt.startTime }}</span>
            </div>
          </div>

          <div
            v-if="!day.tasks.length && !day.events.length"
            :class="['h-full min-h-[120px] flex flex-col items-center justify-center gap-1 text-center px-2', isLightTheme ? 'text-slate-400' : 'text-gray-600']"
          >
            <span class="text-base opacity-60">—</span>
            <span class="text-[10px] italic">Vazifa yo'q</span>
          </div>
        </div>

        <!-- Footer add -->
        <button
          @click="$emit('open-day', day.dateKey)"
          :class="[
            'px-3 py-2 text-[10px] font-bold border-t transition',
            isLightTheme ? 'border-slate-200 text-indigo-600 hover:bg-indigo-50' : 'border-line text-indigo-300 hover:bg-hover'
          ]"
        >
          + Vazifa qo'shish
        </button>
      </div>
    </div>
  </section>
</template>

<script>
const STATUS_LABELS = { Todo: 'To Do', Doing: 'Doing', Done: 'Done' };

export default {
  name: 'WeekTaskStrip',
  props: {
    // [{ dateKey, dayName, dateStr, isToday, tasks, events, doneCount, completionRate }]
    days: { type: Array, required: true },
    selectedDateKey: { type: String, default: '' },
    isLightTheme: { type: Boolean, default: false }
  },
  emits: ['open-day', 'cycle-status', 'open-event', 'shift-days'],
  watch: {
    // A new window always starts at its first column; leaving the old scroll offset in
    // place would hide the day the user just navigated to.
    days(next, prev) {
      if (!next.length || !prev.length || next[0].dateKey === prev[0].dateKey) return;
      this.$nextTick(() => {
        if (this.$refs.scroller) this.$refs.scroller.scrollTo({ left: 0, behavior: 'smooth' });
      });
    }
  },
  methods: {
    statusLabel(status) {
      return STATUS_LABELS[status] || status;
    },
    statusClass(status) {
      if (status === 'Done') return 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40 hover:bg-emerald-500/25';
      if (status === 'Doing') return 'bg-cyan-500/15 text-cyan-500 border-cyan-500/40 hover:bg-cyan-500/25';
      return 'bg-amber-500/15 text-amber-500 border-amber-500/40 hover:bg-amber-500/25';
    },
    priorityDot(priority) {
      if (priority === 'Urgent') return 'bg-rose-500';
      if (priority === 'High') return 'bg-amber-500';
      if (priority === 'Medium') return 'bg-indigo-500';
      return 'bg-gray-500';
    },
    shortTime(deadline) {
      const d = new Date(deadline);
      if (Number.isNaN(d.getTime())) return '';
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
  }
};
</script>
