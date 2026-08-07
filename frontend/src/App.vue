<template>
  <div class="h-screen bg-canvas text-gray-100 font-sans">
    <LoginPage v-if="!isAuthenticated" @login-success="onLoginSuccess" />
    <UserChat v-else-if="currentView === 'chat'" @switch-view="switchView" @logout="onLogout" />
    <AdminLoginPage v-else-if="!isAdminAuthenticated" @admin-login-success="onAdminLoginSuccess" @back-to-chat="() => switchView('chat')" />
    <AdminDashboard v-else @switch-view="switchView" @logout="onAdminLogout" />
  </div>
</template>

<script>
import UserChat from './components/UserChat.vue';
import AdminDashboard from './components/AdminDashboard.vue';
import LoginPage from './components/LoginPage.vue';
import AdminLoginPage from './components/AdminLoginPage.vue';

export default {
  components: {
    UserChat,
    AdminDashboard,
    LoginPage,
    AdminLoginPage
  },
  data() {
    return {
      isAuthenticated: localStorage.getItem('jarvis_auth') === 'true',
      // Separate from the chat's demo login on purpose — this is the gate in front of
      // API tokens/credentials, so it must be a real, server-verified session.
      isAdminAuthenticated: !!localStorage.getItem('jarvis_admin_token'),
      currentView: 'chat'
    };
  },
  mounted() {
    this.checkRoute();
    window.addEventListener('popstate', this.checkRoute);
    window.addEventListener('hashchange', this.checkRoute);
  },
  beforeUnmount() {
    window.removeEventListener('popstate', this.checkRoute);
    window.removeEventListener('hashchange', this.checkRoute);
  },
  methods: {
    checkRoute() {
      const path = window.location.pathname;
      const hash = window.location.hash;
      if (path === '/helpadmin' || hash === '#/helpadmin' || path.endsWith('/helpadmin')) {
        this.currentView = 'admin';
      } else {
        this.currentView = 'chat';
      }
    },
    switchView(viewName) {
      this.currentView = viewName;
      if (viewName === 'admin') {
        window.history.pushState({}, '', '/helpadmin');
      } else {
        window.history.pushState({}, '', '/');
      }
    },
    onLoginSuccess(userData) {
      this.isAuthenticated = true;
      localStorage.setItem('jarvis_auth', 'true');
      localStorage.setItem('jarvis_user', JSON.stringify(userData));
      this.checkRoute();
    },
    onLogout() {
      this.isAuthenticated = false;
      localStorage.removeItem('jarvis_auth');
      localStorage.removeItem('jarvis_user');
      window.history.pushState({}, '', '/');
    },
    onAdminLoginSuccess() {
      this.isAdminAuthenticated = true;
    },
    onAdminLogout() {
      this.isAdminAuthenticated = false;
      localStorage.removeItem('jarvis_admin_token');
      this.switchView('chat');
    }
  }
};
</script>
