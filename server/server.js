const WebSocket = require('ws');
const crypto = require('crypto');

// Порт из переменной окружения (для Render/Railway) или 5000 для локалки
const PORT = process.env.PORT || 5000;
const wss = new WebSocket.Server({ port: PORT });

// Хранилище клиентов и аккаунтов (in-memory для бесплатных тарифов)
const clients = new Map();
const accounts = {}; // { username: hashedPassword }

// Хеш пароля
function hashPassword(password) {
    return crypto.createHash('sha256').update(password + 'your-salt-here').digest('base64');
}

// Рассылка списка пользователей
function broadcastUserList() {
    const userList = Array.from(clients.values())
        .filter(c => c.authenticated)
        .map(c => c.username);
    
    const message = JSON.stringify({ type: 'USERLIST', users: userList });
    
    clients.forEach(client => {
        if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(message);
        }
    });
}

// Рассылка сообщения всем
function broadcastMessage(sender, text, hint = null) {
    const message = JSON.stringify({
        type: 'MSG',
        sender,
        text,
        time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        encrypted: !!hint,
        hint
    });

    clients.forEach(client => {
        if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(message);
        }
    });
}

// Личное сообщение
function sendPrivateMessage(targetUsername, sender, text, hint) {
    const message = JSON.stringify({
        type: 'PRIVMSG',
        sender,
        text,
        time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        encrypted: !!hint,
        hint
    });

    // Найти клиента по имени
    for (const [id, client] of clients) {
        if (client.authenticated && client.username === targetUsername) {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(message);
                return true;
            }
        }
    }
    return false;
}

wss.on('connection', (ws) => {
    const clientId = Date.now() + Math.random();
    clients.set(clientId, { ws, authenticated: false, username: null });

    console.log(`📡 Новый клиент: ${clientId}`);

    // Heartbeat для предотвращения отключения на Render
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            const client = clients.get(clientId);

            if (!client) return;

            switch (message.type) {
                case 'REGISTER':
                    if (!message.username || !message.password) {
                        ws.send(JSON.stringify({ type: 'REGISTER_FAIL', message: 'Заполните все поля' }));
                        return;
                    }
                    if (message.username.length < 3) {
                        ws.send(JSON.stringify({ type: 'REGISTER_FAIL', message: 'Имя слишком короткое' }));
                        return;
                    }
                    if (accounts[message.username]) {
                        ws.send(JSON.stringify({ type: 'REGISTER_FAIL', message: 'Пользователь уже существует' }));
                        return;
                    }
                    
                    accounts[message.username] = hashPassword(message.password);
                    client.authenticated = true;
                    client.username = message.username;
                    
                    ws.send(JSON.stringify({ type: 'REGISTER_OK', username: message.username }));
                    broadcastMessage('Сервер', `${message.username} присоединился`);
                    broadcastUserList();
                    console.log(`✅ Зарегистрирован: ${message.username}`);
                    break;

                case 'LOGIN':
                    if (!accounts[message.username] || accounts[message.username] !== hashPassword(message.password)) {
                        ws.send(JSON.stringify({ type: 'LOGIN_FAIL', message: 'Неверный логин или пароль' }));
                        return;
                    }
                    
                    client.authenticated = true;
                    client.username = message.username;
                    
                    ws.send(JSON.stringify({ type: 'LOGIN_OK', username: message.username }));
                    broadcastMessage('Сервер', `${message.username} присоединился`);
                    broadcastUserList();
                    console.log(`🔓 Вошёл: ${message.username}`);
                    break;

                case 'GETUSERS':
                    if (client.authenticated) {
                        broadcastUserList();
                    }
                    break;

                case 'MSG':
                    if (client.authenticated && message.text) {
                        broadcastMessage(client.username, message.text, message.hint);
                    }
                    break;

                case 'PRIVMSG':
                    if (client.authenticated && message.target && message.text) {
                        const sent = sendPrivateMessage(message.target, client.username, message.text, message.hint);
                        if (!sent) {
                            ws.send(JSON.stringify({ type: 'ERROR', message: 'Пользователь не найден' }));
                        }
                    }
                    break;

                default:
                    console.log('Неизвестный тип сообщения:', message.type);
            }
        } catch (error) {
            console.error('Ошибка обработки:', error);
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Ошибка сервера' }));
        }
    });

    ws.on('close', () => {
        const client = clients.get(clientId);
        if (client?.authenticated) {
            console.log(`❌ Отключился: ${client.username}`);
            broadcastMessage('Сервер', `${client.username} покинул чат`);
            broadcastUserList();
        }
        clients.delete(clientId);
    });

    ws.on('error', (error) => {
        console.error('WebSocket ошибка:', error);
        clients.delete(clientId);
    });
});

// Heartbeat интервал для Render (предотвращает отключение)
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 60000);

console.log(`🚀 Сервер запущен на порту ${PORT}`);
console.log(`🌐 WebSocket: ${process.env.RENDER_EXTERNAL_URL ? 'wss://' + process.env.RENDER_EXTERNAL_URL : `ws://localhost:${PORT}`}`);