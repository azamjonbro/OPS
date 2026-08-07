<template>
  <div class="min-h-screen bg-canvas text-gray-100 font-sans flex items-center justify-center p-4">
    <div class="w-full max-w-md bg-surface border border-line rounded-3xl p-8 shadow-2xl space-y-6">
      <div class="text-center space-y-3">
        <div class="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center text-white mx-auto shadow-md font-bold">SA</div>
        <div>
          <h1 class="text-2xl font-extrabold text-white tracking-tight">SuperAdmin Kirish</h1>
          <p class="text-xs text-gray-400 mt-1">Ulanmalar, tokenlar va tizim sozlamalari — faqat vakolatli shaxs uchun.</p>
        </div>
      </div>

      <form @submit.prevent="handleLogin" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-gray-300 mb-1.5">Login</label>
          <input
            v-model="username"
            type="text"
            required
            autocomplete="username"
            placeholder="Login"
            class="w-full bg-card border border-line rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
          />
        </div>

        <div>
          <label class="block text-xs font-semibold text-gray-300 mb-1.5">Parol</label>
          <input
            v-model="password"
            type="password"
            required
            autocomplete="current-password"
            placeholder="••••••••"
            class="w-full bg-card border border-line rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition"
          />
        </div>

        <p v-if="errorMessage" class="text-xs text-rose-400 font-medium">{{ errorMessage }}</p>

        <button
          type="submit"
          :disabled="isLoading"
          class="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-sm shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <span v-if="isLoading" class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
          <span>{{ isLoading ? 'Tekshirilmoqda...' : 'Kirish' }}</span>
        </button>
      </form>

      <div class="text-center">
        <button @click="$emit('back-to-chat')" class="text-xs text-gray-400 hover:text-white transition">← Chatga qaytish</button>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios';
import { API_BASE } from '../services/api';

export default {
  name: 'AdminLoginPage',
  emits: ['admin-login-success', 'back-to-chat'],
  data() {
    return {
      username: '',
      password: '',
      isLoading: false,
      errorMessage: ''
    };
  },
  methods: {
    async handleLogin() {
      this.isLoading = true;
      this.errorMessage = '';
      try {
        const res = await axios.post(`${API_BASE}/api/auth/login`, {
          username: this.username,
          password: this.password
        });
        localStorage.setItem('jarvis_admin_token', res.data.token);
        this.$emit('admin-login-success');
      } catch (e) {
        this.errorMessage = e.response?.data?.error || "Kirishda xatolik yuz berdi";
      } finally {
        this.isLoading = false;
      }
    }
  }
};
</script>
