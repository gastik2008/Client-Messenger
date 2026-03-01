// server/server.js
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

// 🔥 Railway назначает порт автоматически
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // 🔥 Критично: не localhost!

// Создаём HTTP-сервер
const server = http.createServer((req, res) => {
    // Health check endpoint для Railway
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy', service: 'client-messenger' }));
        return;
    }
    
    // Default response
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
        status: 'ok', 
        service: 'client-messenger',
        websocket: 'wss://' + (process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost:' + PORT)
    }));
});

// Привязываем WebSocket к HTTP-серверу
const wss = new WebSocket.Server({ server });

// Хранилища
const clients = new Map();
const accounts = {};

// Хеш пароля
function hashPassword(password) {
    return crypto.createHash('sha256').update(password + 'railway-salt-2024').digest('base64');
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

// Обработка WebSocket подключений
wss.on('connection', (ws, req) => {
    const clientId = Date.now() + Math.random();
    
    // Получаем IP клиента (для логов)
    const ip = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    console.log(`📡 Новый клиент #${clientId} с ${ip}`);
    
    clients.set(clientId, { ws, authenticated: false, username: null, ip });

    // Heartbeat для Railway
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
                    if (client.authenticated) broadcastUserList();
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
            }
        } catch (error) {
            console.error('❌ Ошибка обработки:', error);
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
        console.error(`❌ WebSocket ошибка #${clientId}:`, error.message);
        clients.delete(clientId);
    });
});

// Heartbeat для предотвращения отключения
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 45000); // Railway timeout ~60 сек, пингуем чаще

// 🔥 Запуск сервера с HOST и PORT
server.listen(PORT, HOST, () => {
    console.log(`🚀 Сервер запущен на ${HOST}:${PORT}`);
    console.log(`🌐 Public URL: https://${process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost:' + PORT}`);
    console.log(`🔌 WebSocket: wss://${process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost:' + PORT}`);
    console.log(`💡 Health: https://${process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost:' + PORT}/health`);
});

// Обработка ошибок
server.on('error', (err) => {
    console.error('❌ Ошибка HTTP-сервера:', err);
});

// Graceful shutdown для Railway
process.on('SIGTERM', () => {
    console.log('🔄 SIGTERM received, shutting down...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});
