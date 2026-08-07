<template>
  <div class="flex-1 flex flex-col h-full bg-canvas text-gray-100 overflow-hidden">

    <!-- PAGE HEADER -->
    <header class="border-b border-line bg-surface/80 backdrop-blur-xl px-4 sm:px-6 py-4 shrink-0">
      <div class="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div class="flex items-center gap-3 min-w-0">
          <button
            @click="$emit('back')"
            class="p-2 rounded-xl bg-muted hover:bg-hover text-gray-300 hover:text-white transition shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Taqvimga qaytish"
          >
            <Icon name="prev" size="md" />
          </button>

          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h1 class="text-lg sm:text-xl font-bold text-white tracking-tight truncate">{{ longDate }}</h1>
              <span v-if="isToday" class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 shrink-0">Bugun</span>
            </div>
            <p class="text-xs text-gray-400 mt-0.5">Kunlik vazifalar taxtasi — kartani ushlab boshqa ustunga suring</p>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <button @click="goToDay(-1)" class="p-2 rounded-xl bg-raised hover:bg-hover text-gray-400 hover:text-white transition" aria-label="Oldingi kun">
            <Icon name="prev" size="md" />
          </button>
          <button @click="goToDay(1)" class="p-2 rounded-xl bg-raised hover:bg-hover text-gray-400 hover:text-white transition" aria-label="Keyingi kun">
            <Icon name="next" size="md" />
          </button>
          <button
            @click="openCreate('Todo')"
            class="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/25 transition flex items-center gap-2"
          >
            <Icon name="add" size="md" />
            Yangi vazifa
          </button>
        </div>
      </div>

      <!-- PROGRESS BAR -->
      <div class="max-w-7xl mx-auto mt-4 flex items-center gap-3">
        <div class="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500 ease-out"
            :style="{ width: completionRate + '%' }"
          ></div>
        </div>
        <span class="text-[11px] font-mono text-gray-400 shrink-0 tabular-nums">
          {{ doneCount }}/{{ totalCount }} bajarildi ({{ completionRate }}%)
        </span>
      </div>
    </header>

    <!-- BOARD -->
    <main class="flex-1 overflow-y-auto p-4 sm:p-6">
      <div class="max-w-7xl mx-auto space-y-4 sm:space-y-5">

        <!-- CALENDAR EVENTS FOR THIS DAY — a separate data model from tasks (booked
             meetings/deliveries vs. a to-do board). Shown here, clearly labeled, so
             opening a day that has an event but no tasks never looks like the event
             vanished — before this, the board below was the only thing rendered and a
             day with "1 item" in the week strip but zero tasks looked broken. -->
        <section v-if="events.length" class="rounded-2xl border border-line bg-surface overflow-hidden">
          <div class="flex items-center gap-2 px-4 py-3 border-b border-line">
            <Icon name="calendar" size="sm" />
            <h2 class="text-xs font-bold text-white tracking-wide uppercase">Taqvim eventlari</h2>
            <span class="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-muted text-gray-400 tabular-nums">{{ events.length }}</span>
          </div>
          <div class="p-3 flex flex-wrap gap-2.5">
            <button
              v-for="evt in events"
              :key="evt.id"
              @click="$emit('edit-event', evt)"
              class="text-left rounded-xl border border-line bg-card hover:border-indigo-500/40 hover:bg-raised transition px-3 py-2.5 min-w-[220px] flex-1 sm:flex-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md border" :class="priorityClass(evt.priority)">{{ evt.priority }}</span>
                <span class="text-[10px] font-mono text-gray-400">{{ evt.startTime }}{{ evt.endTime ? ' - ' + evt.endTime : '' }}</span>
              </div>
              <div class="text-xs font-semibold text-white mt-1.5 leading-snug">{{ evt.title }}</div>
              <div class="text-[10px] text-gray-500 mt-0.5 flex items-center gap-1">
                <Icon name="tag" size="xs" />
                {{ evt.category }}
              </div>
            </button>
          </div>
        </section>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5 items-start">

        <section
          v-for="col in columns"
          :key="col.status"
          class="rounded-2xl border transition-colors duration-200"
          :class="dragOverColumn === col.status
            ? 'border-indigo-500/70 bg-indigo-500/[0.06]'
            : 'border-line bg-surface'"
          @dragover.prevent="onColumnDragOver(col.status)"
          @dragleave="onColumnDragLeave(col.status)"
          @drop.prevent="onDrop(col.status, null)"
        >
          <!-- Column header -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-line">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full" :class="col.dot"></span>
              <h2 class="text-xs font-bold text-white tracking-wide uppercase">{{ col.label }}</h2>
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-muted text-gray-400 tabular-nums">
                {{ tasksByStatus[col.status].length }}
              </span>
            </div>
            <button
              @click="openCreate(col.status)"
              class="p-1.5 rounded-lg text-gray-500 hover:text-indigo-300 hover:bg-muted transition"
              :aria-label="col.label + ' ustuniga vazifa qo\'shish'"
            >
              <Icon name="add" size="md" />
            </button>
          </div>

          <div class="p-3 space-y-2.5 min-h-[140px]">
            <!-- Skeletons -->
            <template v-if="isLoading">
              <div v-for="n in 2" :key="'sk' + n" class="rounded-xl border border-line bg-card p-3 space-y-2 animate-pulse">
                <div class="h-3 rounded bg-hover w-3/4"></div>
                <div class="h-2 rounded bg-sunken w-1/2"></div>
                <div class="flex gap-2 pt-1">
                  <div class="h-4 w-12 rounded-md bg-sunken"></div>
                  <div class="h-4 w-16 rounded-md bg-sunken"></div>
                </div>
              </div>
            </template>

            <!-- Cards -->
            <template v-else>
              <article
                v-for="task in tasksByStatus[col.status]"
                :key="task.id"
                draggable="true"
                @dragstart="onDragStart(task, $event)"
                @dragend="onDragEnd"
                @dragover.prevent.stop="onCardDragOver(col.status, task)"
                @drop.prevent.stop="onDrop(col.status, task)"
                :class="[
                  'group rounded-xl border bg-card p-3 cursor-grab active:cursor-grabbing transition-all duration-200',
                  draggedTask && draggedTask.id === task.id
                    ? 'opacity-40 scale-[0.98] border-indigo-500/50'
                    : 'border-line hover:border-indigo-500/40 hover:bg-raised',
                  dropTargetId === task.id ? 'ring-2 ring-indigo-500/60' : ''
                ]"
              >
                <div class="flex items-start gap-2">
                  <button
                    @click="toggleDone(task)"
                    class="mt-0.5 w-4 h-4 rounded-[5px] border flex items-center justify-center shrink-0 transition focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    :class="task.status === 'Done'
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'border-[#3A3F4F] hover:border-indigo-400'"
                    :aria-label="task.status === 'Done' ? 'Bajarilmagan deb belgilash' : 'Bajarildi deb belgilash'"
                  >
                    <Icon v-if="task.status === 'Done'" name="check" size="xs" :stroke-width="3" />
                  </button>

                  <div class="min-w-0 flex-1">
                    <h3
                      class="text-xs font-semibold leading-snug break-words"
                      :class="task.status === 'Done' ? 'text-gray-500 line-through' : 'text-white'"
                    >
                      {{ task.title }}
                    </h3>
                    <p v-if="task.description" class="text-[11px] text-gray-400 mt-1 line-clamp-2 leading-relaxed">
                      {{ task.description }}
                    </p>
                  </div>

                  <div class="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button @click="openEdit(task)" class="p-1 rounded-md text-gray-500 hover:text-indigo-300 hover:bg-line transition" aria-label="Tahrirlash">
                      <Icon name="edit" size="sm" />
                    </button>
                    <button @click="archiveTask(task)" class="p-1 rounded-md text-gray-500 hover:text-amber-300 hover:bg-line transition" aria-label="Arxivlash">
                      <Icon name="archive" size="sm" />
                    </button>
                    <button @click="removeTask(task)" class="p-1 rounded-md text-gray-500 hover:text-red-400 hover:bg-line transition" aria-label="O'chirish">
                      <Icon name="delete" size="sm" />
                    </button>
                  </div>
                </div>

                <div class="flex items-center gap-1.5 flex-wrap mt-2.5 pl-6">
                  <span class="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md border" :class="priorityClass(task.priority)">
                    {{ task.priority }}
                  </span>
                  <span v-if="task.deadline" class="text-[9px] font-mono px-1.5 py-0.5 rounded-md border flex items-center gap-1" :class="deadlineClass(task)">
                    <Icon name="clock" size="xs" />
                    {{ formatDeadline(task.deadline) }}
                  </span>
                  <span v-if="task.source === 'AI'" class="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/30">AI</span>
                </div>

                <!-- Keyboard-accessible alternative to dragging -->
                <div class="flex items-center gap-1 mt-2 pl-6 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button
                    v-if="col.prev"
                    @click="moveTo(task, col.prev)"
                    class="text-[10px] font-semibold px-1.5 py-0.5 rounded-md text-gray-500 hover:text-white hover:bg-line transition"
                  >← {{ statusLabel(col.prev) }}</button>
                  <button
                    v-if="col.next"
                    @click="moveTo(task, col.next)"
                    class="text-[10px] font-semibold px-1.5 py-0.5 rounded-md text-gray-500 hover:text-white hover:bg-line transition"
                  >{{ statusLabel(col.next) }} →</button>
                </div>
              </article>

              <!-- Empty state -->
              <div
                v-if="tasksByStatus[col.status].length === 0"
                class="rounded-xl border border-dashed border-hover py-8 px-3 text-center"
              >
                <div class="flex justify-center mb-1.5 opacity-40">
                  <Icon :name="col.emptyIcon" size="xl" />
                </div>
                <p class="text-[11px] text-gray-500 leading-relaxed">{{ col.emptyText }}</p>
                <button
                  v-if="col.status === 'Todo'"
                  @click="openCreate('Todo')"
                  class="mt-2.5 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 transition"
                >+ Birinchi vazifani qo'shing</button>
              </div>
            </template>
          </div>
        </section>
      </div>
      </div>
    </main>

    <!-- CREATE / EDIT MODAL -->
    <div
      v-if="isModalOpen"
      class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      @click.self="closeModal"
    >
      <div class="bg-card border border-line-strong rounded-3xl w-full max-w-md p-6 space-y-5 shadow-2xl">
        <div class="flex items-center justify-between border-b border-line pb-3">
          <h3 class="text-base font-bold text-white">{{ editingId ? 'Vazifani tahrirlash' : 'Yangi vazifa' }}</h3>
          <button @click="closeModal" class="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-line transition" aria-label="Yopish">
            <Icon name="close" size="lg" />
          </button>
        </div>

        <form @submit.prevent="submitModal" class="space-y-4 text-xs">
          <div>
            <label class="block font-semibold text-gray-300 mb-1">Vazifa nomi *</label>
            <input
              ref="titleInput"
              v-model="form.title"
              type="text"
              required
              placeholder="Masalan: Yetkazib beruvchiga qo'ng'iroq"
              class="w-full bg-canvas border border-line-strong focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-white outline-none transition"
            />
          </div>

          <div>
            <label class="block font-semibold text-gray-300 mb-1">Tavsif</label>
            <textarea
              v-model="form.description"
              rows="3"
              placeholder="Qo'shimcha tafsilotlar..."
              class="w-full bg-canvas border border-line-strong focus:border-indigo-500 rounded-xl px-3.5 py-2 text-white outline-none resize-none transition"
            ></textarea>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block font-semibold text-gray-300 mb-1">Prioritet</label>
              <select v-model="form.priority" class="w-full bg-canvas border border-line-strong rounded-xl px-3 py-2 text-white outline-none">
                <option value="Low">Low (Past)</option>
                <option value="Medium">Medium (O'rta)</option>
                <option value="High">High (Yuqori)</option>
                <option value="Urgent">Urgent (Shoshilinch)</option>
              </select>
            </div>
            <div>
              <label class="block font-semibold text-gray-300 mb-1">Holati</label>
              <select v-model="form.status" class="w-full bg-canvas border border-line-strong rounded-xl px-3 py-2 text-white outline-none">
                <option value="Todo">Todo (Bajarilishi kerak)</option>
                <option value="Doing">Doing (Jarayonda)</option>
                <option value="Done">Done (Bajarildi)</option>
              </select>
            </div>
          </div>

          <div>
            <label class="block font-semibold text-gray-300 mb-1">Deadline (ixtiyoriy)</label>
            <input v-model="form.deadline" type="datetime-local" class="w-full bg-canvas border border-line-strong rounded-xl px-3 py-2 text-white outline-none" />
          </div>

          <p v-if="modalError" class="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {{ modalError }}
          </p>

          <div class="pt-3 border-t border-line flex items-center justify-end gap-2">
            <button type="button" @click="closeModal" class="px-4 py-2 rounded-xl bg-line text-gray-300 font-semibold hover:bg-line-hover transition">
              Bekor qilish
            </button>
            <button type="submit" :disabled="isSaving" class="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold shadow-lg transition">
              {{ isSaving ? 'Saqlanmoqda...' : (editingId ? 'Saqlash' : 'Qo\'shish') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script>
import { nextTick } from 'vue';
import taskService from '../services/taskService';
import { formatLongDate, todayKey, addDays, errorText } from '../utils/date';

// emptyIcon: a semantic name resolved by the shared <Icon> component.
const COLUMNS = [
  { status: 'Todo',  label: 'To Do',  dot: 'bg-amber-400',   next: 'Doing', prev: null,    emptyIcon: 'pencil', emptyText: 'Bu ustun bo\'sh. Kun rejasini shu yerdan boshlang.' },
  { status: 'Doing', label: 'Doing',  dot: 'bg-cyan-400',    next: 'Done',  prev: 'Todo',  emptyIcon: 'zap',    emptyText: 'Hozircha jarayondagi vazifa yo\'q.' },
  { status: 'Done',  label: 'Done',   dot: 'bg-emerald-400', next: null,    prev: 'Doing', emptyIcon: 'check-circle', emptyText: 'Hali hech narsa bajarilmadi.' }
];

export default {
  name: 'DayPlanner',
  props: {
    dayKey: { type: String, required: true },
    // Calendar events for this day, passed down from CalendarWorkspace's own event list
    // rather than fetched again here — it already loaded them for the week strip.
    events: { type: Array, default: () => [] }
  },
  emits: ['back', 'changed', 'navigate', 'edit-event'],
  data() {
    return {
      columns: COLUMNS,
      tasks: [],
      isLoading: true,

      draggedTask: null,
      dragOverColumn: null,
      dropTargetId: null,

      isModalOpen: false,
      isSaving: false,
      modalError: '',
      editingId: null,
      form: this.emptyForm('Todo')
    };
  },
  computed: {
    longDate() {
      return formatLongDate(this.dayKey);
    },
    isToday() {
      return this.dayKey === todayKey();
    },
    tasksByStatus() {
      const grouped = { Todo: [], Doing: [], Done: [] };
      this.tasks.forEach(t => {
        if (grouped[t.status]) grouped[t.status].push(t);
      });
      Object.values(grouped).forEach(list => list.sort((a, b) => a.order - b.order));
      return grouped;
    },
    totalCount() {
      return this.tasks.length;
    },
    doneCount() {
      return this.tasks.filter(t => t.status === 'Done').length;
    },
    completionRate() {
      if (!this.totalCount) return 0;
      return Math.round((this.doneCount / this.totalCount) * 100);
    }
  },
  watch: {
    dayKey: {
      immediate: true,
      handler() {
        this.fetchTasks();
      }
    }
  },
  methods: {
    emptyForm(status) {
      return { title: '', description: '', priority: 'Medium', status: status || 'Todo', deadline: '' };
    },
    statusLabel(status) {
      const col = COLUMNS.find(c => c.status === status);
      return col ? col.label : status;
    },
    async fetchTasks() {
      this.isLoading = true;
      try {
        this.tasks = await taskService.getTasksForDay(this.dayKey);
      } catch (e) {
        this.tasks = [];
        alert('Vazifalarni yuklab bo\'lmadi: ' + errorText(e));
      } finally {
        this.isLoading = false;
      }
    },
    goToDay(delta) {
      this.$emit('navigate', addDays(this.dayKey, delta));
    },

    // --- STYLING HELPERS ---
    priorityClass(p) {
      if (p === 'Urgent') return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
      if (p === 'High') return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      if (p === 'Medium') return 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
      return 'bg-gray-500/15 text-gray-400 border-gray-500/30';
    },
    formatDeadline(value) {
      const d = new Date(value);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    },
    deadlineClass(task) {
      if (task.status === 'Done') return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
      return new Date(task.deadline) < new Date()
        ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
        : 'bg-muted text-gray-400 border-line-hover';
    },

    // --- DRAG & DROP ---
    onDragStart(task, event) {
      this.draggedTask = task;
      event.dataTransfer.effectAllowed = 'move';
      // Firefox refuses to start a drag unless some data is set.
      event.dataTransfer.setData('text/plain', task.id);
    },
    onDragEnd() {
      this.draggedTask = null;
      this.dragOverColumn = null;
      this.dropTargetId = null;
    },
    onColumnDragOver(status) {
      this.dragOverColumn = status;
    },
    onColumnDragLeave(status) {
      if (this.dragOverColumn === status) this.dragOverColumn = null;
    },
    onCardDragOver(status, task) {
      this.dragOverColumn = status;
      this.dropTargetId = this.draggedTask && this.draggedTask.id === task.id ? null : task.id;
    },
    async onDrop(status, targetTask) {
      const dragged = this.draggedTask;
      this.onDragEnd();
      if (!dragged) return;

      const column = this.tasksByStatus[status].filter(t => t.id !== dragged.id);
      const insertAt = targetTask ? column.findIndex(t => t.id === targetTask.id) : column.length;
      column.splice(insertAt < 0 ? column.length : insertAt, 0, dragged);

      const orderedIds = column.map(t => t.id);
      // Nothing actually moved.
      if (dragged.status === status && orderedIds.indexOf(dragged.id) === this.tasksByStatus[status].findIndex(t => t.id === dragged.id)) {
        return;
      }

      // Optimistic: repaint immediately, reconcile with the server response.
      const snapshot = this.tasks.map(t => ({ ...t }));
      this.tasks = this.tasks.map(t => {
        const idx = orderedIds.indexOf(t.id);
        if (idx === -1) return t;
        return { ...t, status, order: idx, completedAt: status === 'Done' ? (t.completedAt || new Date().toISOString()) : null };
      });

      try {
        this.tasks = await taskService.reorder(this.dayKey, status, orderedIds);
        this.$emit('changed');
      } catch (e) {
        this.tasks = snapshot;
        alert('Vazifani ko\'chirib bo\'lmadi: ' + errorText(e));
      }
    },
    async moveTo(task, status) {
      const column = this.tasksByStatus[status].filter(t => t.id !== task.id);
      const orderedIds = [...column.map(t => t.id), task.id];

      const snapshot = this.tasks.map(t => ({ ...t }));
      this.tasks = this.tasks.map(t => (t.id === task.id ? { ...t, status, order: orderedIds.length - 1 } : t));

      try {
        this.tasks = await taskService.reorder(this.dayKey, status, orderedIds);
        this.$emit('changed');
      } catch (e) {
        this.tasks = snapshot;
        alert('Vazifani ko\'chirib bo\'lmadi: ' + errorText(e));
      }
    },

    // --- CRUD ---
    async toggleDone(task) {
      const nextStatus = task.status === 'Done' ? 'Todo' : 'Done';
      await this.moveTo(task, nextStatus);
    },
    openCreate(status) {
      this.editingId = null;
      this.modalError = '';
      this.form = this.emptyForm(status);
      this.isModalOpen = true;
      nextTick(() => this.$refs.titleInput && this.$refs.titleInput.focus());
    },
    openEdit(task) {
      this.editingId = task.id;
      this.modalError = '';
      this.form = {
        title: task.title,
        description: task.description || '',
        priority: task.priority,
        status: task.status,
        // <input type="datetime-local"> needs local wall-clock, not a UTC ISO string.
        deadline: task.deadline ? toLocalInputValue(task.deadline) : ''
      };
      this.isModalOpen = true;
      nextTick(() => this.$refs.titleInput && this.$refs.titleInput.focus());
    },
    closeModal() {
      this.isModalOpen = false;
      this.modalError = '';
    },
    async submitModal() {
      if (!this.form.title.trim()) {
        this.modalError = 'Vazifa nomini kiriting.';
        return;
      }
      this.isSaving = true;
      this.modalError = '';

      const payload = {
        title: this.form.title.trim(),
        description: this.form.description,
        priority: this.form.priority,
        status: this.form.status,
        deadline: this.form.deadline ? new Date(this.form.deadline).toISOString() : null,
        dayKey: this.dayKey
      };

      try {
        if (this.editingId) {
          const updated = await taskService.updateTask(this.editingId, payload);
          this.tasks = this.tasks.map(t => (t.id === updated.id ? updated : t));
        } else {
          const created = await taskService.createTask(payload);
          this.tasks = [...this.tasks, created];
        }
        this.$emit('changed');
        this.closeModal();
      } catch (e) {
        this.modalError = errorText(e);
      } finally {
        this.isSaving = false;
      }
    },
    async archiveTask(task) {
      const snapshot = this.tasks;
      this.tasks = this.tasks.filter(t => t.id !== task.id);
      try {
        await taskService.updateTask(task.id, { archived: true });
        this.$emit('changed');
      } catch (e) {
        this.tasks = snapshot;
        alert('Arxivlab bo\'lmadi: ' + errorText(e));
      }
    },
    async removeTask(task) {
      if (!confirm(`"${task.title}" o'chirilsinmi?`)) return;
      const snapshot = this.tasks;
      this.tasks = this.tasks.filter(t => t.id !== task.id);
      try {
        await taskService.deleteTask(task.id);
        this.$emit('changed');
      } catch (e) {
        this.tasks = snapshot;
        alert('O\'chirib bo\'lmadi: ' + errorText(e));
      }
    }
  }
};

function toLocalInputValue(value) {
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
</script>
