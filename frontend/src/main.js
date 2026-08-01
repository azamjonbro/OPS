import { createApp } from 'vue';
import App from './App.vue';
import Icon from './components/ui/Icon.vue';
import './style.css';

const app = createApp(App);

// Icons appear in nearly every template; registering once avoids repeating the
// same import in each component.
app.component('Icon', Icon);

app.mount('#app');
