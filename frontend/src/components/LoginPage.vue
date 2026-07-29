<template>
  <div class="min-h-screen bg-[#0B0C0E] text-gray-100 font-sans flex items-center justify-center p-4">
    <div class="w-full max-w-md bg-[#111317] border border-[#1F222A] rounded-3xl p-8 shadow-2xl space-y-6">
      <!-- Brand Logo Header -->
      <div class="text-center space-y-3">
        <div class="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center text-white mx-auto shadow-md">
          <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
          </svg>
        </div>
        <div>
          <h1 class="text-2xl font-extrabold text-white tracking-tight">Jarvis AI Workspace</h1>
          <p class="text-xs text-gray-400 mt-1">Store Hadiya POS & Executive AI System</p>
        </div>
      </div>

      <!-- Login Form -->
      <form @submit.prevent="handleLogin" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-gray-300 mb-1.5">Email yoki Loginingiz</label>
          <input 
            v-model="email" 
            type="text" 
            required
            placeholder="admin@hadiya.uz" 
            class="w-full bg-[#14161C] border border-[#1F222A] rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
          />
        </div>

        <div>
          <label class="block text-xs font-semibold text-gray-300 mb-1.5">Parolingiz</label>
          <div class="relative">
            <input 
              v-model="password" 
              :type="showPassword ? 'text' : 'password'" 
              required
              placeholder="••••••••" 
              class="w-full bg-[#14161C] border border-[#1F222A] rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition pr-10"
            />
            <button 
              type="button" 
              @click="showPassword = !showPassword" 
              class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition text-xs"
            >
              {{ showPassword ? 'Yashirish' : 'Ko\'rsat' }}
            </button>
          </div>
        </div>

        <div class="flex items-center justify-between text-xs pt-1">
          <label class="flex items-center gap-2 cursor-pointer text-gray-400 hover:text-gray-200">
            <input type="checkbox" v-model="rememberMe" class="rounded bg-[#14161C] border-[#1F222A] text-indigo-600 focus:ring-0" />
            Eslab qolish
          </label>
          <a href="#" class="text-indigo-400 hover:underline">Parolni unutdingizmi?</a>
        </div>

        <button 
          type="submit" 
          :disabled="isLoading"
          class="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-sm shadow-md transition flex items-center justify-center gap-2"
        >
          <span v-if="isLoading" class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
          <span>{{ isLoading ? 'Kirilmoqda...' : 'Tizimga Kirish' }}</span>
        </button>
      </form>

      <!-- Quick Demo Login Divider -->
      <div class="relative flex items-center justify-center">
        <div class="border-t border-[#1F222A] w-full"></div>
        <span class="bg-[#111317] px-3 text-[10px] uppercase font-bold text-gray-500 tracking-wider absolute">yoki</span>
      </div>

      <!-- Quick One-Click Demo Button -->
      <button 
        @click="handleDemoLogin" 
        class="w-full py-2.5 bg-[#171922] hover:bg-[#1E2230] text-indigo-300 border border-indigo-500/20 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-2"
      >
        <svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
        Demo Admin (Azamjon) Sifatida Kirish
      </button>

      <div class="text-center text-[11px] text-gray-500 pt-2">
        Store Hadiya POS v2.0 &bull; Secure AI Authentication
      </div>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      email: 'admin@hadiya.uz',
      password: 'admin',
      showPassword: false,
      rememberMe: true,
      isLoading: false
    };
  },
  methods: {
    handleLogin() {
      this.isLoading = true;
      setTimeout(() => {
        this.isLoading = false;
        this.$emit('login-success', {
          name: 'Azamjon (Store Hadiya)',
          email: this.email,
          role: 'BILLZ POS Admin'
        });
      }, 500);
    },
    handleDemoLogin() {
      this.$emit('login-success', {
        name: 'Azamjon (Store Hadiya)',
        email: 'admin@hadiya.uz',
        role: 'BILLZ POS Admin'
      });
    }
  }
};
</script>
