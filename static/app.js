// State
let currentUser = null;
let currentChat = null;
let socket = null;
let isLoginMode = true;

// API Base URL
const API_URL = 'http://localhost:5000';

// DOM Elements
const authScreen = document.getElementById('auth-screen');
const chatScreen = document.getElementById('chat-screen');
const authTitle = document.getElementById('auth-title');
const authSubmit = document.getElementById('auth-submit');
const authToggle = document.getElementById('auth-toggle');
const authError = document.getElementById('auth-error');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const currentUserSpan = document.getElementById('current-user');
const logoutBtn = document.getElementById('logout-btn');
const newChatBtn = document.getElementById('new-chat-btn');
const chatList = document.getElementById('chat-list');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const fileInput = document.getElementById('file-input');
const chatHeader = document.getElementById('chat-header');
const newChatModal = document.getElementById('new-chat-modal');
const chatTypeSelect = document.getElementById('chat-type');
const chatNameInput = document.getElementById('chat-name');
const userSelect = document.getElementById('user-select');
const cancelChatBtn = document.getElementById('cancel-chat-btn');
const createChatBtn = document.getElementById('create-chat-btn');
const typingIndicator = document.getElementById('typing-indicator');
const pasteArea = document.getElementById('paste-area');
const replyBar = document.getElementById('reply-bar');
const replyToUsername = document.getElementById('reply-to-username');
const replyToText = document.getElementById('reply-to-text');
const cancelReplyBtn = document.getElementById('cancel-reply');

// Reply state
let replyingTo = null;

// Cancel reply
cancelReplyBtn.addEventListener('click', () => {
    replyingTo = null;
    replyBar.classList.remove('show');
});

// Auth Toggle
authToggle.addEventListener('click', () => {
    isLoginMode = !isLoginMode;
    if (isLoginMode) {
        authTitle.textContent = 'Login';
        authSubmit.textContent = 'Login';
        authToggle.textContent = "Don't have an account? Register";
    } else {
        authTitle.textContent = 'Register';
        authSubmit.textContent = 'Register';
        authToggle.textContent = 'Already have an account? Login';
    }
    authError.textContent = '';
});

// Auth Submit
authSubmit.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    
    if (!username || !password) {
        authError.textContent = 'Please fill in all fields';
        return;
    }
    
    const endpoint = isLoginMode ? '/login' : '/register';
    
    try {
        const response = await fetch(API_URL + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            currentUser = { id: data.user_id, username };
            // Store user in localStorage
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            showChatScreen();
            initializeSocket();
            loadChats();
        } else {
            authError.textContent = data.error;
        }
    } catch (error) {
        authError.textContent = 'Connection error. Make sure the server is running.';
    }
});

// Check if user is already logged in on page load
window.addEventListener('DOMContentLoaded', () => {
    const storedUser = localStorage.getItem('currentUser');
    if (storedUser) {
        currentUser = JSON.parse(storedUser);
        showChatScreen();
        initializeSocket();
        loadChats();
    }
});

// Show Chat Screen
function showChatScreen() {
    authScreen.style.display = 'none';
    chatScreen.style.display = 'flex';
    currentUserSpan.textContent = currentUser.username;
    usernameInput.value = '';
    passwordInput.value = '';
}

// Logout
logoutBtn.addEventListener('click', () => {
    currentUser = null;
    currentChat = null;
    localStorage.removeItem('currentUser');
    if (socket) socket.disconnect();
    authScreen.style.display = 'flex';
    chatScreen.style.display = 'none';
    authError.textContent = '';
});

// Initialize Socket
function initializeSocket() {
    socket = io(API_URL);
    
    socket.on('connect', () => {
        console.log('Connected to server');
    });
    
    socket.on('new_message', (message) => {
        if (currentChat && message.chat_id === currentChat.id) {
            displayMessage(message);
            scrollToBottom();
        }
    });
    
    socket.on('user_typing', (data) => {
        if (currentChat && data.chat_id === currentChat.id) {
            typingIndicator.textContent = `${data.username} is typing...`;
            setTimeout(() => {
                typingIndicator.textContent = '';
            }, 3000);
        }
    });
    
    socket.on('reaction_added', (data) => {
        if (currentChat) {
            updateReaction(data.message_id, data.emoji, data.username, data.user_id);
        }
    });
    
    socket.on('reaction_removed', (data) => {
        if (currentChat) {
            removeReaction(data.message_id, data.user_id);
        }
    });
    
    socket.on('chat_updated', (data) => {
        // Reload chats when a new message is sent
        loadChats();
    });
}

