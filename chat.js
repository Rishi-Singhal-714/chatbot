<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Zulu Club Chat</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
        }
        
        body {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        
        .chat-container {
            width: 100%;
            max-width: 800px;
            height: 90vh;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(90deg, #4f46e5 0%, #7c3aed 100%);
            color: white;
            padding: 20px;
            text-align: center;
        }
        
        .header h1 {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 5px;
        }
        
        .header p {
            opacity: 0.9;
            font-size: 14px;
        }
        
        .setup-section {
            padding: 30px;
            border-bottom: 1px solid #e5e7eb;
            background: #f9fafb;
        }
        
        .setup-section h2 {
            color: #374151;
            margin-bottom: 15px;
            font-size: 18px;
        }
        
        .phone-input {
            display: flex;
            gap: 10px;
        }
        
        .phone-input input {
            flex: 1;
            padding: 12px 16px;
            border: 2px solid #d1d5db;
            border-radius: 10px;
            font-size: 16px;
            transition: all 0.3s;
        }
        
        .phone-input input:focus {
            outline: none;
            border-color: #4f46e5;
            box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
        }
        
        .phone-input button {
            padding: 12px 24px;
            background: #4f46e5;
            color: white;
            border: none;
            border-radius: 10px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.3s;
        }
        
        .phone-input button:hover {
            background: #4338ca;
        }
        
        .chat-section {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .chat-messages {
            flex: 1;
            padding: 20px;
            overflow-y: auto;
            background: #f8fafc;
        }
        
        .message {
            margin-bottom: 15px;
            display: flex;
            animation: fadeIn 0.3s ease;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .message.user {
            justify-content: flex-end;
        }
        
        .message-content {
            max-width: 70%;
            padding: 12px 16px;
            border-radius: 18px;
            font-size: 14px;
            line-height: 1.4;
        }
        
        .message.user .message-content {
            background: #4f46e5;
            color: white;
            border-bottom-right-radius: 4px;
        }
        
        .message.bot .message-content {
            background: white;
            color: #374151;
            border: 1px solid #e5e7eb;
            border-bottom-left-radius: 4px;
        }
        
        .message-info {
            font-size: 12px;
            color: #6b7280;
            margin-top: 4px;
            text-align: right;
        }
        
        .message.bot .message-info {
            text-align: left;
        }
        
        .message.bot .message-content strong {
            color: #4f46e5;
        }
        
        .input-section {
            padding: 20px;
            border-top: 1px solid #e5e7eb;
            background: white;
        }
        
        .message-input {
            display: flex;
            gap: 10px;
        }
        
        .message-input input {
            flex: 1;
            padding: 12px 16px;
            border: 2px solid #d1d5db;
            border-radius: 10px;
            font-size: 14px;
            transition: all 0.3s;
        }
        
        .message-input input:focus {
            outline: none;
            border-color: #4f46e5;
        }
        
        .message-input button {
            padding: 12px 20px;
            background: #4f46e5;
            color: white;
            border: none;
            border-radius: 10px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.3s;
        }
        
        .message-input button:hover {
            background: #4338ca;
        }
        
        .message-input button:disabled {
            background: #9ca3af;
            cursor: not-allowed;
        }
        
        .status {
            text-align: center;
            padding: 10px;
            color: #6b7280;
            font-size: 13px;
        }
        
        .hidden {
            display: none;
        }
        
        .typing-indicator {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 8px 16px;
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 18px;
        }
        
        .typing-dot {
            width: 8px;
            height: 8px;
            background: #9ca3af;
            border-radius: 50%;
            animation: typing 1.4s infinite;
        }
        
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }
        
        @keyframes typing {
            0%, 60%, 100% { transform: translateY(0); }
            30% { transform: translateY(-4px); }
        }
        
        .welcome-message {
            background: linear-gradient(135deg, #dbeafe 0%, #ede9fe 100%);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
            border-left: 4px solid #4f46e5;
        }
        
        .welcome-message h3 {
            color: #4f46e5;
            margin-bottom: 10px;
        }
        
        .welcome-message p {
            color: #374151;
            margin-bottom: 8px;
        }
        
        @media (max-width: 640px) {
            .chat-container {
                height: 95vh;
                border-radius: 15px;
            }
            
            .header, .setup-section, .input-section {
                padding: 15px;
            }
            
            .message-content {
                max-width: 85%;
            }
        }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="header">
            <h1>Zulu Club Assistant</h1>
            <p>Your personal shopping assistant</p>
        </div>
        
        <div class="setup-section" id="setupSection">
            <h2>Enter your phone number to start chatting</h2>
            <div class="phone-input">
                <input type="tel" id="phoneInput" placeholder="Enter phone number (e.g., 919999999999)" pattern="[0-9]{10,12}">
                <button id="startChatBtn">Start Chat</button>
            </div>
        </div>
        
        <div class="chat-section hidden" id="chatSection">
            <div class="chat-messages" id="chatMessages">
                <!-- Messages will appear here -->
            </div>
            
            <div class="input-section">
                <div class="message-input">
                    <input type="text" id="messageInput" placeholder="Type your message..." disabled>
                    <button id="sendBtn" disabled>Send</button>
                </div>
                <div class="status" id="status">
                    Connected as: <span id="currentPhone"></span>
                </div>
            </div>
        </div>
    </div>

    <script>
        let currentPhone = '';
        let isConnected = false;
        
        const chatMessages = document.getElementById('chatMessages');
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const setupSection = document.getElementById('setupSection');
        const chatSection = document.getElementById('chatSection');
        const phoneInput = document.getElementById('phoneInput');
        const startChatBtn = document.getElementById('startChatBtn');
        const currentPhoneSpan = document.getElementById('currentPhone');
        
        // Load chat history from localStorage
        function loadChatHistory(phone) {
            const history = localStorage.getItem(`chat_history_${phone}`);
            if (history) {
                const messages = JSON.parse(history);
                messages.forEach(msg => {
                    displayMessage(msg.text, msg.sender, msg.timestamp);
                });
            }
        }
        
        // Save message to localStorage
        function saveMessage(text, sender) {
            const message = {
                text,
                sender,
                timestamp: new Date().toLocaleTimeString()
            };
            
            const historyKey = `chat_history_${currentPhone}`;
            let history = JSON.parse(localStorage.getItem(historyKey) || '[]');
            history.push(message);
            localStorage.setItem(historyKey, JSON.stringify(history));
            
            return message.timestamp;
        }
        
        // Display a message in the chat
        function displayMessage(text, sender, timestamp = null) {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${sender}`;
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            
            // Format text with line breaks
            const formattedText = text.replace(/\n/g, '<br>');
            contentDiv.innerHTML = formattedText;
            
            messageDiv.appendChild(contentDiv);
            
            const infoDiv = document.createElement('div');
            infoDiv.className = 'message-info';
            infoDiv.textContent = timestamp || new Date().toLocaleTimeString();
            
            messageDiv.appendChild(infoDiv);
            chatMessages.appendChild(messageDiv);
            
            // Scroll to bottom
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        
        // Show typing indicator
        function showTyping() {
            const typingDiv = document.createElement('div');
            typingDiv.className = 'message bot';
            typingDiv.id = 'typingIndicator';
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content typing-indicator';
            contentDiv.innerHTML = `
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            `;
            
            typingDiv.appendChild(contentDiv);
            chatMessages.appendChild(typingDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        
        // Hide typing indicator
        function hideTyping() {
            const typing = document.getElementById('typingIndicator');
            if (typing) {
                typing.remove();
            }
        }
        
        // Send message to server
        async function sendMessage() {
            const message = messageInput.value.trim();
            if (!message || !isConnected) return;
            
            // Clear input
            messageInput.value = '';
            
            // Save and display user message
            const timestamp = saveMessage(message, 'user');
            displayMessage(message, 'user', timestamp);
            
            // Show typing indicator
            showTyping();
            
            try {
                const response = await fetch('/chat/message', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        phoneNumber: currentPhone,
                        message: message
                    })
                });
                
                const data = await response.json();
                hideTyping();
                
                if (data.success) {
                    const botTimestamp = saveMessage(data.response, 'bot');
                    displayMessage(data.response, 'bot', botTimestamp);
                } else {
                    displayMessage('Sorry, there was an error processing your message.', 'bot');
                }
            } catch (error) {
                hideTyping();
                displayMessage('Network error. Please check your connection.', 'bot');
                console.error('Error:', error);
            }
        }
        
        // Initialize chat
        function initChat(phone) {
            currentPhone = phone;
            currentPhoneSpan.textContent = phone;
            
            // Hide setup, show chat
            setupSection.classList.add('hidden');
            chatSection.classList.remove('hidden');
            
            // Enable input
            messageInput.disabled = false;
            sendBtn.disabled = false;
            
            // Load history
            loadChatHistory(phone);
            
            // Show welcome message if no history
            if (chatMessages.children.length === 0) {
                const welcomeHtml = `
                    <div class="welcome-message">
                        <h3>Welcome to Zulu Club! 👋</h3>
                        <p>I'm your personal shopping assistant. I can help you with:</p>
                        <p>• Product browsing and shopping</p>
                        <p>• Seller information and partnerships</p>
                        <p>• Company details and investor queries</p>
                        <p>• Connecting with human agents</p>
                        <p>Try asking: "Show me t-shirts" or "Tell me about Zulu Club"</p>
                    </div>
                `;
                chatMessages.innerHTML = welcomeHtml;
            }
            
            // Focus on input
            messageInput.focus();
            isConnected = true;
        }
        
        // Event Listeners
        startChatBtn.addEventListener('click', () => {
            const phone = phoneInput.value.trim();
            if (phone && phone.length >= 10) {
                initChat(phone);
            } else {
                alert('Please enter a valid phone number (10-12 digits)');
            }
        });
        
        phoneInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                startChatBtn.click();
            }
        });
        
        sendBtn.addEventListener('click', sendMessage);
        
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        
        // Auto-focus phone input on load
        window.addEventListener('load', () => {
            phoneInput.focus();
        });
    </script>
</body>
</html>
