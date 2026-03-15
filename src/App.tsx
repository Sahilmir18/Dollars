import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Send, LogOut, User, Headphones, Smile, UserCircle, UserSquare, Frown, Meh, Laugh, Angry, Annoyed, Ghost, Skull, Glasses, Heart, Bot, Cat, Dog, Star } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion } from 'motion/react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Message {
  id: string;
  user: string;
  text: string;
  timestamp: number;
}

const getUserColor = (username: string) => {
  const colors = [
    'bg-[#e68a00]', // Orange
    'bg-[#808080]', // Gray
    'bg-[#4d79ff]', // Blue
    'bg-[#00b33c]', // Green
    'bg-[#9933ff]', // Purple
  ];
  const hash = username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
};

const getUserIcon = (username: string) => {
  const icons = [User, Headphones, Smile, UserCircle, UserSquare, Frown, Meh, Laugh, Angry, Annoyed, Ghost, Skull, Glasses, Heart, Bot, Cat, Dog, Star];
  const hash = username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const Icon = icons[hash % icons.length];
  return <Icon size={28} className="text-white" strokeWidth={1.5} />;
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

      newSocket.on('typing', (user: string) => {
        setTypingUsers((prev) => {
          if (!prev.includes(user)) return [...prev, user];
          return prev;
        });
      });

      newSocket.on('stopTyping', (user: string) => {
        setTypingUsers((prev) => prev.filter((u) => u !== user));
      });

      setSocket(newSocket);

      return () => {
        newSocket.disconnect();
      };
    }
  }, [isAuthenticated]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setError('');

    // Simulate a network request for validation
    await new Promise(resolve => setTimeout(resolve, 1500));

    if (password.toLowerCase() !== 'cutmyfeet') {
      setError('Incorrect password.');
      setIsLoggingIn(false);
      return;
    }
    if (!username.trim()) {
      setError('Screen name is required.');
      setIsLoggingIn(false);
      return;
    }
    
    setIsAuthenticated(true);
    setIsLoggingIn(false);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || !socket) return;

    socket.emit('message', {
      user: username.trim(),
      text: inputValue.trim(),
    });
    
    setInputValue('');
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    socket.emit('stopTyping', username.trim());
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    
    if (socket && username) {
      socket.emit('typing', username.trim());
      
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('stopTyping', username.trim());
      }, 2000);
    }
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
      <div className="min-h-screen bg-black text-gray-300 font-sans flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center flex flex-col items-center">
            <div className="flex items-center justify-center gap-4 mb-3">
              <motion.div 
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.2 }}
                className="w-8 h-8 bg-white rounded-full"
              ></motion.div>
              <motion.h1 
                initial={{ opacity: 0, letterSpacing: "0em", filter: "blur(4px)" }}
                animate={{ opacity: 1, letterSpacing: "0.25em", filter: "blur(0px)" }}
                transition={{ duration: 1.2, ease: "easeOut", delay: 0.4 }}
                className="text-4xl font-light text-white uppercase ml-[0.25em]"
              >
                ALIAS
              </motion.h1>
            </div>
            <motion.p 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 1 }}
              className="text-gray-500 tracking-widest uppercase text-[10px]"
            >
              Anonymous Chat Network
            </motion.p>
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 1.4 }}
              className="text-xs text-gray-700 mt-4 italic"
            >
              Created by Sebastian
            </motion.p>
          </div>

          <motion.form 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 1.6 }}
            onSubmit={handleLogin} 
            className="space-y-6 mt-12"
          >
            <div>
              <label className="block text-xs uppercase tracking-widest mb-2 text-gray-500">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoggingIn}
                className="w-full bg-transparent border-b border-gray-700 focus:border-white outline-none py-2 text-white transition-colors disabled:opacity-50"
                placeholder="Enter password..."
                autoFocus
              />
              <p className="text-xs text-gray-600 mt-1">Hint: The password is "cutmyfeet"</p>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-widest mb-2 text-gray-500">Screen Name</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoggingIn}
                className="w-full bg-transparent border-b border-gray-700 focus:border-white outline-none py-2 text-white transition-colors disabled:opacity-50"
                placeholder="Choose an alias..."
                maxLength={20}
              />
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full border border-gray-700 hover:bg-white hover:text-black transition-colors py-3 uppercase tracking-widest text-sm font-bold mt-8 flex justify-center items-center disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-white"
            >
              {isLoggingIn ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  AUTHENTICATING...
                </span>
              ) : (
                'Enter'
              )}
            </button>
          </motion.form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-gray-300 font-sans flex flex-col">
      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-600 text-sm italic">
            No messages yet. Be the first to speak.
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={msg.id || idx} className="flex items-start gap-4">
              {/* Avatar */}
              <div className="flex flex-col items-center w-16 shrink-0">
                <div className={cn("w-12 h-12 border-2 border-white flex items-center justify-center mb-1", getUserColor(msg.user))}>
                  {getUserIcon(msg.user)}
                </div>
                <span className="text-white text-xs truncate w-full text-center">{msg.user}</span>
              </div>

              {/* Message Bubble and Timestamp */}
              <div className="flex items-end gap-2 max-w-[75%] mt-1">
                <div className="relative">
                  {/* Tail */}
                  <div className={cn("absolute -left-2 top-3 w-4 h-4 border-t-2 border-l-2 border-white transform -rotate-45", getUserColor(msg.user))}></div>
                  
                  {/* Bubble */}
                  <div className={cn("relative z-10 px-4 py-2 border-2 border-white rounded-xl text-white text-sm shadow-sm break-words", getUserColor(msg.user))}>
                    {msg.text}
                  </div>
                </div>
                {/* Timestamp */}
                <span className="text-[10px] text-gray-500 shrink-0 mb-1">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Typing Indicator */}
      {typingUsers.length > 0 && (
        <div className="px-4 py-1 text-xs text-gray-500 italic bg-black">
          {typingUsers.length === 1
            ? `${typingUsers[0]} is typing...`
            : typingUsers.length === 2
            ? `${typingUsers[0]} and ${typingUsers[1]} are typing...`
            : `${typingUsers.length} people are typing...`}
        </div>
      )}

      {/* Input Area */}
      <footer className="p-4 bg-black">
        <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto flex gap-4 items-center">
          <input
            type="text"
            value={inputValue}
            onChange={handleInputChange}
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
          <button 
            type="button"
            onClick={handleLogout}
            className="text-gray-500 hover:text-white transition-colors px-2"
            title="Disconnect"
          >
            <LogOut size={20} />
          </button>
        </form>
      </footer>
    </div>
  );
}
