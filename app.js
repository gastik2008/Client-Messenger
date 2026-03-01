// === КОНФИГУРАЦИЯ ===
const WS_URL = 'wss://client-messenger-production.up.railway.app'; // Для локального: 'ws://localhost:3000'
const USERNAME_REGEX = /^[A-Za-z0-9]+$/;
const MAX_USERNAME_LEN = 20;

// === ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ===
let socket;
let currentUser = null;
let currentChat = 'general'; // 'general' или username собеседника
let users = [];
let encryptMode = false;

// === ИНИЦИАЛИЗАЦИЯ ===
document.addEventListener('DOMContentLoaded', () => {
  // Проверка сохранённой сессии
  const savedUser = localStorage.getItem('messenger_user');
  if (savedUser) {
    currentUser = JSON.parse(savedUser);
    connectWebSocket();
  }
});

function connectWebSocket() {
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    console.log('✅ Подключено к серверу');
    if (currentUser) {
      socket.send(JSON.stringify({ type: 'login', username: currentUser.username }));
      loadChatsFromStorage();
      showChatWindow();
    }
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleMessage(data);
  };

  socket.onclose = () => {
    console.log('❌ Соединение закрыто');
    setTimeout(connectWebSocket, 3000); // Авто-переподключение
  };

  socket.onerror = (err) => console.error('WebSocket error:', err);
}

// === ОБРАБОТКА СООБЩЕНИЙ С СЕРВЕРА ===
function handleMessage(data) {
  switch (data.type) {
    case 'login_success':
      currentUser = { username: data.username };
      localStorage.setItem('messenger_user', JSON.stringify(currentUser));
      loadChatsFromStorage();
      showChatWindow();
      break;

    case 'login_error':
    case 'register_error':
      document.getElementById('authError').textContent = data.message;
      break;

    case 'register_success':
      document.getElementById('authError').textContent = '✅ Регистрация успешна! Войдите.';
      document.getElementById('authError').style.color = 'var(--success)';
      break;

    case 'user_list':
      users = data.users.filter(u => u !== currentUser.username);
      renderUserList();
      // Уведомление о новых пользователях (сравнение с предыдущим списком)
      if (window.prevUsers) {
        const newUsers = users.filter(u => !window.prevUsers.includes(u));
        newUsers.forEach(u => addSystemMessage(`🎉 ${u} присоединился к чату`));
      }
      window.prevUsers = [...users];
      break;

    case 'receive_message':
      // Определяем, в какой чат пришло сообщение
      const chatId = data.privateTo || data.privateFrom || 'general';
      const isForMe = !data.privateTo || data.privateTo === currentUser.username || data.privateFrom === currentChat;
      
      if (chatId === currentChat && isForMe) {
        renderMessage(data);
        saveMessageToStorage(chatId, data);
      } else if (chatId !== 'general' && isForMe) {
        // Сообщение в личном чате, который не активен — показываем бейдж (упрощённо: уведомление)
        addSystemMessage(`📩 Новое сообщение от ${data.privateFrom || data.sender}`);
      }
      break;

    case 'system':
      if (currentChat === 'general') {
        addSystemMessage(data.text);
      }
      break;
  }
}

// === АВТОРИЗАЦИЯ ===
function validateUsername(username) {
  if (!username || username.length === 0) return 'Введите имя';
  if (username.length > MAX_USERNAME_LEN) return `Макс. ${MAX_USERNAME_LEN} символов`;
  if (!USERNAME_REGEX.test(username)) return 'Только латиница и цифры, без пробелов';
  return null;
}

function login() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const error = validateUsername(username);
  
  if (error) {
    document.getElementById('authError').textContent = error;
    document.getElementById('authError').style.color = 'var(--error)';
    return;
  }
  
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    connectWebSocket();
    setTimeout(() => socket.send(JSON.stringify({ type: 'login', username, password })), 500);
  } else {
    socket.send(JSON.stringify({ type: 'login', username, password }));
  }
}

function register() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const error = validateUsername(username);
  
  if (error) {
    document.getElementById('authError').textContent = error;
    document.getElementById('authError').style.color = 'var(--error)';;
    return;
  }
  
  socket.send(JSON.stringify({ type: 'register', username, password }));
}

// === ИНТЕРФЕЙС ===
function showChatWindow() {
  document.getElementById('loginWindow').classList.add('hidden');
  document.getElementById('chatWindow').classList.remove('hidden');
  // Переключаемся на общий чат по умолчанию
  switchToGeneral();
}

function renderUserList() {
  const list = document.getElementById('userList');
  list.innerHTML = '';
  
  users.forEach(username => {
    const item = document.createElement('div');
    item.className = `user-item ${currentChat === username ? 'active' : ''}`;
    item.innerHTML = `<span>👤 ${username}</span><span class="private-badge">●</span>`;
    item.onclick = () => switchToPrivate(username);
    list.appendChild(item);
  });
}

function switchToGeneral() {
  currentChat = 'general';
  document.getElementById('chatHeader').textContent = '💬 Общий чат';
  document.getElementById('userList').querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
  loadChatMessages('general');
}

function switchToPrivate(username) {
  currentChat = username;
  document.getElementById('chatHeader').innerHTML = `💬 Личный чат с <strong>@${username}</strong>`;
  document.getElementById('userList').querySelectorAll('.user-item').forEach(el => {
    el.classList.toggle('active', el.textContent.includes(username));
  });
  loadChatMessages(username);
}

