const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  // Health check для деплоя
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }
  // В продакшене здесь должна быть раздача статики или проксирование
  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocket.Server({ server });

// === ХРАНИЛИЩЕ В ПАМЯТИ ===
const users = new Map(); // username -> { password, ws, lastSeen }
const sessions = new Map(); // ws -> username
// Для личных чатов: храним историю в памяти (в реальном проекте — БД)
const chatHistory = { general: [] }; // chatId -> [{sender, text, timestamp, privateTo, encrypted}]

// === ОБРАБОТКА ПОДКЛЮЧЕНИЙ ===
wss.on('connection', (ws) => {
  console.log('🔗 Новое подключение');

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Неверный формат JSON' }));
      return;
    }

    const username = sessions.get(ws);

    switch (data.type) {
      case 'register':
        handleRegister(ws, data);
        break;
        
      case 'login':
        handleLogin(ws, data);
        break;
        
      case 'send_message':
        if (!username) {
          ws.send(JSON.stringify({ type: 'error', message: 'Сначала войдите' }));
          return;
        }
        handleMessage(ws, username, data);
        break;
        
      case 'get_users':
        if (username) broadcastUserList();
        break;
    }
  });

  ws.on('close', () => {
    const username = sessions.get(ws);
    if (username) {
      console.log(`👋 ${username} отключился`);
      users.get(username).ws = null;
      sessions.delete(ws);
      broadcastUserList();
      // Уведомление в общий чат
      broadcast({
        type: 'system',
        text: `❌ ${username} покинул чат`,
        timestamp: Date.now()
      }, 'general');
    }
  });
});

// === РЕГИСТРАЦИЯ ===
function handleRegister(ws, { username, password }) {
  // Валидация на сервере (дублируем клиентскую)
  const USERNAME_REGEX = /^[A-Za-z0-9]+$/;
  if (!USERNAME_REGEX.test(username)) {
    ws.send(JSON.stringify({ 
      type: 'register_error', 
      message: 'Имя: только латиница и цифры, без пробелов' 
    }));
    return;
  }
  if (username.length > 20 || password.length > 50) {
    ws.send(JSON.stringify({ 
      type: 'register_error', 
      message: 'Слишком длинное имя или пароль' 
    }));
    return;
  }
  
  if (users.has(username)) {
    ws.send(JSON.stringify({ type: 'register_error', message: 'Пользователь уже существует' }));
    return;
  }
  
  // ⚠️ В реальном проекте: хешировать пароль (bcrypt)!
  users.set(username, {
    password, // demo: plain text
    ws: null,
    lastSeen: Date.now()
  });
  
  ws.send(JSON.stringify({ type: 'register_success' }));
  console.log(`✅ Зарегистрирован: ${username}`);
}

// === ВХОД ===
function handleLogin(ws, { username, password }) {
  const user = users.get(username);
  if (!user || user.password !== password) {
    ws.send(JSON.stringify({ type: 'login_error', message: 'Неверное имя или пароль' }));
    return;
  }
  
  // Если уже подключён — отключаем старую сессию
  if (user.ws && user.ws.readyState === WebSocket.OPEN) {
    user.ws.send(JSON.stringify({ type: 'kicked', message: 'Вход с другого устройства' }));
    user.ws.close();
  }
  
  user.ws = ws;
  user.lastSeen = Date.now();
  sessions.set(ws, username);
  
  ws.send(JSON.stringify({ type: 'login_success', username }));
  broadcastUserList();
  
  // Уведомление в общий чат
  broadcast({
    type: 'system',
    text: `✅ ${username} присоединился к чату`,
    timestamp: Date.now()
  }, 'general');
  
  console.log(`🔐 Вошёл: ${username}`);
}

// === ОТПРАВКА СООБЩЕНИЯ ===
function handleMessage(ws, sender, { text, privateTo, encrypted, timestamp }) {
  const message = {
    type: 'receive_message',
    sender,
    text,
    encrypted: !!encrypted,
    timestamp: timestamp || Date.now()
  };
  
  if (privateTo) {
    // Личное сообщение
    message.privateTo = privateTo;
    const recipient = users.get(privateTo);
    
    if (recipient && recipient.ws && recipient.ws.readyState === WebSocket.OPEN) {
      recipient.ws.send(JSON.stringify(message));
    }
    // Отправляем отправителю подтверждение
    ws.send(JSON.stringify(message));
    
    // Сохраняем в историю (ключ: отсортированные имена для уникальности)
    const chatId = [sender, privateTo].sort().join(':');
    if (!chatHistory[chatId]) chatHistory[chatId] = [];
    chatHistory[chatId].push(message);
    if (chatHistory[chatId].length > 100) chatHistory[chatId].shift();
    
  } else {
    // Общее сообщение
    broadcast(message, 'general');
    chatHistory.general.push(message);
    if (chatHistory.general.length > 100) chatHistory.general.shift();
  }
}

// === УТИЛИТЫ ===
function broadcast(message, chatId = null) {
  // Если указан chatId — отправляем только в общий или личный (упрощённо: всем онлайн)
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

function broadcastUserList() {
  const userList = Array.from(users.keys()).filter(u => users.get(u).ws?.readyState === WebSocket.OPEN);
  broadcast({ type: 'user_list', users: userList });
}

// === ЗАПУСК ===
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Завершение работы...');
  wss.close();
  server.close();
  process.exit(0);
});
