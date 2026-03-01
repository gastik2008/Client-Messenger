// 🔹 Глобальные переменные
let socket = null;
let currentUser = null;
let selectedUser = null;
let users = [];

// 🔹 ⚠️ URL WebSocket сервера — НАСТРОЙТЕ ПЕРЕД ЗАПУСКОМ!
// Railway: wss://xxx.up.railway.app
// Render:  wss://xxx.onrender.com
// Локально: ws://localhost:5000
const WS_URL = 'wss://client-messenger-production.up.railway.app';

// 🔹 Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initLogin();
    initChat();
});

// ============================================================================
// 🔹 Вкладки входа / регистрации
// ============================================================================
function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const loginTab = document.getElementById('loginTab');
    const registerTab = document.getElementById('registerTab');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Переключаем активную кнопку
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Переключаем контент вкладок
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

// ============================================================================
// 🔹 Логин и регистрация
// ============================================================================
function initLogin() {
    document.getElementById('loginBtn').addEventListener('click', handleLogin);
    document.getElementById('registerBtn').addEventListener('click', handleRegister);
}

function showStatus(message, isError = true) {
    const statusEl = document.getElementById('loginStatus');
    statusEl.textContent = message;
    statusEl.style.color = isError ? 'var(--error)' : 'var(--success)';
    // Очищаем сообщение через 5 секунд
    setTimeout(() => { statusEl.textContent = ''; }, 5000);
}

function handleLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!username || !password) {
        showStatus('Введите имя пользователя и пароль');
        return;
    }

    connectToServer({ type: 'LOGIN', username, password });
}

function handleRegister() {
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

    connectToServer({ type: 'REGISTER', username, password });
}

function connectToServer(authMessage) {
    try {
        // Закрываем старое соединение, если есть
        if (socket) socket.close();

        socket = new WebSocket(WS_URL);

        socket.onopen = () => {
            console.log('✅ WebSocket connected');
            socket.send(JSON.stringify(authMessage));
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleServerMessage(data);
            } catch (e) {
                console.error('❌ Ошибка парсинга сообщения:', e);
            }
        };

        socket.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            showStatus('Ошибка подключения к серверу');
        };

        socket.onclose = (event) => {
            console.log('🔌 WebSocket closed:', event.code, event.reason);
            if (currentUser) {
                updateStatus('disconnected');
            }
        };

    } catch (error) {
        console.error('❌ Ошибка создания WebSocket:', error);
        showStatus('Ошибка: ' + error.message);
    }
}

// ============================================================================
// 🔹 Обработка сообщений от сервера
// ============================================================================
function handleServerMessage(data) {
    switch (data.type) {
        case 'LOGIN_OK':
        case 'REGISTER_OK':
            currentUser = data.username;
            document.getElementById('loginWindow').classList.add('hidden');
            document.getElementById('chatWindow').classList.remove('hidden');
            document.getElementById('currentUserLabel').textContent = currentUser;
            updateStatus('connected');
            // Запрашиваем список пользователей после входа
            sendToServer({ type: 'GETUSERS' });
            break;

        case 'LOGIN_FAIL':
        case 'REGISTER_FAIL':
            showStatus(data.message);
            if (socket) socket.close();
            break;

        case 'USERLIST':
            // Сохраняем пользователей с локальным статусом закрепления
            users = data.users.map(name => ({ 
                name, 
                isPinned: users.find(u => u.name === name)?.isPinned || false 
            }));
            // Сортировка: закреплённые сверху
            users.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
            renderUsers();
            break;

        case 'MSG':
        case 'PRIVMSG':
            addMessage(data);
            break;

        case 'ERROR':
            showStatus(data.message);
            break;

        default:
            console.log('📨 Неизвестный тип сообщения:', data.type);
    }
}

function sendToServer(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
        return true;
    }
    console.warn('⚠️ WebSocket не готов к отправке');
    return false;
}

