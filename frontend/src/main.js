import { createApp } from 'vue';
import App from './App.vue';
import Icon from './components/ui/Icon.vue';
import { initTheme } from './services/themeService';
import './style.css';

// The inline script in index.html already applied the right class before paint;
// this call attaches the system-preference listener for the rest of the session.
initTheme();

const app = createApp(App);

// Icons appear in nearly every template; registering once avoids repeating the
// same import in each component.
app.component('Icon', Icon);

app.mount('#app');
