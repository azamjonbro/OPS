<template>
  <div
    :class="[
      'flex-1 flex flex-col h-full overflow-hidden relative transition-colors duration-200',
      isLightTheme ? 'bg-[#F4F6FB] text-slate-800' : 'bg-canvas text-gray-100',
    ]"
  >
    <!-- TOP EXECUTIVE HEADER BAR -->
    <header
      :class="[
        'border-b p-4 sm:px-6 z-10 shrink-0 backdrop-blur-xl transition-colors',
        isLightTheme
          ? 'bg-white/85 border-slate-200/80 shadow-sm'
          : 'bg-surface/90 border-line',
      ]"
    >
      <div
        class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 max-w-7xl mx-auto"
      >
        <!-- Title & Subtitle -->
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-600 via-indigo-600 to-purple-700 flex items-center justify-center text-white shadow-lg shadow-purple-500/25 shrink-0"
          >
            <svg
              class="w-5 h-5 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h1
                :class="[
                  'text-xl font-bold tracking-tight',
                  isLightTheme ? 'text-slate-900' : 'text-white',
                ]"
              >
                My Projects & Knowledge Bank
              </h1>
              <span
                class="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-600 border border-purple-500/30"
                >AI Permanent Memory</span
              >
            </div>
            <p
              :class="[
                'text-xs mt-0.5',
                isLightTheme ? 'text-slate-500' : 'text-gray-400',
              ]"
            >
              Sotuv strategiyalari, PDF kitoblar, biznes logikalari va kompaniya
              SOP yo'riqnomalarini AI xotirasida saqlang va tahlil qiling.
            </p>
          </div>
        </div>

        <!-- Top Action Buttons -->
        <div class="flex items-center gap-2.5 shrink-0">
          <button
            @click="openCreateModal()"
            class="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-purple-600/25 transition flex items-center gap-2"
          >
            <svg
              class="w-4 h-4 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 4v16m8-8H4"
              />
            </svg>
            <span>+ Yangi Bilim / Hujjat Qo'shish</span>
          </button>

          <button
            @click="$emit('switch-to-chat')"
            :class="[
              'px-3.5 py-2 rounded-xl text-xs font-semibold border transition flex items-center gap-1.5',
              isLightTheme
                ? 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                : 'bg-card text-gray-300 border-line hover:bg-muted hover:text-white',
            ]"
          >
            <Icon name="chat" size="sm" />
            Chatga Qaytish
          </button>
        </div>
      </div>

      <!-- SEARCH, FILTER & CATEGORIES BAR -->
      <div
        :class="[
          'max-w-7xl mx-auto mt-4 pt-3 border-t flex flex-col md:flex-row md:items-center justify-between gap-3',
          isLightTheme ? 'border-slate-200' : 'border-line',
        ]"
      >
        <!-- Category Filter Pills -->
        <div
          class="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none text-xs"
        >
          <button
            v-for="cat in categories"
            :key="cat.id"
            @click="selectedCategory = cat.id"
            :class="[
              'px-3 py-1.5 rounded-xl font-semibold transition shrink-0 border flex items-center gap-1.5',
              selectedCategory === cat.id
                ? 'bg-purple-600 text-white border-purple-600 shadow-md shadow-purple-500/20'
                : isLightTheme
                  ? 'bg-white text-slate-600 border-slate-200 hover:bg-purple-50 hover:text-purple-600'
                  : 'bg-card text-gray-400 border-line hover:bg-muted hover:text-white',
            ]"
          >
            <Icon :name="cat.icon" size="xs" />
            <span>{{ cat.label }}</span>
          </button>
        </div>

        <!-- Search input & View switch -->
        <div class="flex items-center gap-2">
          <!-- Search input -->
          <div class="relative flex-1 sm:w-64">
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Qidiruv (nomi, kalit so'z)..."
              :class="[
                'w-full rounded-xl pl-8 pr-3 py-1.5 text-xs outline-none transition border',
                isLightTheme
                  ? 'bg-white border-slate-200 text-slate-800 placeholder-slate-400 focus:border-purple-500'
                  : 'bg-card border-line text-white placeholder-gray-500 focus:border-purple-500',
              ]"
            />
            <svg
              class="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>

          <!-- View Mode Switch (Grid / List) -->
          <div
            :class="[
              'flex items-center gap-0.5 p-1 rounded-xl border',
              isLightTheme
                ? 'bg-slate-100 border-slate-200'
                : 'bg-raised border-line',
            ]"
          >
            <button
              @click="viewLayout = 'grid'"
              :class="[
                'p-1 rounded-lg text-xs transition',
                viewLayout === 'grid'
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-gray-400 hover:text-white',
              ]"
              title="Grid Ko'rinishi"
            >
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                />
              </svg>
            </button>
            <button
              @click="viewLayout = 'list'"
              :class="[
                'p-1 rounded-lg text-xs transition',
                viewLayout === 'list'
                  ? 'bg-purple-600 text-white shadow'
                  : 'text-gray-400 hover:text-white',
              ]"
              title="Ro'yxat Ko'rinishi"
            >
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </header>

    <!-- MAIN KNOWLEDGE WORKSPACE AREA -->
    <main class="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar">
      <div class="max-w-7xl mx-auto space-y-6">
        <!-- Loading Indicator -->
        <div
          v-if="isLoading"
          class="flex flex-col items-center justify-center py-20 space-y-3"
        >
          <div
            class="w-10 h-10 rounded-full border-4 border-purple-500/20 border-t-purple-600 animate-spin"
          ></div>
          <p
            :class="[
              'text-xs font-mono',
              isLightTheme ? 'text-slate-500' : 'text-gray-400',
            ]"
          >
            AI Xotirasi Yuklanmoqda...
          </p>
        </div>

        <!-- Empty State -->
        <div
          v-else-if="filteredItems.length === 0"
          :class="[
            'border rounded-3xl p-12 text-center space-y-4 max-w-lg mx-auto shadow-lg',
            isLightTheme ? 'bg-white border-slate-200' : 'bg-card border-line',
          ]"
        >
          <div
            class="w-16 h-16 rounded-3xl bg-purple-600/10 text-purple-600 flex items-center justify-center mx-auto"
          >
            <Icon name="book" size="2xl" />
          </div>
          <div>
            <h3
              :class="[
                'text-base font-bold',
                isLightTheme ? 'text-slate-900' : 'text-white',
              ]"
            >
              Hozircha bilim yoki hujjat yo'q
            </h3>
            <p
              :class="[
                'text-xs mt-1 leading-relaxed',
                isLightTheme ? 'text-slate-500' : 'text-gray-400',
              ]"
            >
              Sotuv qoidalari, PDF kitoblar, kompaniya yo'riqnomalari yoki
              loyiha ma'lumotlarini yuklash uchun tugmani bosing.
            </p>
          </div>
          <button
            @click="openCreateModal()"
            class="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-md transition inline-flex items-center gap-2"
          >
            <span>+ Yangi Hujjat Yaratish</span>
          </button>
        </div>

        <!-- GRID LAYOUT -->
        <div
          v-else-if="viewLayout === 'grid'"
          class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          <div
            v-for="item in filteredItems"
            :key="item._id || item.key"
            :class="[
              'border rounded-3xl p-5 space-y-4 transition-all duration-200 shadow-sm hover:shadow-xl flex flex-col justify-between group relative overflow-hidden',
              isLightTheme
                ? 'bg-white border-slate-200 hover:border-purple-400 hover:bg-purple-50/20'
                : 'bg-card border-line hover:border-purple-500/50 hover:bg-[#1C1F2B]',
            ]"
          >
            <!-- Card Header -->
            <div class="space-y-2">
              <div class="flex items-center justify-between gap-2">
                <span
                  :class="[
                    'text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border font-mono',
                    getCategoryBadgeClass(item.category),
                  ]"
                >
                  {{ getCategoryLabel(item.category) }}
                </span>

                <span
                  v-if="item.priority"
                  :class="[
                    'text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border font-mono',
                    getPriorityBadgeClass(item.priority),
                  ]"
                >
                  {{ item.priority }}
                </span>
              </div>

              <!-- Title -->
              <h3
                @click="openViewModal(item)"
                :class="[
                  'text-sm font-bold tracking-tight line-clamp-2 cursor-pointer transition',
                  isLightTheme
                    ? 'text-slate-900 group-hover:text-purple-600'
                    : 'text-white group-hover:text-purple-300',
                ]"
              >
                {{ item.title }}
              </h3>

              <!-- File Name or Date -->
              <div
                :class="[
                  'flex items-center gap-2 text-[10px] font-mono',
                  isLightTheme ? 'text-slate-500' : 'text-gray-400',
                ]"
              >
                <span
                  v-if="item.metadata && item.metadata.fileName"
                  class="truncate flex items-center gap-1 font-semibold text-purple-500"
                >
                  <Icon name="file" size="xs" />
                  {{ item.metadata.fileName }}
                </span>
                <span class="ml-auto">{{ formatDate(item.updatedAt) }}</span>
              </div>
            </div>

            <!-- Content Snippet / Description -->
            <p
              :class="[
                'text-xs line-clamp-4 leading-relaxed p-3 rounded-2xl border font-sans',
                isLightTheme
                  ? 'bg-slate-50 border-slate-200 text-slate-700'
                  : 'bg-[#14161C] border-[#252936] text-gray-300',
              ]"
            >
              {{ item.description || item.content }}
            </p>

            <!-- Tags -->
            <div
              v-if="item.tags && item.tags.length > 0"
              class="flex flex-wrap gap-1"
            >
              <span
                v-for="tag in item.tags"
                :key="tag"
                class="text-[9px] font-mono px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-600 border border-purple-500/20"
              >
                #{{ tag }}
              </span>
            </div>

            <!-- Action Buttons Footer -->
            <div
              :class="[
                'pt-3 border-t flex items-center justify-between gap-2',
                isLightTheme ? 'border-slate-200' : 'border-line',
              ]"
            >
              <button
                @click="openViewModal(item)"
                :class="[
                  'px-3 py-1.5 rounded-xl text-xs font-semibold transition border flex items-center gap-1',
                  isLightTheme
                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                    : 'bg-muted hover:bg-hover text-gray-300 border-line',
                ]"
              >
                <Icon name="book" size="xs" />
                O'qish
              </button>

              <button
                @click="queryAiAboutMemory(item)"
                class="px-3 py-1.5 rounded-xl bg-purple-600/15 hover:bg-purple-600 text-purple-600 hover:text-white border border-purple-500/30 text-xs font-bold transition flex items-center gap-1"
              >
                <Icon name="brain" size="xs" />
                <span>AI Tahlil</span>
              </button>

              <div class="flex items-center gap-1">
                <button
                  @click="openEditModal(item)"
                  :class="[
                    'p-1.5 rounded-lg transition',
                    isLightTheme
                      ? 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                      : 'text-gray-400 hover:text-white hover:bg-hover',
                  ]"
                  title="Tahrirlash"
                >
                  <Icon name="edit" size="sm" />
                </button>
                <button
                  @click="deleteItem(item._id)"
                  :class="[
                    'p-1.5 rounded-lg transition',
                    isLightTheme
                      ? 'text-slate-400 hover:text-red-600 hover:bg-red-50'
                      : 'text-gray-400 hover:text-red-400 hover:bg-red-500/20',
                  ]"
                  title="O'chirish"
                >
                  <Icon name="delete" size="sm" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- LIST LAYOUT -->
        <div v-else class="space-y-3">
          <div
            v-for="item in filteredItems"
            :key="item._id || item.key"
            :class="[
              'border rounded-2xl p-4 transition-all shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 group',
              isLightTheme
                ? 'bg-white border-slate-200 hover:border-purple-300 shadow-slate-100'
                : 'bg-card border-line hover:border-purple-500/40 shadow-lg',
            ]"
          >
            <div class="space-y-1.5 flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span
                  :class="[
                    'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border font-mono',
                    getCategoryBadgeClass(item.category),
                  ]"
                >
                  {{ getCategoryLabel(item.category) }}
                </span>
                <span
                  v-if="item.metadata && item.metadata.fileName"
                  class="text-[10px] font-mono text-purple-500 font-semibold flex items-center gap-1"
                >
                  <Icon name="file" size="xs" />
                  {{ item.metadata.fileName }}
                </span>
                <span
                  :class="[
                    'text-[10px] font-mono ml-auto',
                    isLightTheme ? 'text-slate-400' : 'text-gray-500',
                  ]"
                  >{{ formatDate(item.updatedAt) }}</span
                >
              </div>

              <h3
                @click="openViewModal(item)"
                :class="[
                  'text-sm font-bold truncate cursor-pointer transition',
                  isLightTheme
                    ? 'text-slate-900 group-hover:text-purple-600'
                    : 'text-white group-hover:text-purple-300',
                ]"
              >
                {{ item.title }}
              </h3>

              <p
                :class="[
                  'text-xs line-clamp-2',
                  isLightTheme ? 'text-slate-600' : 'text-gray-400',
                ]"
              >
                {{ item.description || item.content }}
              </p>
            </div>

            <!-- List item actions -->
            <div
              :class="[
                'flex items-center gap-2 shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0',
                isLightTheme ? 'border-slate-200' : 'border-line',
              ]"
            >
              <button
                @click="openViewModal(item)"
                :class="[
                  'px-3 py-1.5 rounded-xl text-xs font-semibold border transition flex items-center gap-1',
                  isLightTheme
                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                    : 'bg-muted hover:bg-hover text-gray-300 border-line',
                ]"
              >
                <Icon name="book" size="xs" />
                O'qish
              </button>
              <button
                @click="queryAiAboutMemory(item)"
                class="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow transition flex items-center gap-1"
              >
                <Icon name="brain" size="xs" />
                AI Tahlil
              </button>
              <button
                @click="openEditModal(item)"
                :class="[
                  'p-2 rounded-xl transition',
                  isLightTheme
                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                    : 'bg-muted hover:bg-hover text-gray-300',
                ]"
                title="Tahrirlash"
              >
                <Icon name="edit" size="sm" />
              </button>
              <button
                @click="deleteItem(item._id)"
                :class="[
                  'p-2 rounded-xl transition',
                  isLightTheme
                    ? 'bg-red-50 hover:bg-red-100 text-red-600'
                    : 'bg-muted hover:bg-red-500/20 text-red-400',
                ]"
                title="O'chirish"
              >
                <Icon name="delete" size="sm" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- FULL CREATE / EDIT MODAL EDITOR -->
    <div
      v-if="isModalOpen"
      class="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div
        :class="[
          'rounded-3xl w-full max-w-3xl p-6 sm:p-8 space-y-6 shadow-2xl relative max-h-[90vh] overflow-y-auto custom-scrollbar border transition-colors',
          isLightTheme
            ? 'bg-white border-slate-200 text-slate-800'
            : 'bg-[#14161C] border-[#252936] text-white',
        ]"
      >
        <!-- Modal Header -->
        <div
          :class="[
            'flex items-center justify-between border-b pb-4',
            isLightTheme ? 'border-slate-200' : 'border-line',
          ]"
        >
          <div class="flex items-center gap-3">
            <div
              class="w-10 h-10 rounded-2xl bg-purple-600/15 text-purple-600 border border-purple-500/30 flex items-center justify-center"
            >
              <Icon name="book" size="lg" />
            </div>
            <div>
              <h3
                :class="[
                  'text-lg font-bold tracking-tight',
                  isLightTheme ? 'text-slate-900' : 'text-white',
                ]"
              >
                {{
                  isEditMode
                    ? "Hujjatni Tahrirlash"
                    : "AI Doimiy Xotirasiga Yangi Bilim Qo'shish"
                }}
              </h3>
              <p
                :class="[
                  'text-xs',
                  isLightTheme ? 'text-slate-500' : 'text-gray-400',
                ]"
              >
                Ushbu bilim AI javoblari va biznes tahlillarida doimiy
                qo'llaniladi.
              </p>
            </div>
          </div>
          <button
            @click="isModalOpen = false"
            :class="[
              'p-2 rounded-xl transition',
              isLightTheme
                ? 'text-slate-400 hover:bg-slate-100 text-slate-600'
                : 'text-gray-400 hover:bg-hover hover:text-white',
            ]"
          >
            <Icon name="close" size="md" />
          </button>
        </div>

        <form @submit.prevent="saveModalItem" class="space-y-4 text-xs">
          <!-- Title -->
          <div>
            <label
              :class="[
                'block font-bold mb-1',
                isLightTheme ? 'text-slate-700' : 'text-gray-300',
              ]"
              >Hujjat / Bilim Nomi *</label
            >
            <input
              v-model="modalForm.title"
              type="text"
              required
              placeholder="masalan: Sotuvni oshirish strategiyasi 2026, CEO Qoidalari..."
              :class="[
                'w-full rounded-xl px-4 py-2.5 outline-none transition border text-xs',
                isLightTheme
                  ? 'bg-slate-50 border-slate-200 text-slate-800 focus:border-purple-500 focus:bg-white'
                  : 'bg-[#1C1F2A] border-[#2D3242] text-white focus:border-purple-500',
              ]"
            />
          </div>

          <!-- Category, Priority & Tags -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                :class="[
                  'block font-bold mb-1',
                  isLightTheme ? 'text-slate-700' : 'text-gray-300',
                ]"
                >Kategoriya</label
              >
              <select
                v-model="modalForm.category"
                :class="[
                  'w-full rounded-xl px-3 py-2.5 outline-none transition border text-xs',
                  isLightTheme
                    ? 'bg-slate-50 border-slate-200 text-slate-800'
                    : 'bg-[#1C1F2A] border-[#2D3242] text-white',
                ]"
              >
                <!-- Native <option> renders text only — no SVG/Icon component can appear
                     inside it, so these stay plain labels instead of carrying an emoji
                     that would be the one icon left un-swapped in this workspace. -->
                <option value="knowledge">PDF Kitob / Bilim Bazasi</option>
                <option value="business">Sotuv Logikasi & Strategiya</option>
                <option value="project">Yangi Loyiha / Project</option>
                <option value="architecture">
                  Texnik Arxitektura & Qoidalar
                </option>
                <option value="sop">Biznes SOP / Yo'riqnoma</option>
              </select>
            </div>

            <div>
              <label
                :class="[
                  'block font-bold mb-1',
                  isLightTheme ? 'text-slate-700' : 'text-gray-300',
                ]"
                >Prioritet (AI Darajasi)</label
              >
              <select
                v-model="modalForm.priority"
                :class="[
                  'w-full rounded-xl px-3 py-2.5 outline-none transition border text-xs',
                  isLightTheme
                    ? 'bg-slate-50 border-slate-200 text-slate-800'
                    : 'bg-[#1C1F2A] border-[#2D3242] text-white',
                ]"
              >
                <option value="Critical Rule">Kritik Biznes Qoidasi</option>
                <option value="High">Yuqori Prioritet</option>
                <option value="Normal">Standart Bilim</option>
              </select>
            </div>

            <div>
              <label
                :class="[
                  'block font-bold mb-1',
                  isLightTheme ? 'text-slate-700' : 'text-gray-300',
                ]"
                >Teglar (vergul bilan)</label
              >
              <input
                v-model="modalForm.tagsStr"
                type="text"
                placeholder="sales, strategy, billz"
                :class="[
                  'w-full rounded-xl px-3 py-2.5 outline-none transition border text-xs',
                  isLightTheme
                    ? 'bg-slate-50 border-slate-200 text-slate-800'
                    : 'bg-[#1C1F2A] border-[#2D3242] text-white',
                ]"
              />
            </div>
          </div>

          <!-- Description -->
          <div>
            <label
              :class="[
                'block font-bold mb-1',
                isLightTheme ? 'text-slate-700' : 'text-gray-300',
              ]"
              >Qisqa Tavsif (Summary)</label
            >
            <input
              v-model="modalForm.description"
              type="text"
              placeholder="Ushbu hujjat nimani anglatishi haqida qisqa izoh..."
              :class="[
                'w-full rounded-xl px-4 py-2 outline-none transition border text-xs',
                isLightTheme
                  ? 'bg-slate-50 border-slate-200 text-slate-800'
                  : 'bg-[#1C1F2A] border-[#2D3242] text-white',
              ]"
            />
          </div>

          <!-- File Upload Zone -->
          <div>
            <label
              :class="[
                'block font-bold mb-1',
                isLightTheme ? 'text-slate-700' : 'text-gray-300',
              ]"
              >Fayl Biriktirish (.pdf, .txt, .md, .doc, .json, .csv)</label
            >
            <input
              type="file"
              @change="handleFileUpload"
              accept=".pdf,.txt,.md,.doc,.docx,.json,.csv"
              :class="[
                'w-full text-xs cursor-pointer file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold',
                isLightTheme
                  ? 'file:bg-purple-100 file:text-purple-700 hover:file:bg-purple-200 text-slate-600'
                  : 'file:bg-purple-600/20 file:text-purple-300 hover:file:bg-purple-600/30 text-gray-400',
              ]"
            />
          </div>

          <!-- Rich Content Textarea -->
          <div>
            <label
              :class="[
                'block font-bold mb-1',
                isLightTheme ? 'text-slate-700' : 'text-gray-300',
              ]"
              >Hujjatning To'liq Matni & Logikalari *</label
            >
            <textarea
              v-model="modalForm.content"
              rows="12"
              required
              placeholder="Hujjatning to'liq matnini, qoidalarni yoki biznes strategiyasini bu yerga bering..."
              :class="[
                'w-full rounded-2xl px-4 py-3 outline-none transition border resize-y font-sans leading-relaxed text-xs',
                isLightTheme
                  ? 'bg-slate-50 border-slate-200 text-slate-800 focus:border-purple-500 focus:bg-white'
                  : 'bg-[#1C1F2A] border-[#2D3242] text-white focus:border-purple-500',
              ]"
            ></textarea>
          </div>

          <!-- Submit Footer -->
          <div
            :class="[
              'pt-4 border-t flex items-center justify-end gap-3',
              isLightTheme ? 'border-slate-200' : 'border-line',
            ]"
          >
            <button
              type="button"
              @click="isModalOpen = false"
              :class="[
                'px-4 py-2 rounded-xl text-xs font-semibold transition',
                isLightTheme
                  ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  : 'bg-muted text-gray-300 hover:bg-hover',
              ]"
            >
              Bekor Qilish
            </button>
            <button
              type="submit"
              :disabled="
                isSubmitting ||
                !modalForm.title.trim() ||
                !modalForm.content.trim()
              "
              class="px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white font-bold text-xs shadow-lg shadow-purple-600/25 transition flex items-center gap-2"
            >
              <span v-if="isSubmitting">Saqlanmoqda...</span>
              <template v-else>
                <Icon name="brain" size="sm" />
                <span>AI Doimiy Xotirasiga Saqlash</span>
              </template>
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- DOCUMENT READER / INSPECTION MODAL -->
    <div
      v-if="isViewModalOpen && activeViewingItem"
      class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
    >
      <div
        :class="[
          'rounded-3xl w-full max-w-4xl p-6 sm:p-8 space-y-6 shadow-2xl relative max-h-[90vh] flex flex-col border transition-colors',
          isLightTheme
            ? 'bg-white border-slate-200 text-slate-800'
            : 'bg-[#14161C] border-[#252936] text-white',
        ]"
      >
        <!-- Header -->
        <div
          :class="[
            'flex items-start justify-between border-b pb-4 gap-4 shrink-0',
            isLightTheme ? 'border-slate-200' : 'border-line',
          ]"
        >
          <div class="space-y-1.5 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span
                :class="[
                  'text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border font-mono',
                  getCategoryBadgeClass(activeViewingItem.category),
                ]"
              >
                {{ getCategoryLabel(activeViewingItem.category) }}
              </span>
              <span
                v-if="activeViewingItem.priority"
                :class="[
                  'text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border font-mono',
                  getPriorityBadgeClass(activeViewingItem.priority),
                ]"
              >
                {{ activeViewingItem.priority }}
              </span>
              <span
                :class="[
                  'text-[10px] font-mono',
                  isLightTheme ? 'text-slate-400' : 'text-gray-500',
                ]"
                >{{ formatDate(activeViewingItem.updatedAt) }}</span
              >
            </div>
            <h2
              :class="[
                'text-xl font-bold tracking-tight truncate',
                isLightTheme ? 'text-slate-900' : 'text-white',
              ]"
            >
              {{ activeViewingItem.title }}
            </h2>
          </div>

          <button
            @click="isViewModalOpen = false"
            :class="[
              'p-2 rounded-xl transition shrink-0',
              isLightTheme
                ? 'text-slate-400 hover:bg-slate-100 text-slate-600'
                : 'text-gray-400 hover:bg-hover hover:text-white',
            ]"
          >
            <Icon name="close" size="md" />
          </button>
        </div>

        <!-- Document Metadata Bar -->
        <div
          v-if="
            (activeViewingItem.metadata &&
              activeViewingItem.metadata.fileName) ||
            (activeViewingItem.tags && activeViewingItem.tags.length)
          "
          :class="[
            'p-3 rounded-2xl border text-xs flex flex-wrap items-center justify-between gap-2 shrink-0',
            isLightTheme
              ? 'bg-slate-50 border-slate-200'
              : 'bg-[#1C1F2A] border-[#2D3242]',
          ]"
        >
          <div
            v-if="
              activeViewingItem.metadata && activeViewingItem.metadata.fileName
            "
            class="font-mono text-purple-600 font-bold flex items-center gap-1.5"
          >
            <Icon name="file" size="xs" />
            Fayl: {{ activeViewingItem.metadata.fileName }}
          </div>
          <div
            v-if="activeViewingItem.tags && activeViewingItem.tags.length"
            class="flex flex-wrap gap-1"
          >
            <span
              v-for="tag in activeViewingItem.tags"
              :key="tag"
              class="text-[9px] font-mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 border border-purple-500/20"
            >
              #{{ tag }}
            </span>
          </div>
        </div>

        <!-- Full Document Body Container -->
        <div
          :class="[
            'flex-1 overflow-y-auto p-5 rounded-2xl border text-xs leading-relaxed font-sans custom-scrollbar',
            isLightTheme
              ? 'bg-slate-50/70 border-slate-200 text-slate-800'
              : 'bg-[#0B0C0E] border-[#252936] text-gray-200',
          ]"
        >
          <div class="whitespace-pre-wrap font-sans">
            {{ activeViewingItem.content }}
          </div>
        </div>

        <!-- Footer Actions -->
        <div
          :class="[
            'pt-4 border-t flex items-center justify-between gap-3 shrink-0',
            isLightTheme ? 'border-slate-200' : 'border-line',
          ]"
        >
          <div class="flex items-center gap-2">
            <button
              @click="openEditModal(activeViewingItem)"
              :class="[
                'px-3.5 py-2 rounded-xl text-xs font-semibold border transition flex items-center gap-1.5',
                isLightTheme
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
                  : 'bg-muted hover:bg-hover text-gray-300 border-line',
              ]"
            >
              <Icon name="edit" size="xs" />
              Tahrirlash
            </button>
            <button
              @click="deleteItem(activeViewingItem._id)"
              :class="[
                'px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5',
                isLightTheme
                  ? 'bg-red-50 text-red-600 hover:bg-red-100'
                  : 'bg-muted text-red-400 hover:bg-red-500/20',
              ]"
            >
              <Icon name="delete" size="xs" />
              O'chirish
            </button>
          </div>

          <button
            @click="queryAiAboutMemory(activeViewingItem)"
            class="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg transition flex items-center gap-2"
          >
            <Icon name="brain" size="sm" />
            <span>AI Bilan Ushbu Hujjatni Tahlil Qilish</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from "axios";