// ============================================================================
// 🔹 Чат: инициализация и управление
// ============================================================================
function initChat() {
    // Отправка сообщения по кнопке
    document.getElementById('sendBtn').addEventListener('click', sendMessage);
    
    // Отправка по Enter (без Shift)
    document.getElementById('messageBox').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Показать/скрыть поле ключа шифрования
    document.getElementById('encryptCheckBox').addEventListener('change', (e) => {
        const keyBox = document.getElementById('encryptKeyBox');
        keyBox.classList.toggle('hidden', !e.target.checked);
        if (!e.target.checked) keyBox.value = '';
    });

    // Расшифровка сообщения
    document.getElementById('decryptBtn').addEventListener('click', decryptMessage);
    
    // Поиск пользователей
    document.getElementById('searchBox').addEventListener('input', searchUsers);
}

function updateStatus(status) {
    const indicator = document.getElementById('statusIndicator');
    indicator.className = 'status-indicator ' + status;
}

// ============================================================================
// 🔹 Список пользователей
// ============================================================================
function renderUsers() {
    const list = document.getElementById('usersList');
    list.innerHTML = '';

    users.forEach(userObj => {
        // Не показываем текущего пользователя в списке
        if (userObj.name === currentUser) return;

        const item = document.createElement('div');
        item.className = 'user-item' + (selectedUser === userObj.name ? ' selected' : '');
        item.dataset.username = userObj.name;
        
        item.innerHTML = `
            <span class="status">🟢</span>
            <span class="name">${escapeHtml(userObj.name)}</span>
            <button class="pin-btn ${userObj.isPinned ? 'pinned' : ''}" title="Закрепить">📌</button>
        `;

        // Клик по имени — выбор пользователя для личного чата
        item.querySelector('.name').addEventListener('click', () => selectUser(userObj.name));
        
        // Клик по кнопке закрепления
        item.querySelector('.pin-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            togglePin(userObj.name);
        });

        list.appendChild(item);
    });
}

function selectUser(username) {
    selectedUser = username;
    document.getElementById('chatTitle').textContent = `💬 ${username}`;
    
    // Обновляем визуальное выделение
    document.querySelectorAll('.user-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.username === username);
    });
    
    // Очищаем список сообщений при переключении чата
    document.getElementById('messagesList').innerHTML = '';
}

function togglePin(username) {
    const userObj = users.find(u => u.name === username);
    if (userObj) {
        userObj.isPinned = !userObj.isPinned;
        // Пересортировываем: закреплённые сверху
        users.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));
        renderUsers();
    }
}

function searchUsers() {
    const query = document.getElementById('searchBox').value.toLowerCase().trim();
    const items = document.querySelectorAll('.user-item');

    items.forEach(item => {
        const name = item.querySelector('.name').textContent.toLowerCase();
        item.style.display = name.includes(query) ? 'flex' : 'none';
    });
}

// ============================================================================
// 🔹 Отправка сообщений
// ============================================================================
function sendMessage() {
    const messageBox = document.getElementById('messageBox');
    const text = messageBox.value.trim();

    if (!text) return;

    const encrypt = document.getElementById('encryptCheckBox').checked;
    const key = document.getElementById('encryptKeyBox').value.trim();
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    // Валидация ключа шифрования
    if (encrypt && !key) {
        alert('⚠️ Введите ключ шифрования');
        return;
    }

    let messageText = text;
    let hint = '';

    // Шифрование если нужно
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

    // Отправляем на сервер
    if (sendToServer(message)) {
        // Добавляем в интерфейс сразу (оптимистичное обновление)
        addMessage(message, true);
        
        // Очищаем поля ввода
        messageBox.value = '';
        if (encrypt) {
            document.getElementById('encryptCheckBox').checked = false;
            document.getElementById('encryptKeyBox').classList.add('hidden');
        }
    } else {
        showStatus('❌ Не удалось отправить сообщение');
    }
}

