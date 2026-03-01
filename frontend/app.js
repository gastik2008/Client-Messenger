// 🔹 Глобальные переменные
let socket = null;
let currentUser = null;
let selectedUser = null;
let users = [];
let messages = [];

// 🔹 URL WebSocket сервера (НАСТРОЙТЕ ПЕРЕД ДЕПЛОЕМ!)
// Для локальной разработки: 'ws://localhost:5000'
// Для продакшена: 'wss://ваш-сервер.onrender.com'
const WS_URL = 'wss://client-messenger-server.onrender.com'; // ← ЗАМЕНИТЕ НА СВОЙ URL

// 🔹 Инициализация
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initLogin();
    initChat();
});

// 🔹 Вкладки входа/регистрации
function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const loginTab = document.getElementById('loginTab');
    const registerTab = document.getElementById('registerTab');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            if (btn.dataset.tab === 'login') {
                loginTab.classList.add('active');
                registerTab.classList.remove('active');
            } else {
                loginTab.classList.remove('active');
                registerTab.classList.add('active');
            }
        });
    });
}

// 🔹 Логин и регистрация
function initLogin() {
    document.getElementById('loginBtn').addEventListener('click', handleLogin);
    document.getElementById('registerBtn').addEventListener('click', handleRegister);
}

function showStatus(message, isError = true) {
    const statusEl = document.getElementById('loginStatus');
    statusEl.textContent = message;
    statusEl.style.color = isError ? 'var(--error)' : 'var(--success)';
}

async function handleLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!username || !password) {
        showStatus('Введите имя пользователя и пароль');
        return;
    }

    try {
        socket = new WebSocket(WS_URL);
        
        socket.onopen = () => {
            socket.send(JSON.stringify({ type: 'LOGIN', username, password }));
        };

        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleServerMessage(data);
        };

        socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            showStatus('Ошибка подключения к серверу');
        };

        socket.onclose = () => {
            updateStatus('disconnected');
        };
    } catch (error) {
        showStatus('Ошибка: ' + error.message);
    }
}

async function handleRegister() {
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regConfirmPassword').value;

    if (password.length < 4) {
        showStatus('Пароль должен содержать минимум 4 символа');
        return;
    }

    if (password !== confirm) {
        showStatus('Пароли не совпадают');
        return;
    }

    try {
        socket = new WebSocket(WS_URL);
        
        socket.onopen = () => {
            socket.send(JSON.stringify({ type: 'REGISTER', username, password }));
        };

        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleServerMessage(data);
        };

        socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            showStatus('Ошибка подключения к серверу');
        };
    } catch (error) {
        showStatus('Ошибка: ' + error.message);
    }
}

// 🔹 Обработка сообщений сервера
function handleServerMessage(data) {
    switch (data.type) {
        case 'LOGIN_OK':
        case 'REGISTER_OK':
            currentUser = data.username;
            document.getElementById('loginWindow').classList.add('hidden');
            document.getElementById('chatWindow').classList.remove('hidden');
            document.getElementById('currentUserLabel').textContent = currentUser;
            updateStatus('connected');
            // Запрос списка пользователей после входа
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'GETUSERS' }));
            }
            break;

        case 'LOGIN_FAIL':
        case 'REGISTER_FAIL':
            showStatus(data.message);
            if (socket) socket.close();
            break;

        case 'USERLIST':
            // Сохраняем только имена, пины храним локально
            users = data.users.map(name => ({ name, isPinned: false }));
            renderUsers();
            break;

        case 'MSG':
        case 'PRIVMSG':
            addMessage(data);
            break;

        case 'ERROR':
            showStatus(data.message);
            break;
    }
}

// 🔹 Чат
function initChat() {
    document.getElementById('sendBtn').addEventListener('click', sendMessage);
    document.getElementById('messageBox').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    document.getElementById('encryptCheckBox').addEventListener('change', (e) => {
        const keyBox = document.getElementById('encryptKeyBox');
        keyBox.classList.toggle('hidden', !e.target.checked);
    });

    document.getElementById('decryptBtn').addEventListener('click', decryptMessage);
    document.getElementById('searchBox').addEventListener('input', searchUsers);
}

function updateStatus(status) {
    const indicator = document.getElementById('statusIndicator');
    indicator.className = 'status-indicator ' + status;
}

function renderUsers() {
    const list = document.getElementById('usersList');
    list.innerHTML = '';

    users.forEach(userObj => {
        if (userObj.name === currentUser) return;

        const item = document.createElement('div');
        item.className = 'user-item' + (selectedUser === userObj.name ? ' selected' : '');
        item.innerHTML = `
            <span class="status">🟢</span>
            <span class="name">${userObj.name}</span>
            <button class="pin-btn ${userObj.isPinned ? 'pinned' : ''}" data-user="${userObj.name}">📌</button>
        `;

        item.querySelector('.name').addEventListener('click', () => selectUser(userObj.name));
        item.querySelector('.pin-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            togglePin(userObj.name);
        });

        list.appendChild(item);
    });
}

