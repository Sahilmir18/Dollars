import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Send, LogOut } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Message {
  id: string;
  user: string;
  text: string;
  timestamp: number;
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');

  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Connect to socket when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      // Connect to the same host that serves the app
      const newSocket = io(window.location.origin);
      
      newSocket.on('connect', () => {
        console.log('Connected to server');
      });

      newSocket.on('init', (history: Message[]) => {
        setMessages(history);
      });

      newSocket.on('message', (msg: Message) => {
        setMessages((prev) => [...prev, msg]);
      });

      setSocket(newSocket);

      return () => {
        newSocket.disconnect();
      };
    }
  }, [isAuthenticated]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.toLowerCase() !== 'baccano') {
      setError('Incorrect password.');
      return;
    }
    if (!username.trim()) {
      setError('Screen name is required.');
      return;
    }
    setError('');
    setIsAuthenticated(true);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || !socket) return;

    socket.emit('message', {
      user: username.trim(),
      text: inputValue.trim(),
    });
    
    setInputValue('');
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setPassword('');
    setUsername('');
    setMessages([]);
    if (socket) {
      socket.disconnect();
      setSocket(null);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-black text-gray-300 font-mono flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold tracking-widest text-white mb-2">DOLLARS</h1>
            <p className="text-sm text-gray-500">Anonymous Chat Network</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6 mt-12">
            <div>
              <label className="block text-xs uppercase tracking-widest mb-2 text-gray-500">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-transparent border-b border-gray-700 focus:border-white outline-none py-2 text-white transition-colors"
                placeholder="Enter password..."
                autoFocus
              />
              <p className="text-xs text-gray-600 mt-1">Hint: The password is "baccano"</p>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-widest mb-2 text-gray-500">Screen Name</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-transparent border-b border-gray-700 focus:border-white outline-none py-2 text-white transition-colors"
                placeholder="Choose an alias..."
                maxLength={20}
              />
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <button
              type="submit"
              className="w-full border border-gray-700 hover:bg-white hover:text-black transition-colors py-3 uppercase tracking-widest text-sm font-bold mt-8"
            >
              Enter
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-gray-300 font-mono flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 p-4 flex justify-between items-center bg-black/90 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold tracking-widest text-white">DOLLARS</h1>
          <span className="text-xs text-gray-600 hidden sm:inline-block">Global Room</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">[{username}]</span>
          <button 
            onClick={handleLogout}
            className="text-gray-500 hover:text-white transition-colors"
            title="Disconnect"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-600 text-sm italic">
            No messages yet. Be the first to speak.
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isMe = msg.user === username;
            return (
              <div 
                key={msg.id || idx} 
                className={cn(
                  "flex flex-col",
                  isMe ? "items-end" : "items-start"
                )}
              >
                <div className="flex items-baseline gap-2 max-w-[85%] sm:max-w-[70%]">
                  {!isMe && (
                    <span className="text-gray-500 text-xs font-bold shrink-0">
                      {msg.user}:
                    </span>
                  )}
                  <div className={cn(
                    "px-3 py-1.5 break-words",
                    isMe ? "text-white" : "text-gray-300"
                  )}>
                    {msg.text}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Area */}
      <footer className="border-t border-gray-800 p-4 bg-black">
        <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto flex gap-4">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="flex-1 bg-transparent border-b border-gray-700 focus:border-white outline-none py-2 text-white transition-colors"
            placeholder="Type a message..."
            autoFocus
            maxLength={500}
          />
          <button
            type="submit"
            disabled={!inputValue.trim()}
            className="text-gray-500 hover:text-white disabled:opacity-50 disabled:hover:text-gray-500 transition-colors px-2"
          >
            <Send size={20} />
          </button>
        </form>
      </footer>
    </div>
  );
}