// ============================================================================
// 🔹 Отображение сообщений
// ============================================================================
function addMessage(data, isOwn = false) {
    const list = document.getElementById('messagesList');
    const message = document.createElement('div');
    
    const isCurrentUser = data.sender === currentUser || isOwn;
    message.className = `message ${isCurrentUser ? 'own' : 'other'}`;

    // Формируем отображаемый текст
    const displayText = data.encrypted 
        ? `🔒 Зашифровано (подсказка: ${escapeHtml(data.hint || '???')})` 
        : escapeHtml(data.text);

    message.innerHTML = `
        ${!isCurrentUser ? `<div class="sender">${escapeHtml(data.sender)}</div>` : ''}
        <div class="text">${displayText}</div>
        <div class="meta">
            <span class="time">${data.time}</span>
            ${isCurrentUser ? '<span class="checks" title="Доставлено">✓✓</span>' : ''}
        </div>
    `;

    // Сохраняем данные для расшифровки
    if (data.encrypted) {
        message.dataset.encrypted = 'true';
        message.dataset.text = data.text;
        message.dataset.hint = data.hint;
        
        // Клик по зашифрованному сообщению — показать панель расшифровки
        message.style.cursor = 'pointer';
        message.title = '🔓 Нажмите для расшифровки';
        message.addEventListener('click', () => {
            const decryptPanel = document.getElementById('decryptPanel');
            decryptPanel.classList.remove('hidden');
            decryptPanel.dataset.messageIndex = Array.from(list.children).indexOf(message);
            document.getElementById('decryptKeyBox').focus();
        });
    }

    list.appendChild(message);
    
    // Автопрокрутка вниз
    list.scrollTop = list.scrollHeight;
}

// ============================================================================
// 🔹 Расшифровка сообщений
// ============================================================================
function decryptMessage() {
    const decryptPanel = document.getElementById('decryptPanel');
    const key = document.getElementById('decryptKeyBox').value.trim();
    const messagesList = document.getElementById('messagesList');
    const messageIndex = decryptPanel.dataset.messageIndex;
    
    if (!key) {
        alert('⚠️ Введите ключ расшифровки');
        return;
    }

    const messageEl = messagesList.children[messageIndex];
    
    if (messageEl && messageEl.dataset.encrypted === 'true') {
        try {
            const encryptedText = messageEl.dataset.text;
            const decrypted = xorDecrypt(encryptedText, key);
            
            // Обновляем текст сообщения
            messageEl.querySelector('.text').textContent = decrypted;
            messageEl.dataset.encrypted = 'false';
            messageEl.style.cursor = 'default';
            messageEl.title = '';
            
            // Скрываем панель и очищаем поле
            decryptPanel.classList.add('hidden');
            document.getElementById('decryptKeyBox').value = '';
            
        } catch (e) {
            console.error('❌ Ошибка расшифровки:', e);
            alert('❌ Неверный ключ или повреждённые данные');
        }
    }
}

// ============================================================================
// 🔹 Шифрование XOR (простое, для демонстрации)
// ============================================================================
function xorEncrypt(text, passphrase) {
    if (!text || !passphrase) return text;
    
    let result = '';
    for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i) ^ passphrase.charCodeAt(i % passphrase.length);
        result += String.fromCharCode(charCode);
    }
    // Кодируем в base64 для безопасной передачи
    return btoa(encodeURIComponent(result));
}

function xorDecrypt(encryptedBase64, passphrase) {
    if (!encryptedBase64 || !passphrase) return encryptedBase64;
    
    // Декодируем из base64
    const xored = decodeURIComponent(atob(encryptedBase64));
    
    let result = '';
    for (let i = 0; i < xored.length; i++) {
        const charCode = xored.charCodeAt(i) ^ passphrase.charCodeAt(i % passphrase.length);
        result += String.fromCharCode(charCode);
    }
    return result;
}

function generateHint(passphrase) {
    if (!passphrase || passphrase.length < 2) return '??';
    return passphrase.substring(0, 2) + '*'.repeat(Math.max(0, passphrase.length - 2));
}

// ============================================================================
// 🔹 Утилиты
// ============================================================================
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Закрытие панели расшифровки по клику вне её
document.addEventListener('click', (e) => {
    const decryptPanel = document.getElementById('decryptPanel');
    if (decryptPanel && !decryptPanel.contains(e.target) && !e.target.closest('.message')) {
        decryptPanel.classList.add('hidden');
    }
});

// Обработка изменения размера окна (адаптивность)
window.addEventListener('resize', () => {
    const messagesList = document.getElementById('messagesList');
    if (messagesList) {
        messagesList.scrollTop = messagesList.scrollHeight;
    }
});