function selectUser(username) {
    selectedUser = username;
    document.getElementById('chatTitle').textContent = `💬 Личный чат с ${username}`;
    renderUsers();
}

function togglePin(username) {
    const userObj = users.find(u => u.name === username);
    if (userObj) {
        userObj.isPinned = !userObj.isPinned;
        // Сортировка: закреплённые сверху
        users.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
        renderUsers();
    }
}

function searchUsers() {
    const query = document.getElementById('searchBox').value.toLowerCase();
    const items = document.querySelectorAll('.user-item');

    items.forEach(item => {
        const name = item.querySelector('.name').textContent.toLowerCase();
        item.style.display = name.includes(query) ? 'flex' : 'none';
    });
}

function sendMessage() {
    const messageBox = document.getElementById('messageBox');
    const text = messageBox.value.trim();

    if (!text || text === 'Введите сообщение...') return;

    const encrypt = document.getElementById('encryptCheckBox').checked;
    const key = document.getElementById('encryptKeyBox').value;
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    if (encrypt && !key) {
        alert('Введите ключ шифрования');
        return;
    }

    let messageText = text;
    let hint = '';

    if (encrypt) {
        messageText = xorEncrypt(text, key);
        hint = generateHint(key);
    }

    const message = {
        type: selectedUser ? 'PRIVMSG' : 'MSG',
        target: selectedUser || 'ALL',
        sender: currentUser,
        text: messageText,
        time: time,
        encrypted: encrypt,
        hint: hint
    };

    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
    }
    
    addMessage(message, true);
    messageBox.value = '';
    
    if (encrypt) {
        document.getElementById('encryptCheckBox').checked = false;
        document.getElementById('encryptKeyBox').classList.add('hidden');
    }
}

function addMessage(data, isOwn = false) {
    const list = document.getElementById('messagesList');
    const message = document.createElement('div');
    message.className = `message ${data.sender === currentUser || isOwn ? 'own' : 'other'}`;

    const displayText = data.encrypted 
        ? `🔒 Зашифрованное сообщение (подсказка: ${data.hint})` 
        : data.text;

    message.innerHTML = `
        ${data.sender !== currentUser && !isOwn ? `<div class="sender">${data.sender}</div>` : ''}
        <div class="text">${displayText}</div>
        <div class="meta">
            <span class="time">${data.time}</span>
            ${data.sender === currentUser || isOwn ? '<span class="checks">✓✓</span>' : ''}
        </div>
    `;

    message.dataset.encrypted = data.encrypted;
    message.dataset.text = data.text;

    if (data.encrypted) {
        message.addEventListener('click', () => {
            const decryptPanel = document.getElementById('decryptPanel');
            decryptPanel.classList.remove('hidden');
            decryptPanel.dataset.messageIndex = list.children.length - 1;
        });
    }

    list.appendChild(message);
    list.scrollTop = list.scrollHeight;
}

function decryptMessage() {
    const decryptPanel = document.getElementById('decryptPanel');
    const key = document.getElementById('decryptKeyBox').value;

    if (!key) {
        alert('Введите ключ расшифровки');
        return;
    }

    const messageIndex = decryptPanel.dataset.messageIndex;
    const messagesList = document.getElementById('messagesList');
    const messageEl = messagesList.children[messageIndex];

    if (messageEl && messageEl.dataset.encrypted === 'true') {
        const encryptedText = messageEl.dataset.text;
        try {
            const decrypted = xorDecrypt(encryptedText, key);
            messageEl.querySelector('.text').textContent = decrypted;
            decryptPanel.classList.add('hidden');
            document.getElementById('decryptKeyBox').value = '';
        } catch {
            alert('Неверный ключ расшифровки');
        }
    }
}

// 🔹 Шифрование XOR
function xorEncrypt(text, passphrase) {
    if (!text || !passphrase) return text;
    let result = '';
    for (let i = 0; i < text.length; i++) {
        result += String.fromCharCode(text.charCodeAt(i) ^ passphrase.charCodeAt(i % passphrase.length));
    }
    return btoa(encodeURIComponent(result));
}

function xorDecrypt(encryptedBase64, passphrase) {
    if (!encryptedBase64 || !passphrase) return encryptedBase64;
    const xored = decodeURIComponent(atob(encryptedBase64));
    let result = '';
    for (let i = 0; i < xored.length; i++) {
        result += String.fromCharCode(xored.charCodeAt(i) ^ passphrase.charCodeAt(i % passphrase.length));
    }
    return result;
}

function generateHint(passphrase) {
    if (!passphrase || passphrase.length < 2) return '??';
    return passphrase.substring(0, 2) + '*'.repeat(Math.max(0, passphrase.length - 2));
}