// Load Chats
async function loadChats() {
    try {
        const response = await fetch(`${API_URL}/chats/${currentUser.id}`);
        const chats = await response.json();
        
        chatList.innerHTML = '';
        
        if (chats.length === 0) {
            chatList.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No chats yet. Create one!</div>';
            return;
        }
        
        chats.forEach(chat => {
            const chatItem = document.createElement('div');
            chatItem.className = 'chat-item';
            if (currentChat && currentChat.id === chat.id) {
                chatItem.classList.add('active');
            }
            
            const unreadBadge = chat.unread_count > 0 ? 
                `<span class="unread-badge">${chat.unread_count}</span>` : '';
            
            chatItem.innerHTML = `
                <div style="font-weight: bold;">${chat.name || chat.members.join(', ')}</div>
                <div style="font-size: 12px; color: #666;">${chat.type === 'group' ? 'Group' : 'Direct'}</div>
                ${unreadBadge}
            `;
            chatItem.addEventListener('click', () => selectChat(chat));
            chatList.appendChild(chatItem);
        });
    } catch (error) {
        console.error('Error loading chats:', error);
    }
}

// Select Chat
async function selectChat(chat) {
    currentChat = chat;
    
    // Update UI
    document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
    event.target.closest('.chat-item').classList.add('active');
    
    chatHeader.innerHTML = `<h4>${chat.name || chat.members.join(', ')}</h4>`;
    messageInput.disabled = false;
    sendBtn.disabled = false;
    
    // Join room
    socket.emit('join', { username: currentUser.username, room: chat.id.toString() });
    
    // Load messages
    await loadMessages(chat.id);
    
    // Mark as read
    try {
        await fetch(`${API_URL}/mark-read/${chat.id}/${currentUser.id}`, {
            method: 'POST'
        });
        loadChats(); // Reload to update unread count
    } catch (error) {
        console.error('Error marking as read:', error);
    }
}