import { API_BASE } from "../services/api";

export default {
  name: "KnowledgeWorkspace",
  emits: ["switch-to-chat"],
  data() {
    return {
      items: [],
      isLoading: true,
      searchQuery: "",
      selectedCategory: "all",
      viewLayout: "grid", // 'grid' | 'list'

      // icon: a semantic name resolved by the shared <Icon> component (src/components/ui/Icon.vue).
      categories: [
        { id: "all", label: "Barchasi", icon: "library" },
        { id: "knowledge", label: "PDF & Bilim Bazasi", icon: "book" },
        { id: "business", label: "Sotuv Strategiyasi", icon: "business" },
        { id: "project", label: "Loyihalar", icon: "project" },
        { id: "architecture", label: "Texnik Qoidalar", icon: "architecture" },
        { id: "sop", label: "Biznes SOP", icon: "sop" },
      ],

      // Modal state for Create / Edit
      isModalOpen: false,
      isEditMode: false,
      editingId: null,
      isSubmitting: false,
      modalForm: {
        title: "",
        category: "knowledge",
        priority: "Normal",
        tagsStr: "",
        description: "",
        content: "",
        fileName: "",
      },

      // Modal state for View Reader
      isViewModalOpen: false,
      activeViewingItem: null,

      isLightTheme: document.documentElement.classList.contains("light"),
    };
  },
  mounted() {
    this.fetchItems();
    this.themeObserver = new MutationObserver(() => {
      this.isLightTheme = document.documentElement.classList.contains("light");
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  },
  beforeUnmount() {
    if (this.themeObserver) this.themeObserver.disconnect();
  },
  computed: {
    filteredItems() {
      return this.items.filter((item) => {
        const matchesCategory =
          this.selectedCategory === "all" ||
          item.category === this.selectedCategory;
        const q = this.searchQuery.toLowerCase().trim();
        const matchesQuery =
          !q ||
          (item.title && item.title.toLowerCase().includes(q)) ||
          (item.content && item.content.toLowerCase().includes(q)) ||
          (item.description && item.description.toLowerCase().includes(q)) ||
          (item.tags && item.tags.some((t) => t.toLowerCase().includes(q)));
        return matchesCategory && matchesQuery;
      });
    },
  },
  methods: {
    async fetchItems() {
      this.isLoading = true;
      try {
        const res = await axios.get(`${API_BASE}/api/chat/memory/items`);
        if (res.data && res.data.items) {
          this.items = res.data.items.filter(
            (i) => i.key !== "owner-personality-profile",
          );
        }
      } catch (e) {
        console.error("Error fetching knowledge items:", e);
      } finally {
        this.isLoading = false;
      }
    },
    openCreateModal() {
      this.isEditMode = false;
      this.editingId = null;
      this.modalForm = {
        title: "",
        category: "knowledge",
        priority: "Normal",
        tagsStr: "",
        description: "",
        content: "",
        fileName: "",
      };
      this.isModalOpen = true;
    },
    openEditModal(item) {
      if (this.isViewModalOpen) this.isViewModalOpen = false;
      this.isEditMode = true;
      this.editingId = item._id;
      this.modalForm = {
        title: item.title || "",
        category: item.category || "knowledge",
        priority: item.priority || "Normal",
        tagsStr: (item.tags || []).join(", "),
        description: item.description || "",
        content: item.content || "",
        fileName: item.metadata?.fileName || "",
      };
      this.isModalOpen = true;
    },
    openViewModal(item) {
      this.activeViewingItem = item;
      this.isViewModalOpen = true;
    },
    handleFileUpload(event) {
      const file = event.target.files[0];
      if (!file) return;
      this.modalForm.fileName = file.name;
      if (!this.modalForm.title) {
        this.modalForm.title = file.name.replace(/\.[^/.]+$/, "");
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        this.modalForm.content = e.target.result || "";
      };
      reader.readAsText(file);
    },
    async saveModalItem() {
      if (
        !this.modalForm.title.trim() ||
        !this.modalForm.content.trim() ||
        this.isSubmitting
      )
        return;
      this.isSubmitting = true;

      const payload = {
        title: this.modalForm.title.trim(),
        category: this.modalForm.category,
        priority: this.modalForm.priority,
        tags: this.modalForm.tagsStr
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        description: this.modalForm.description.trim(),
        content: this.modalForm.content.trim(),
        fileName: this.modalForm.fileName || "Knowledge Document",
      };

      try {
        if (this.isEditMode && this.editingId) {
          await axios.put(
            `${API_BASE}/api/chat/memory/items/${this.editingId}`,
            payload,
          );
        } else {
          await axios.post(`${API_BASE}/api/chat/memory/upload`, payload);
        }
        this.isModalOpen = false;
        await this.fetchItems();
      } catch (e) {
        alert(
          "Xotiraga saqlashda xatolik: " +
            (e.response?.data?.error || e.message),
        );
      } finally {
        this.isSubmitting = false;
      }
    },
    async deleteItem(id) {
      if (
        !confirm(
          "Ushbu hujjatni AI xotirasidan o'chirishga ishonchingiz komilmi?",
        )
      )
        return;
      try {
        await axios.delete(`${API_BASE}/api/chat/memory/items/${id}`);
        if (this.isViewModalOpen) this.isViewModalOpen = false;
        await this.fetchItems();
      } catch (e) {
        alert("O'chirishda xatolik: " + e.message);
      }
    },
    queryAiAboutMemory(item) {
      if (this.isViewModalOpen) this.isViewModalOpen = false;
      this.$emit(
        "switch-to-chat",
        `"${item.title}" xotira hujjati bo'yicha tahlil bering va undagi sotuv logikalarini tushuntiring.`,
      );
    },
    formatDate(dateStr) {
      if (!dateStr) return "";
      return new Date(dateStr).toLocaleDateString("uz-UZ", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    },
    getCategoryLabel(cat) {
      const found = this.categories.find((c) => c.id === cat);
      return found ? found.label : cat;
    },
    getCategoryBadgeClass(cat) {
      switch (cat) {
        case "business":
          return "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";
        case "project":
          return "bg-blue-500/10 text-blue-600 border-blue-500/30";
        case "architecture":
          return "bg-amber-500/10 text-amber-600 border-amber-500/30";
        case "sop":
          return "bg-purple-500/10 text-purple-600 border-purple-500/30";
        default:
          return "bg-indigo-500/10 text-indigo-600 border-indigo-500/30";
      }
    },
    getPriorityBadgeClass(p) {
      switch (p) {
        case "Critical Rule":
          return "bg-rose-500/15 text-rose-600 border-rose-500/30 font-bold";
        case "High":
          return "bg-amber-500/15 text-amber-600 border-amber-500/30 font-bold";
        default:
          return "bg-slate-500/15 text-slate-600 border-slate-500/30";
      }
    },
  },
};
</script>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(139, 92, 246, 0.25);
  border-radius: 9999px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(139, 92, 246, 0.5);
}
</style>
