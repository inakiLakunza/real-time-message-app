from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
import os
import json
import sqlite3
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import uuid
import requests
from bs4 import BeautifulSoup
import re
from urllib.parse import urlparse

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# Create uploads directory
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Database setup
def init_db():
    conn = sqlite3.connect('messaging.db')
    c = conn.cursor()
    
    # Users table
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  username TEXT UNIQUE NOT NULL,
                  password TEXT NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    # Chats table
    c.execute('''CREATE TABLE IF NOT EXISTS chats
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT,
                  type TEXT NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    # Chat members table
    c.execute('''CREATE TABLE IF NOT EXISTS chat_members
                 (chat_id INTEGER,
                  user_id INTEGER,
                  FOREIGN KEY (chat_id) REFERENCES chats(id),
                  FOREIGN KEY (user_id) REFERENCES users(id),
                  PRIMARY KEY (chat_id, user_id))''')
    
    # Messages table
    c.execute('''CREATE TABLE IF NOT EXISTS messages
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  chat_id INTEGER,
                  user_id INTEGER,
                  content TEXT,
                  message_type TEXT DEFAULT 'text',
                  file_path TEXT,
                  link_preview TEXT,
                  reply_to_id INTEGER,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (chat_id) REFERENCES chats(id),
                  FOREIGN KEY (user_id) REFERENCES users(id),
                  FOREIGN KEY (reply_to_id) REFERENCES messages(id))''')
    
    # Reactions table
    c.execute('''CREATE TABLE IF NOT EXISTS reactions
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  message_id INTEGER,
                  user_id INTEGER,
                  emoji TEXT NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (message_id) REFERENCES messages(id),
                  FOREIGN KEY (user_id) REFERENCES users(id),
                  UNIQUE(message_id, user_id))''')
    
    # Read receipts table
    c.execute('''CREATE TABLE IF NOT EXISTS read_receipts
                 (chat_id INTEGER,
                  user_id INTEGER,
                  last_read_message_id INTEGER,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (chat_id) REFERENCES chats(id),
                  FOREIGN KEY (user_id) REFERENCES users(id),
                  PRIMARY KEY (chat_id, user_id))''')
    
    conn.commit()
    conn.close()

init_db()

# Active users tracking
active_users = {}

# Helper function to extract URLs from text
def extract_urls(text):
    url_pattern = re.compile(r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+')
    return url_pattern.findall(text)

# Helper function to get link preview
def get_link_preview(url):
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        response = requests.get(url, headers=headers, timeout=5)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Try to get Open Graph data
        og_title = soup.find('meta', property='og:title')
        og_description = soup.find('meta', property='og:description')
        og_image = soup.find('meta', property='og:image')
        
        # Get title
        title = url
        if og_title and og_title.get('content'):
            title = og_title['content']
        else:
            title_tag = soup.find('title')
            if title_tag:
                title = title_tag.string if title_tag.string else title_tag.get_text()
        
        # Get description
        description = ''
        if og_description and og_description.get('content'):
            description = og_description['content']
        else:
            meta_desc = soup.find('meta', attrs={'name': 'description'})
            if meta_desc and meta_desc.get('content'):
                description = meta_desc['content']
        
        # Get image
        image = ''
        if og_image and og_image.get('content'):
            image = og_image['content']
        
        # Get domain
        domain = urlparse(url).netloc
        
        return {
            'url': url,
            'title': str(title)[:200] if title else url,
            'description': str(description)[:300] if description else '',
            'image': image,
            'domain': domain
        }
    except Exception as e:
        print(f"Error getting preview for {url}: {e}")
        return None

# Routes
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({'error': 'Username and password required'}), 400
    
    conn = sqlite3.connect('messaging.db')
    c = conn.cursor()
    
    try:
        hashed_pw = generate_password_hash(password)
        c.execute('INSERT INTO users (username, password) VALUES (?, ?)', (username, hashed_pw))
        conn.commit()
        user_id = c.lastrowid
        conn.close()
        return jsonify({'message': 'User registered', 'user_id': user_id}), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Username already exists'}), 400

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    conn = sqlite3.connect('messaging.db')
    c = conn.cursor()
    c.execute('SELECT id, password FROM users WHERE username = ?', (username,))
    user = c.fetchone()
    conn.close()
    
    if user and check_password_hash(user[1], password):
        return jsonify({'message': 'Login successful', 'user_id': user[0], 'username': username}), 200
    
    return jsonify({'error': 'Invalid credentials'}), 401

@app.route('/users', methods=['GET'])
def get_users():
    conn = sqlite3.connect('messaging.db')
    c = conn.cursor()
    c.execute('SELECT id, username FROM users')
    users = [{'id': row[0], 'username': row[1]} for row in c.fetchall()]
    conn.close()
    return jsonify(users)

@app.route('/chats', methods=['POST'])
def create_chat():
    data = request.json
    chat_type = data.get('type')  # 'direct' or 'group'
    members = data.get('members', [])
    name = data.get('name')
    
    conn = sqlite3.connect('messaging.db')
    c = conn.cursor()
    
    # For direct chats, check if chat already exists between these two users
    if chat_type == 'direct' and len(members) == 2:
        c.execute('''
            SELECT c.id FROM chats c
            JOIN chat_members cm1 ON c.id = cm1.chat_id
            JOIN chat_members cm2 ON c.id = cm2.chat_id
            WHERE c.type = 'direct'
            AND cm1.user_id = ? AND cm2.user_id = ?
            AND (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) = 2
        ''', (members[0], members[1]))
        
        existing_chat = c.fetchone()
        if existing_chat:
            conn.close()
            return jsonify({'message': 'Chat already exists', 'chat_id': existing_chat[0]}), 200
    
    c.execute('INSERT INTO chats (name, type) VALUES (?, ?)', (name, chat_type))
    chat_id = c.lastrowid
    
    for user_id in members:
        c.execute('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)', (chat_id, user_id))
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Chat created', 'chat_id': chat_id}), 201

@app.route('/chats/<int:user_id>', methods=['GET'])
def get_user_chats(user_id):
    conn = sqlite3.connect('messaging.db')
    c = conn.cursor()
    
    c.execute('''SELECT c.id, c.name, c.type, GROUP_CONCAT(u.username)
                 FROM chats c
                 JOIN chat_members cm ON c.id = cm.chat_id
                 JOIN chat_members cm2 ON c.id = cm2.chat_id
                 JOIN users u ON cm2.user_id = u.id
                 WHERE cm.user_id = ?
                 GROUP BY c.id
                 ORDER BY c.id DESC''', (user_id,))
    
    chats = []
    for row in c.fetchall():
        chat_id = row[0]
        
        # Get unread count
        c.execute('''SELECT COUNT(*) FROM messages m
                     LEFT JOIN read_receipts rr ON m.chat_id = rr.chat_id AND rr.user_id = ?
                     WHERE m.chat_id = ?
                     AND m.user_id != ?
                     AND (rr.last_read_message_id IS NULL OR m.id > rr.last_read_message_id)''',
                  (user_id, chat_id, user_id))
        
        unread_count = c.fetchone()[0]
        
        chats.append({
            'id': row[0],
            'name': row[1],
            'type': row[2],
            'members': row[3].split(',') if row[3] else [],
            'unread_count': unread_count
        })
    
    conn.close()
    return jsonify(chats)

@app.route('/messages/<int:chat_id>', methods=['GET'])
def get_messages(chat_id):
    conn = sqlite3.connect('messaging.db')
    c = conn.cursor()
    
    c.execute('''SELECT m.id, m.content, m.message_type, m.file_path, m.link_preview, m.created_at, 
                        u.username, m.user_id, m.reply_to_id
                 FROM messages m
                 JOIN users u ON m.user_id = u.id
                 WHERE m.chat_id = ?
                 ORDER BY m.created_at ASC''', (chat_id,))
    
    messages = []
    for row in c.fetchall():
        message_id = row[0]
        link_preview = json.loads(row[4]) if row[4] else None
        reply_to_id = row[8]
        
        # Get reply-to message if exists
        reply_to = None
        if reply_to_id:
            c.execute('''SELECT m.content, m.message_type, u.username
                         FROM messages m
                         JOIN users u ON m.user_id = u.id
                         WHERE m.id = ?''', (reply_to_id,))
            reply_row = c.fetchone()
            if reply_row:
                reply_content = reply_row[0]
                if reply_row[1] == 'image':
                    reply_content = '📷 Image'
                elif reply_row[1] == 'video':
                    reply_content = '🎥 Video'
                reply_to = {
                    'id': reply_to_id,
                    'username': reply_row[2],
                    'content': reply_content
                }
        
        # Get reactions for this message
        c.execute('''SELECT r.emoji, u.username, r.user_id
                     FROM reactions r
                     JOIN users u ON r.user_id = u.id
                     WHERE r.message_id = ?''', (message_id,))
        
        reactions = {}
        for reaction_row in c.fetchall():
            emoji = reaction_row[0]
            username = reaction_row[1]
            user_id = reaction_row[2]
            if emoji not in reactions:
                reactions[emoji] = []
            reactions[emoji].append({'username': username, 'user_id': user_id})
        
        messages.append({
            'id': message_id,
            'content': row[1],
            'type': row[2],
            'file_path': row[3],
            'link_preview': link_preview,
            'created_at': row[5],
            'username': row[6],
            'user_id': row[7],
            'reply_to': reply_to,
            'reactions': reactions
        })
    
    conn.close()
    return jsonify(messages)

@app.route('/mark-read/<int:chat_id>/<int:user_id>', methods=['POST'])
def mark_read(chat_id, user_id):
    conn = sqlite3.connect('messaging.db')
    c = conn.cursor()
    
    # Get the latest message id in the chat
    c.execute('SELECT MAX(id) FROM messages WHERE chat_id = ?', (chat_id,))
    last_message = c.fetchone()[0]
    
    if last_message:
        c.execute('''INSERT OR REPLACE INTO read_receipts (chat_id, user_id, last_read_message_id, updated_at)
                     VALUES (?, ?, ?, CURRENT_TIMESTAMP)''', (chat_id, user_id, last_message))
        conn.commit()
    
    conn.close()
    return jsonify({'success': True})

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    filename = secure_filename(f"{uuid.uuid4()}_{file.filename}")
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(file_path)
    
    return jsonify({'file_path': filename}), 200

@app.route('/upload-base64', methods=['POST'])
def upload_base64():
    data = request.json
    base64_data = data.get('data')
    
    if not base64_data:
        return jsonify({'error': 'No data'}), 400
    
    try:
        import base64
        # Remove data URL prefix if present
        if ',' in base64_data:
            base64_data = base64_data.split(',')[1]
        
        file_data = base64.b64decode(base64_data)
        filename = f"{uuid.uuid4()}.png"
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        with open(file_path, 'wb') as f:
            f.write(file_data)
        
        return jsonify({'file_path': filename}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/preview', methods=['POST'])
def get_preview():
    data = request.json
    url = data.get('url')
    
    if not url:
        return jsonify({'error': 'No URL provided'}), 400
    
    preview = get_link_preview(url)
    if preview:
        return jsonify(preview), 200
    else:
        return jsonify({'error': 'Could not fetch preview'}), 400

# WebSocket events
@socketio.on('connect')
def handle_connect():
    print('Client connected')

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

@socketio.on('join')
def on_join(data):
    username = data['username']
    room = data['room']
    join_room(room)
    active_users[request.sid] = {'username': username, 'room': room}
    emit('user_joined', {'username': username}, room=room)

@socketio.on('leave')
def on_leave(data):
    username = data['username']
    room = data['room']
    leave_room(room)
    emit('user_left', {'username': username}, room=room)

@socketio.on('send_message')
def handle_message(data):
    chat_id = data['chat_id']
    user_id = data['user_id']
    content = data['content']
    message_type = data.get('type', 'text')
    file_path = data.get('file_path')
    reply_to_id = data.get('reply_to_id')
    
    # Extract URLs and get preview for the first one
    link_preview = None
    if message_type == 'text' and content:
        urls = extract_urls(content)
        if urls:
            preview = get_link_preview(urls[0])
            if preview:
                link_preview = json.dumps(preview)
    
    conn = sqlite3.connect('messaging.db')
    c = conn.cursor()
    
    c.execute('''INSERT INTO messages (chat_id, user_id, content, message_type, file_path, link_preview, reply_to_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)''', (chat_id, user_id, content, message_type, file_path, link_preview, reply_to_id))
    
    message_id = c.lastrowid
    c.execute('SELECT username FROM users WHERE id = ?', (user_id,))
    username = c.fetchone()[0]
    
    # Get reply-to info if exists
    reply_to = None
    if reply_to_id:
        c.execute('''SELECT m.content, m.message_type, u.username
                     FROM messages m
                     JOIN users u ON m.user_id = u.id
                     WHERE m.id = ?''', (reply_to_id,))
        reply_row = c.fetchone()
        if reply_row:
            reply_content = reply_row[0]
            if reply_row[1] == 'image':
                reply_content = '📷 Image'
            elif reply_row[1] == 'video':
                reply_content = '🎥 Video'
            reply_to = {
                'id': reply_to_id,
                'username': reply_row[2],
                'content': reply_content
            }
    
    conn.commit()
    conn.close()
    
    emit('new_message', {
        'id': message_id,
        'chat_id': chat_id,
        'content': content,
        'type': message_type,
        'file_path': file_path,
        'link_preview': json.loads(link_preview) if link_preview else None,
        'username': username,
        'user_id': user_id,
        'reply_to': reply_to,
        'created_at': datetime.now().isoformat()
    }, room=str(chat_id))
    
    # Notify all users in the chat about the new message
    emit('chat_updated', {'chat_id': chat_id}, broadcast=True)

@socketio.on('typing')
def handle_typing(data):
    emit('user_typing', {
        'username': data['username'],
        'chat_id': data['chat_id']
    }, room=str(data['chat_id']), skip_sid=request.sid)

@socketio.on('add_reaction')
def handle_reaction(data):
    message_id = data['message_id']
    user_id = data['user_id']
    emoji = data['emoji']
    chat_id = data['chat_id']
    
    conn = sqlite3.connect('messaging.db')
    c = conn.cursor()
    
    try:
        # Insert or replace reaction (user can only have one reaction per message)
        c.execute('''INSERT OR REPLACE INTO reactions (message_id, user_id, emoji)
                     VALUES (?, ?, ?)''', (message_id, user_id, emoji))
        conn.commit()
        
        # Get username
        c.execute('SELECT username FROM users WHERE id = ?', (user_id,))
        username = c.fetchone()[0]
        
        conn.close()
        
        emit('reaction_added', {
            'message_id': message_id,
            'emoji': emoji,
            'username': username,
            'user_id': user_id
        }, room=str(chat_id))
    except Exception as e:
        print(f"Error adding reaction: {e}")
        conn.close()

@socketio.on('remove_reaction')
def handle_remove_reaction(data):
    message_id = data['message_id']
    user_id = data['user_id']
    chat_id = data['chat_id']
    
    conn = sqlite3.connect('messaging.db')
    c = conn.cursor()
    
    c.execute('DELETE FROM reactions WHERE message_id = ? AND user_id = ?', (message_id, user_id))
    conn.commit()
    conn.close()
    
    emit('reaction_removed', {
        'message_id': message_id,
        'user_id': user_id
    }, room=str(chat_id))

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)