// Load Messages
async function loadMessages(chatId) {
    try {
        const response = await fetch(`${API_URL}/messages/${chatId}`);
        const messages = await response.json();
        
        messagesContainer.innerHTML = '';
        
        messages.forEach(message => {
            displayMessage(message);
        });
        
        scrollToBottom();
    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

// Display Message
function displayMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    messageDiv.dataset.messageId = message.id;
    
    const isOwnMessage = message.user_id === currentUser.id;
    
    if (isOwnMessage) {
        messageDiv.classList.add('own');
    }
    
    let content = '';
    
    // Add reply preview if this message is a reply
    if (message.reply_to) {
        content += `
            <div class="reply-preview" onclick="scrollToMessage(${message.reply_to.id})">
                <div class="reply-preview-author">${escapeHtml(message.reply_to.username)}</div>
                <div class="reply-preview-text">${escapeHtml(message.reply_to.content)}</div>
            </div>
        `;
    }
    
    if (message.type === 'text') {
        content += `<div class="message-content">${escapeHtml(message.content)}`;
        
        // Add link preview if available
        if (message.link_preview) {
            const preview = message.link_preview;
            content += `
                <div class="link-preview" onclick="window.open('${preview.url}', '_blank')">
                    ${preview.image ? `<img src="${preview.image}" class="link-preview-image" onerror="this.style.display='none'">` : ''}
                    <div class="link-preview-content">
                        <div class="link-preview-title">${escapeHtml(preview.title)}</div>
                        ${preview.description ? `<div class="link-preview-description">${escapeHtml(preview.description)}</div>` : ''}
                        <div class="link-preview-domain">${escapeHtml(preview.domain)}</div>
                    </div>
                </div>
            `;
        }
        
        content += `</div>`;
    } else if (message.type === 'image') {
        content += `
            <div class="message-content">
                ${message.content ? escapeHtml(message.content) : ''}
                <img src="${API_URL}/uploads/${message.file_path}" alt="image">
            </div>
        `;
    } else if (message.type === 'video') {
        content += `
            <div class="message-content">
                ${message.content ? escapeHtml(message.content) : ''}
                <video controls src="${API_URL}/uploads/${message.file_path}"></video>
            </div>
        `;
    }
    
    // Add reactions
    const reactionsHtml = renderReactions(message.reactions || {}, message.id);
    
    // Add message actions (reply button)
    const actionsHtml = `
        <div class="message-actions">
            <span class="message-action-btn" onclick="startReply(${message.id}, '${escapeHtml(message.username)}', '${escapeHtml(message.content || (message.type === 'image' ? '📷 Image' : '🎥 Video'))}')">↩️</span>
        </div>
    `;
    
    messageDiv.innerHTML = `
        <div class="message-header">${message.username} • ${formatTime(message.created_at)}</div>
        ${content}
        ${reactionsHtml}
        ${actionsHtml}
    `;
    
    messagesContainer.appendChild(messageDiv);
}

// Start reply
function startReply(messageId, username, content) {
    replyingTo = {
        id: messageId,
        username: username,
        content: content
    };
    
    replyToUsername.textContent = username;
    replyToText.textContent = content;
    replyBar.classList.add('show');
    messageInput.focus();
}

// Scroll to message
function scrollToMessage(messageId) {
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    if (messageElement) {
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        messageElement.style.backgroundColor = 'rgba(0, 132, 255, 0.1)';
        setTimeout(() => {
            messageElement.style.backgroundColor = '';
        }, 2000);
    }
}

// Render reactions
function renderReactions(reactions, messageId) {
    let html = '<div class="reactions-container">';
    
    for (const [emoji, users] of Object.entries(reactions)) {
        const hasUserReacted = users.some(u => u.user_id === currentUser.id);
        const count = users.length;
        const usernames = users.map(u => u.username).join(', ');
        
        html += `
            <span class="reaction ${hasUserReacted ? 'own-reaction' : ''}" 
                  title="${usernames}"
                  onclick="handleReactionClick(${messageId}, '${emoji}', ${hasUserReacted})">
                ${emoji} <span class="reaction-count">${count}</span>
            </span>
        `;
    }
    
    // Only show add button for messages from other users
    html += `<span class="add-reaction-btn" onclick="showReactionPicker(event, ${messageId})">+</span>`;
    html += '</div>';
    
    return html;
}

// Show reaction picker
let currentPickerMessageId = null;
function showReactionPicker(event, messageId) {
    event.stopPropagation();
    
    // Remove existing picker
    const existingPicker = document.querySelector('.reaction-picker');
    if (existingPicker) {
        existingPicker.remove();
    }
    
    currentPickerMessageId = messageId;
    
    const picker = document.createElement('div');
    picker.className = 'reaction-picker show';
    
    const emojis = ['👍', '❤️', '😂', '😮', '😢'];
    emojis.forEach(emoji => {
        const span = document.createElement('span');
        span.className = 'reaction-emoji';
        span.textContent = emoji;
        span.onclick = (e) => {
            e.stopPropagation();
            addReaction(messageId, emoji);
            picker.remove();
        };
        picker.appendChild(span);
    });
    
    const rect = event.target.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.top = (rect.top - 50) + 'px';
    picker.style.left = rect.left + 'px';
    
    document.body.appendChild(picker);
    
    // Close picker when clicking outside
    setTimeout(() => {
        document.addEventListener('click', closePicker);
    }, 0);
}

function closePicker() {
    const picker = document.querySelector('.reaction-picker');
    if (picker) {
        picker.remove();
    }
    document.removeEventListener('click', closePicker);
}

// Handle reaction click (to remove own reaction)
function handleReactionClick(messageId, emoji, hasUserReacted) {
    if (hasUserReacted) {
        removeReactionFromMessage(messageId);
    } else {
        addReaction(messageId, emoji);
    }
}

// Add reaction
function addReaction(messageId, emoji) {
    if (!currentChat) return;
    
    socket.emit('add_reaction', {
        message_id: messageId,
        user_id: currentUser.id,
        emoji: emoji,
        chat_id: currentChat.id
    });
}

// Remove reaction
function removeReactionFromMessage(messageId) {
    if (!currentChat) return;
    
    socket.emit('remove_reaction', {
        message_id: messageId,
        user_id: currentUser.id,
        chat_id: currentChat.id
    });
}

// Update reaction in UI
function updateReaction(messageId, emoji, username, userId) {
    const messageDiv = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageDiv) return;
    
    // Reload messages to update reactions properly
    if (currentChat) {
        loadMessages(currentChat.id);
    }
}