// === ОТОБРАЖЕНИЕ СООБЩЕНИЙ ===
function renderMessage(msg) {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  
  const isOwn = msg.sender === currentUser.username;
  const isSystem = msg.type === 'system';
  
  div.className = `message ${isSystem ? 'system' : isOwn ? 'own' : 'other'}`;
  if (msg.encrypted) div.classList.add('encrypted');
  
  if (!isSystem) {
    const sender = msg.privateFrom || msg.sender;
    div.innerHTML = `<span class="sender">${sender}${msg.encrypted ? ' 🔐' : ''}</span>${escapeHtml(msg.text)}`;
  } else {
    div.textContent = msg.text;
  }
  
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function addSystemMessage(text) {
  renderMessage({ type: 'system', text });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// === ОТПРАВКА СООБЩЕНИЙ ===
function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text) return;
  
  let messageText = text;
  let isEncrypted = false;
  
  // Применяем шифрование если включено и указан ключ
  if (encryptMode) {
    const key = document.getElementById('encryptKey').value.trim();
    if (key && USERNAME_REGEX.test(key)) {
      messageText = xorEncrypt(text, key);
      isEncrypted = true;
    }
  }
  
  const payload = {
    type: 'send_message',
    text: messageText,
    encrypted: isEncrypted,
    timestamp: Date.now()
  };
  
  // Личное сообщение
  if (currentChat !== 'general') {
    payload.privateTo = currentChat;
  }
  
  socket.send(JSON.stringify(payload));
  
  // Отображаем у себя сразу
  renderMessage({
    sender: currentUser.username,
    text: messageText,
    encrypted: isEncrypted,
    privateTo: payload.privateTo
  });
  
  // Сохраняем в localStorage
  saveMessageToStorage(currentChat, {
    sender: currentUser.username,
    text: messageText,
    encrypted: isEncrypted,
    timestamp: payload.timestamp,
    privateTo: payload.privateTo
  });
  
  input.value = '';
  // Не скрываем encryptPanel — пусть пользователь сам решает
}

function handleKeyPress(e) {
  if (e.key === 'Enter') sendMessage();
}

// === ШИФРОВАНИЕ (XOR + base64) ===
function toggleEncrypt() {
  const panel = document.getElementById('encryptPanel');
  encryptMode = !encryptMode;
  panel.classList.toggle('hidden', !encryptMode);
  if (encryptMode) {
    document.getElementById('encryptKey').focus();
  }
}

function xorEncrypt(text, passphrase) {
  if (!passphrase) return text;
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(
      text.charCodeAt(i) ^ passphrase.charCodeAt(i % passphrase.length)
    );
  }
  return btoa(result); // base64 для безопасной передачи
}

function xorDecrypt(text, passphrase) {
  if (!passphrase) return text;
  try {
    const decoded = atob(text);
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(
        decoded.charCodeAt(i) ^ passphrase.charCodeAt(i % passphrase.length)
      );
    }
    return result;
  } catch {
    return '[Ошибка расшифровки]';
  }
}

// === LOCALSTORAGE ДЛЯ ЧАТОВ ===
const CHAT_STORAGE_KEY = 'messenger_chats_v1';

function saveMessageToStorage(chatId, msg) {
  try {
    const chats = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || '{}');
    if (!chats[chatId]) chats[chatId] = [];
    
    chats[chatId].push({
      ...msg,
      id: Date.now() + Math.random()
    });
    
    // Ограничиваем историю (последние 100 сообщений на чат)
    if (chats[chatId].length > 100) {
      chats[chatId] = chats[chatId].slice(-100);
    }
    
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chats));
  } catch (e) {
    console.warn('Не удалось сохранить чат:', e);
  }
}

function loadChatMessages(chatId) {
  const container = document.getElementById('messages');
  container.innerHTML = '';
  
  try {
    const chats = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || '{}');
    const messages = chats[chatId] || [];
    
    if (chatId === 'general' && messages.length === 0) {
      addSystemMessage('👋 Добро пожаловать в общий чат!');
    }
    
    messages.forEach(msg => {
      // Если сообщение зашифровано и это не наше — пробуем расшифровать (если ключ в сессии)
      let displayText = msg.text;
      if (msg.encrypted && msg.sender !== currentUser.username) {
        const savedKey = sessionStorage.getItem(`encrypt_key_${chatId}`);
        if (savedKey) {
          displayText = xorDecrypt(msg.text, savedKey) + ' 🔓';
        } else {
          displayText = '[Зашифрованное сообщение]';
        }
      }
      
      renderMessage({ ...msg, text: displayText });
    });
  } catch (e) {
    console.warn('Не удалось загрузить чат:', e);
    if (chatId === 'general') {
      addSystemMessage('👋 Добро пожаловать в общий чат!');
    }
  }
}

function loadChatsFromStorage() {
  // Просто предзагружаем общий чат, остальные — по клику
  loadChatMessages('general');
}

// === ВЫХОД ===
function logout() {
  localStorage.removeItem('messenger_user');
  if (socket) socket.close();
  location.reload();
}

// Глобальная функция для доступа из HTML
window.logout = logout;