// Remove reaction from UI
function removeReaction(messageId, userId) {
    if (currentChat) {
        loadMessages(currentChat.id);
    }
}

// Send Message
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
    const content = messageInput.value.trim();
    
    if (!content && !fileInput.files[0]) return;
    if (!currentChat) return;
    
    let messageData = {
        chat_id: currentChat.id,
        user_id: currentUser.id,
        content: content,
        type: 'text',
        file_path: null,
        reply_to_id: replyingTo ? replyingTo.id : null
    };
    
    // Handle file upload
    if (fileInput.files[0]) {
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        
        try {
            const response = await fetch(`${API_URL}/upload`, {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (response.ok) {
                messageData.file_path = data.file_path;
                
                if (fileInput.files[0].type.startsWith('image/')) {
                    messageData.type = 'image';
                } else if (fileInput.files[0].type.startsWith('video/')) {
                    messageData.type = 'video';
                }
            }
        } catch (error) {
            console.error('Error uploading file:', error);
            return;
        }
    }
    
    socket.emit('send_message', messageData);
    
    messageInput.value = '';
    fileInput.value = '';
    
    // Clear reply
    if (replyingTo) {
        replyingTo = null;
        replyBar.classList.remove('show');
    }
}

// Typing indicator
let typingTimeout;
messageInput.addEventListener('input', () => {
    if (currentChat) {
        clearTimeout(typingTimeout);
        socket.emit('typing', { username: currentUser.username, chat_id: currentChat.id });
        typingTimeout = setTimeout(() => {
            // Stop typing indicator after 3 seconds
        }, 3000);
    }
});

// Paste image handler
document.addEventListener('paste', async (e) => {
    if (!currentChat || document.activeElement !== messageInput) return;
    
    const items = e.clipboardData.items;
    
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            e.preventDefault();
            
            const blob = items[i].getAsFile();
            const reader = new FileReader();
            
            reader.onload = async (event) => {
                try {
                    const response = await fetch(`${API_URL}/upload-base64`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ data: event.target.result })
                    });
                    
                    const data = await response.json();
                    
                    if (response.ok) {
                        // Send image message
                        socket.emit('send_message', {
                            chat_id: currentChat.id,
                            user_id: currentUser.id,
                            content: messageInput.value.trim(),
                            type: 'image',
                            file_path: data.file_path
                        });
                        
                        messageInput.value = '';
                    }
                } catch (error) {
                    console.error('Error uploading pasted image:', error);
                }
            };
            
            reader.readAsDataURL(blob);
            break;
        }
    }
});

// New Chat Modal
newChatBtn.addEventListener('click', async () => {
    newChatModal.style.display = 'flex';
    await loadUsers();
});

cancelChatBtn.addEventListener('click', () => {
    newChatModal.style.display = 'none';
});

// Load Users
async function loadUsers() {
    try {
        const response = await fetch(`${API_URL}/users`);
        const users = await response.json();
        
        userSelect.innerHTML = '';
        
        users.forEach(user => {
            if (user.id !== currentUser.id) {
                const label = document.createElement('label');
                label.innerHTML = `
                    <input type="checkbox" value="${user.id}"> ${user.username}
                `;
                userSelect.appendChild(label);
            }
        });
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

// Create Chat
createChatBtn.addEventListener('click', async () => {
    const chatType = chatTypeSelect.value;
    const chatName = chatNameInput.value.trim();
    const selectedUsers = Array.from(userSelect.querySelectorAll('input:checked')).map(cb => parseInt(cb.value));
    
    if (selectedUsers.length === 0) {
        alert('Please select at least one user');
        return;
    }
    
    if (chatType === 'group' && !chatName) {
        alert('Please enter a group name');
        return;
    }
    
    const members = [...selectedUsers, currentUser.id];
    
    try {
        const response = await fetch(`${API_URL}/chats`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: chatType,
                name: chatName || null,
                members: members
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            newChatModal.style.display = 'none';
            chatNameInput.value = '';
            
            // If chat already existed, show message
            if (data.message === 'Chat already exists') {
                alert('A chat with this user already exists!');
            }
            
            loadChats();
        }
    } catch (error) {
        console.error('Error creating chat:', error);
    }
});

// Utility Functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}